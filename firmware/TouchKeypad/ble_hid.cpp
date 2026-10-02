#include "ble_hid.h"
#include "board.h"
#include "console.h"
#include "hid_maps.h"
#include "ui.h"
#include <NimBLEDevice.h>
#include <NimBLEHIDDevice.h>
#include <Preferences.h>

#define RID_KB    1
#define RID_CONS  2
#define RID_MOUSE 3
#define RID_TEL   8

static const uint8_t reportMap[] = {
  // Keyboard, report 1: modifiers, reserved, 6 keys; LED output
  0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, 0x85, RID_KB,
  0x05, 0x07, 0x19, 0xE0, 0x29, 0xE7, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02,
  0x95, 0x01, 0x75, 0x08, 0x81, 0x01,
  0x95, 0x05, 0x75, 0x01, 0x05, 0x08, 0x19, 0x01, 0x29, 0x05, 0x91, 0x02,
  0x95, 0x01, 0x75, 0x03, 0x91, 0x01,
  0x95, 0x06, 0x75, 0x08, 0x15, 0x00, 0x26, 0xFF, 0x00, 0x05, 0x07, 0x19, 0x00, 0x2A, 0xFF, 0x00, 0x81, 0x00,
  0xC0,
  // Consumer control, report 2: one 16-bit usage
  0x05, 0x0C, 0x09, 0x01, 0xA1, 0x01, 0x85, RID_CONS,
  0x15, 0x00, 0x26, 0xFF, 0x03, 0x19, 0x00, 0x2A, 0xFF, 0x03, 0x75, 0x10, 0x95, 0x01, 0x81, 0x00,
  0xC0,
  // Mouse, report 3: 5 buttons, X, Y, wheel
  0x05, 0x01, 0x09, 0x02, 0xA1, 0x01, 0x85, RID_MOUSE, 0x09, 0x01, 0xA1, 0x00,
  0x05, 0x09, 0x19, 0x01, 0x29, 0x05, 0x15, 0x00, 0x25, 0x01, 0x95, 0x05, 0x75, 0x01, 0x81, 0x02,
  0x95, 0x01, 0x75, 0x03, 0x81, 0x01,
  0x05, 0x01, 0x09, 0x30, 0x09, 0x31, 0x09, 0x38, 0x15, 0x81, 0x25, 0x7F, 0x75, 0x08, 0x95, 0x03, 0x81, 0x06,
  0xC0, 0xC0,
  // Telephony, report 8 (from v2.1): hook switch, phone mute, drop
  0x05, 0x0B, 0x09, 0x05, 0xA1, 0x01, 0x85, RID_TEL,
  0x05, 0x0B, 0x09, 0x20, 0x09, 0x2F, 0x09, 0x26, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x03, 0x81, 0x02,
  0x75, 0x01, 0x95, 0x05, 0x81, 0x03,
  0xC0,
};

static NimBLEServer *server;
static NimBLEHIDDevice *hid;
static NimBLECharacteristic *inKb, *inCons, *inMouse, *inTel;

static bool dryRun = KP_TEST;
static volatile bool linkUp = false;       // encrypted connection present
static volatile bool pairOpen = false;
static volatile int  bondsAtConnect = 0;
static uint32_t passkey = 0, pairStart = 0;

// NimBLE callbacks run in the NimBLE task; they only post here and loop()
// does the printing and drawing, so serial output never interleaves.
enum : uint8_t { EV_UP, EV_DOWN, EV_PASSKEY, EV_FAIL, EV_REJECT };
struct BleEvt { uint8_t type; int8_t slot; uint8_t newBond; uint32_t val; };
static QueueHandle_t evq;

static void post(uint8_t type, int slot = -1, uint32_t val = 0, bool newBond = false) {
  BleEvt e = { type, (int8_t)slot, (uint8_t)newBond, val };
  xQueueSend(evq, &e, 0);
}

static int slotOf(const NimBLEAddress &a) {
  for (int i = 0; i < NimBLEDevice::getNumBonds(); i++)
    if (NimBLEDevice::getBondedAddress(i) == a) return i;
  return -1;
}

// The static passkey stays at NimBLE's default (123456) so NimBLE asks
// onPassKeyDisplay() for the key on every pairing.
static uint32_t newPasskey() {
  passkey = 100000 + esp_random() % 900000;
  return passkey;
}

// ---------------------------------------------------------------- Bluetooth console (Nordic UART service)
// The same line CLI as USB serial, for Studio with no cable. Writes need an encrypted
// link (a host that paired with the passkey on the screen); the NimBLE task fills a
// ring that the main loop drains, and output goes out in MTU-sized notifications.
static NimBLECharacteristic *nusTx;
static volatile bool nusOn = false;
static volatile uint16_t nusChunk = 20;
static uint8_t rxRing[8192];
static volatile uint16_t rxHead = 0, rxTail = 0;
static uint8_t txBuf[244];
static size_t txLen = 0;
static uint32_t txAt = 0;

class NusRx : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c, NimBLEConnInfo &info) override {
    if (!info.isEncrypted()) return;
    NimBLEAttValue v = c->getValue();
    for (size_t i = 0; i < v.length(); i++) {
      uint16_t next = (rxHead + 1) % sizeof rxRing;
      if (next == rxTail) break;   // full: the loop is far behind; that line fails its checks
      rxRing[rxHead] = v.data()[i];
      rxHead = next;
    }
  }
};
class NusTx : public NimBLECharacteristicCallbacks {
  void onSubscribe(NimBLECharacteristic *c, NimBLEConnInfo &info, uint16_t subValue) override {
    nusChunk = min((int)sizeof txBuf, max(20, (int)info.getMTU() - 3));
    nusOn = subValue && info.isEncrypted();
  }
};

static void txSend() {
  if (!txLen) return;
  if (nusOn && linkUp)
    for (int t = 0; t < 60 && !nusTx->notify(txBuf, txLen); t++) delay(3);   // the queue drains
  txLen = 0;
}
void bleConsoleWrite(const uint8_t *b, size_t n) {
  if (!nusOn) return;
  for (size_t i = 0; i < n; i++) {
    txBuf[txLen++] = b[i];
    if (txLen >= nusChunk || b[i] == '\n') txSend();
  }
  txAt = millis();
}
void bleConsoleFlush() { txSend(); }
int bleConsoleRead() {
  if (rxHead == rxTail) return -1;
  uint8_t c = rxRing[rxTail];
  rxTail = (rxTail + 1) % sizeof rxRing;
  return c;
}
bool bleConsoleOpen() { return nusOn; }

class ServerCb : public NimBLEServerCallbacks {
  void onMTUChange(uint16_t mtu, NimBLEConnInfo &info) override { nusChunk = min((int)sizeof txBuf, max(20, (int)mtu - 3)); }
  void onConnect(NimBLEServer *s, NimBLEConnInfo &info) override {
    bondsAtConnect = NimBLEDevice::getNumBonds();
    s->updateConnParams(info.getConnHandle(), 6, 12, 0, 400);   // 7.5-15 ms
  }
  void onDisconnect(NimBLEServer *s, NimBLEConnInfo &info, int reason) override {
    linkUp = s->getConnectedCount() > 0;
    if (!linkUp) nusOn = false;
    post(EV_DOWN, slotOf(info.getIdAddress()), reason);
  }
  uint32_t onPassKeyDisplay() override {
    if (pairOpen) return passkey;                 // the key already on the ticket
    uint32_t pk = 100000 + esp_random() % 900000;
    if (bondsAtConnect == 0) { passkey = pk; post(EV_PASSKEY, -1, pk); }   // first host: open the window
    return pk;   // otherwise never shown, so a stranger cannot complete MITM pairing
  }
  void onConfirmPassKey(NimBLEConnInfo &info, uint32_t pin) override {
    NimBLEDevice::injectConfirmPasskey(info, pairOpen || bondsAtConnect == 0);
  }
  void onAuthenticationComplete(NimBLEConnInfo &info) override {
    bool newBond = NimBLEDevice::getNumBonds() > bondsAtConnect;
    if (!info.isEncrypted()) {
      server->disconnect(info);
      post(EV_FAIL);
      return;
    }
    if (newBond && !(pairOpen || bondsAtConnect == 0)) {
      NimBLEDevice::deleteBond(info.getIdAddress());
      server->disconnect(info);
      post(EV_REJECT);
      return;
    }
    linkUp = true;
    post(EV_UP, slotOf(info.getIdAddress()), 0, newBond);
  }
};

void hidBegin() {
  evq = xQueueCreate(8, sizeof(BleEvt));
  NimBLEDevice::init("Touch Keypad");
  NimBLEDevice::setSecurityAuth(true, true, true);         // bond, MITM, LE secure connections
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_DISPLAY_ONLY);  // passkey shown on the screen
  newPasskey();
  server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCb());
  server->advertiseOnDisconnect(true);

  hid = new NimBLEHIDDevice(server);
  inKb = hid->getInputReport(RID_KB);
  hid->getOutputReport(RID_KB);                 // LED report (ignored)
  inCons = hid->getInputReport(RID_CONS);
  inMouse = hid->getInputReport(RID_MOUSE);
  inTel = hid->getInputReport(RID_TEL);
  hid->setManufacturer("DIY Macropad");
  hid->setPnp(0x02, 0x303A, 0x80C6, 0x0300);
  hid->setHidInfo(0x00, 0x01);
  hid->setReportMap((uint8_t *)reportMap, sizeof(reportMap));
  hid->setBatteryLevel(100);                    // power.cpp updates it once it has a reading

  NimBLEDevice::setMTU(247);                    // console lines in a few notifications, not dozens
  NimBLEService *nus = server->createService("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
  nus->createCharacteristic("6E400002-B5A3-F393-E0A9-E50E24DCCA9E",
                            NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR | NIMBLE_PROPERTY::WRITE_ENC)->setCallbacks(new NusRx());
  nusTx = nus->createCharacteristic("6E400003-B5A3-F393-E0A9-E50E24DCCA9E", NIMBLE_PROPERTY::NOTIFY);
  nusTx->setCallbacks(new NusTx());
  server->start();

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->setAppearance(HID_KEYBOARD);
  adv->addServiceUUID(hid->getHidService()->getUUID());
  adv->setName("Touch Keypad");
  adv->enableScanResponse(true);
  adv->start();
}

// ---------------------------------------------------------------- reports
static bool sendReport(uint8_t id, const uint8_t *data, size_t len) {
  if (dryRun) {
    char hex[2 * 8 + 1];
    for (size_t i = 0; i < len; i++) sprintf(hex + 2 * i, "%02x", data[i]);
    Con.printf("EVT:HID %u %s\n", id, hex);
  }
  if (!linkUp) return dryRun;
  NimBLECharacteristic *c = id == RID_KB ? inKb : id == RID_CONS ? inCons : id == RID_MOUSE ? inMouse : inTel;
  c->setValue(data, len);
  // Each report in its own buffer: a bare notify() sends whatever the value is when the link
  // gets to it, so a key's press was overwritten by its release 8 ms later and letters vanished.
  // A full controller queue refuses the buffer; give the link a moment and try again.
  for (int tries = 0; tries < 40; tries++) {
    if (c->notify(data, len)) return true;
    delay(3);
  }
  Con.printf("HID report %u dropped: the link is not draining\n", id);
  return false;
}

static uint8_t kbMods = 0, kbKeys[6] = {0};

static bool sendKb() {
  uint8_t r[8] = { kbMods, 0, kbKeys[0], kbKeys[1], kbKeys[2], kbKeys[3], kbKeys[4], kbKeys[5] };
  return sendReport(RID_KB, r, sizeof r);
}

static void addKey(uint8_t code) {
  for (uint8_t &k : kbKeys) if (k == code) return;
  for (uint8_t &k : kbKeys) if (!k) { k = code; return; }
}

static bool kbDown() { if (kbMods) return true; for (uint8_t k : kbKeys) if (k) return true; return false; }

void hidReleaseAll() {
  if (!kbDown()) return;
  kbMods = 0;
  memset(kbKeys, 0, sizeof kbKeys);
  sendKb();
}

static bool tap(uint8_t mods, uint8_t code) {
  uint8_t keepMods = kbMods;
  kbMods |= mods;
  if (code) addKey(code);
  bool ok = sendKb();
  delay(8);
  kbMods = keepMods;
  for (uint8_t &k : kbKeys) if (k == code) k = 0;
  sendKb();
  return ok;
}

bool hidTypeChar(char c) {
  uint8_t code; bool shift;
  if (!asciiToHid(c, code, shift)) return true;   // untypeable: skip silently
  return tap(shift ? 0x02 : 0, code);
}

bool hidPressKey(const char *name) {
  if (!name || !*name) return true;
  if (uint8_t code = keyNameToHid(name)) return tap(0, code);
  if (uint8_t m = modifierNameToBit(name)) return tap(m, 0);
  if (strlen(name) == 1) return hidTypeChar(name[0]);
  Con.printf("Unknown key '%s'\n", name);
  return true;
}

bool hidSendKeyCombo(JsonArrayConst keys) {
  for (JsonVariantConst v : keys) {
    const char *k = v | "";
    uint8_t code; bool shift;
    if (uint8_t m = modifierNameToBit(k)) kbMods |= m;
    else if ((code = keyNameToHid(k))) addKey(code);
    else if (strlen(k) == 1 && asciiToHid(k[0], code, shift)) { addKey(code); if (shift) kbMods |= 0x02; }
  }
  bool ok = sendKb();
  delay(15);
  kbMods = 0;
  memset(kbKeys, 0, sizeof kbKeys);
  sendKb();
  return ok;
}

bool hidHold(const char *name) {
  uint8_t code; bool shift;
  if (uint8_t m = modifierNameToBit(name)) kbMods |= m;
  else if ((code = keyNameToHid(name))) addKey(code);
  else if (strlen(name) == 1 && asciiToHid(name[0], code, shift)) addKey(code);
  else return true;
  return sendKb();
}

bool hidSendMedia(uint16_t usage) {
  if (!usage) return true;
  uint8_t r[2] = { (uint8_t)(usage & 0xFF), (uint8_t)(usage >> 8) };
  bool ok = sendReport(RID_CONS, r, 2);
  delay(15);
  uint8_t z[2] = { 0, 0 };
  sendReport(RID_CONS, z, 2);
  return ok;
}

static int8_t clamp8(int v) { return (int8_t)(v > 127 ? 127 : v < -127 ? -127 : v); }

bool hidMouseMove(int x, int y, int wheel) {
  uint8_t r[4] = { 0, (uint8_t)clamp8(x), (uint8_t)clamp8(y), (uint8_t)clamp8(wheel) };
  return sendReport(RID_MOUSE, r, 4);
}

bool hidMouseClick(uint8_t buttons) {
  uint8_t r[4] = { buttons, 0, 0, 0 };
  bool ok = sendReport(RID_MOUSE, r, 4);
  delay(10);
  r[0] = 0;
  sendReport(RID_MOUSE, r, 4);
  return ok;
}

bool hidSendTelephony(const char *which) {
  uint8_t bits = !strcasecmp(which, "ANSWER") ? 0x01 : !strcasecmp(which, "MIC_MUTE") ? 0x02
               : !strcasecmp(which, "DECLINE") ? 0x04 : 0;
  if (!bits) return true;
  bool ok = sendReport(RID_TEL, &bits, 1);
  delay(10);
  bits = 0;
  sendReport(RID_TEL, &bits, 1);
  return ok;
}

// §9: slot s -> modifier set s/12, key F13 + s%12.
bool hidHostCombo(int slot) {
  static const uint8_t sets[4] = { 0x07, 0x05, 0x03, 0x0F };   // C+A+S, C+A, C+S, C+A+S+Win
  if (slot < 0 || slot > 47) return true;
  return tap(sets[slot / 12], 0x68 + slot % 12);
}

bool hidConnected() { return linkUp; }
void hidSetDry(bool on) { dryRun = on; }
bool hidDry() { return dryRun; }

// ---------------------------------------------------------------- hosts
static void pairClose(const char *why) {
  if (!pairOpen) return;
  pairOpen = false;
  Con.printf("EVT:BLE pair %s\n", why);
  uiPairClose();
}

void blePoll() {
  if (txLen && millis() - txAt > 30) txSend();   // a partial console line (a prompt) goes out
  BleEvt e;
  while (xQueueReceive(evq, &e, 0) == pdTRUE) {
    switch (e.type) {
      case EV_PASSKEY:
        if (!pairOpen) { pairOpen = true; pairStart = millis(); Con.println("EVT:BLE pair open"); }
        Con.printf("EVT:PASSKEY %06lu\n", (unsigned long)e.val);
        uiPairShow(e.val);
        break;
      case EV_UP:
        Con.printf("EVT:BLE %d up\n", e.slot);
        if (e.newBond) { if (pairOpen) pairClose("ok"); else { Con.println("EVT:BLE pair ok"); uiPairClose(); } }
        uiMarkStatus();
        break;
      case EV_DOWN:
        Con.printf("EVT:BLE %d down\n", e.slot);
        uiMarkStatus();
        break;
      case EV_FAIL:
      case EV_REJECT:
        Con.printf("EVT:BLE pair %s\n", e.type == EV_FAIL ? "fail" : "rejected");
        pairOpen = false;
        uiPairClose();
        break;
    }
  }
  if (pairOpen && millis() - pairStart > PAIR_WINDOW_MS) pairClose("timeout");
  // Keep advertising while there is room for a host (or a pairing window).
  static uint32_t lastAdvCheck = 0;
  if (millis() - lastAdvCheck > 1000) {
    lastAdvCheck = millis();
    NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
    bool want = pairOpen || server->getConnectedCount() == 0;
    if (want && !adv->isAdvertising()) adv->start();
  }
}

void blePairOpen() {
  newPasskey();
  pairOpen = true;
  pairStart = millis();
  Con.println("EVT:BLE pair open");
  Con.printf("EVT:PASSKEY %06lu\n", (unsigned long)passkey);
  uiPairShow(passkey);
  NimBLEDevice::getAdvertising()->start();
}

void blePairCancel() { pairClose("closed"); }
bool blePairing() { return pairOpen; }
uint32_t blePasskey() { return passkey; }
uint32_t blePairLeftMs() {
  uint32_t el = millis() - pairStart;
  return pairOpen && el < PAIR_WINDOW_MS ? PAIR_WINDOW_MS - el : 0;
}

int bleBondCount() { return NimBLEDevice::getNumBonds(); }

void bleList() {
  int n = NimBLEDevice::getNumBonds();
  for (int i = 0; i < n; i++) {
    NimBLEAddress a = NimBLEDevice::getBondedAddress(i);
    bool up = false;
    for (uint16_t h : server->getPeerDevices())
      if (server->getPeerInfoByHandle(h).getIdAddress() == a) up = true;
    Con.printf("%d %s %s %s\n", i, a.toString().c_str(), up ? "connected" : "bonded", bleHostName(i).c_str());
  }
  Con.printf("hosts:%d connected:%d advertising:%d pairing:%d\n", n, (int)server->getConnectedCount(),
                (int)NimBLEDevice::getAdvertising()->isAdvertising(), (int)pairOpen);
}

static String nameKey(const NimBLEAddress &a);

bool bleForget(int n) {
  if (n < 0 || n >= NimBLEDevice::getNumBonds()) return false;
  NimBLEAddress a = NimBLEDevice::getBondedAddress(n);
  for (uint16_t h : server->getPeerDevices())
    if (server->getPeerInfoByHandle(h).getIdAddress() == a) server->disconnect(h);
  // The controller's resolving list can't change while advertising, and the
  // host refuses the unpair then; blePoll() restarts advertising.
  NimBLEDevice::getAdvertising()->stop();
  bool ok = NimBLEDevice::deleteBond(a);
  Preferences p;   // the name goes with the bond, or the next pairing from this address inherits it
  p.begin("hosts", false);
  p.remove(nameKey(a).c_str());
  p.end();
  uiMarkStatus();
  return ok;
}

static bool bondUp(const NimBLEAddress &a) {
  for (uint16_t h : server->getPeerDevices())
    if (server->getPeerInfoByHandle(h).getIdAddress() == a) return true;
  return false;
}

bool bleHostUp(int n) { return n >= 0 && n < NimBLEDevice::getNumBonds() && bondUp(NimBLEDevice::getBondedAddress(n)); }

int bleConnectedSlot() {
  for (int i = 0; i < NimBLEDevice::getNumBonds(); i++) if (bleHostUp(i)) return i;
  return -1;
}

// Switch hosts: drop the current link and advertise directly to bond n, so that
// computer reconnects. If it is not in range, blePoll() resumes open advertising.
bool bleUse(int n) {
  if (n < 0 || n >= NimBLEDevice::getNumBonds()) return false;
  NimBLEAddress a = NimBLEDevice::getBondedAddress(n);
  for (uint16_t h : server->getPeerDevices()) server->disconnect(h);
  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->stop();
  return adv->start(1280, &a);
}

// Names come from Studio (`hostname`), keyed by the bond's identity address.
static String nameKey(const NimBLEAddress &a) {
  String k = a.toString().c_str();
  k.replace(":", "");
  return k.substring(0, 12);
}

String bleHostName(int n) {
  if (n < 0 || n >= NimBLEDevice::getNumBonds()) return "";
  Preferences p;
  p.begin("hosts", true);
  String s = p.getString(nameKey(NimBLEDevice::getBondedAddress(n)).c_str(), "");
  p.end();
  return s.length() ? s : "Host " + String(n + 1);
}

bool bleSetHostName(const char *name) {
  int n = bleConnectedSlot();
  if (n < 0) return false;
  Preferences p;
  p.begin("hosts", false);
  p.putString(nameKey(NimBLEDevice::getBondedAddress(n)).c_str(), String(name).substring(0, 20));
  p.end();
  uiMarkStatus();
  return true;
}

void bleSetBattery(uint8_t pct) {
  if (hid) hid->setBatteryLevel(pct, linkUp);   // Windows shows it in Bluetooth settings
}
