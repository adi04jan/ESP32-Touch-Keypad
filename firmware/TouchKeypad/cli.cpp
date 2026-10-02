#include "cli.h"
#include "board.h"
#include "storage.h"
#include "profiles.h"
#include "ui.h"
#include "touch.h"
#include "display.h"
#include "ble_hid.h"
#include <ArduinoJson.h>
#include <LittleFS.h>
#include "mbedtls/base64.h"
#include "esp_rom_crc.h"

static char line[CLI_LINE_MAX];
static size_t lineLen = 0;
static bool lineTooLong = false;

// Uploads stream to <path>.tmp line by line and are committed only after they validate.
static struct {
  bool on, bin;
  char path[64];
  File f;
  size_t size, want;
  uint32_t crc, wantCrc, last;
  bool failed;
} up;

static void prompt() { Serial.print("macropad:$ "); }

static void normPath(const char *in, char *out, size_t n) {
  snprintf(out, n, "%s%s", *in == '/' ? "" : "/", in);
}

// ---------------------------------------------------------------- uploads
static bool uploadOpen(const char *path, bool bin, size_t want, uint32_t crc) {
  normPath(path, up.path, sizeof up.path);
  if (strstr(up.path, "..") || strlen(path) > 56) { Serial.println("ERR bad path"); return false; }
  up.f = LittleFS.open(String(up.path) + ".tmp", "w", true);
  if (!up.f) { Serial.printf("ERR cannot write %s\n", up.path); return false; }
  up.on = true;
  up.bin = bin;
  up.size = 0;
  up.want = want;
  up.crc = 0;
  up.wantCrc = crc;
  up.failed = false;
  up.last = millis();
  Serial.printf("RECV %s\n", up.path);
  return true;
}

static void uploadAbort(const char *why) {
  up.f.close();
  LittleFS.remove(String(up.path) + ".tmp");
  up.on = false;
  Serial.println(why);
  prompt();
}

static void uploadLine(char *s, size_t n) {
  up.last = millis();
  if (up.failed) return;
  if (up.bin) {
    while (n && s[n - 1] == ' ') s[--n] = 0;
    static uint8_t out[CLI_LINE_MAX / 4 * 3 + 3];
    size_t got = 0;
    if (mbedtls_base64_decode(out, sizeof out, &got, (const uint8_t *)s, n) != 0) { up.failed = true; return; }
    up.crc = esp_rom_crc32_le(up.crc, out, got);
    up.size += got;
    if (up.size > up.want || up.f.write(out, got) != got) up.failed = true;
  } else {
    up.size += n + 1;
    if (up.size > UPLOAD_MAX) { up.failed = true; return; }
    if (up.f.write((const uint8_t *)s, n) != n || up.f.write('\n') != 1) up.failed = true;
  }
}

static void uploadFinish() {
  up.f.close();
  up.on = false;
  String tmp = String(up.path) + ".tmp";
  if (up.bin) {
    if (up.failed || up.size != up.want) Serial.printf("ERR size mismatch %u != %u\n", (unsigned)up.size, (unsigned)up.want);
    else if (up.crc != up.wantCrc) Serial.printf("ERR crc mismatch %08lx != %08lx\n", (unsigned long)up.crc, (unsigned long)up.wantCrc);
    else if (!commitTmp(up.path, false)) Serial.printf("ERR cannot save %s\n", up.path);
    else { Serial.printf("SAVED %s\n", up.path); uiMarkAll(); prompt(); return; }
    LittleFS.remove(tmp);
    prompt();
    return;
  }
  if (up.failed) { LittleFS.remove(tmp); Serial.println(up.size > UPLOAD_MAX ? "Upload too large; discarded." : "ERR write failed"); prompt(); return; }

  int id = 0;
  String err;
  bool ok;
  if (isProfilePath(up.path, &id)) ok = validateProfile(tmp.c_str(), err);
  else {   // other JSON: syntax only, parsed with an empty filter so it costs no RAM
    JsonDocument skip, doc;
    skip.set(false);
    File f = LittleFS.open(tmp, "r");
    DeserializationError e = deserializeJson(doc, f, DeserializationOption::Filter(skip));
    f.close();
    ok = !e;
    if (e) err = String("invalid JSON (") + e.c_str() + ")";
  }
  if (!ok) { LittleFS.remove(tmp); Serial.printf("Upload rejected: %s\n", err.c_str()); prompt(); return; }
  if (!commitTmp(up.path, true)) { Serial.printf("ERR cannot save %s\n", up.path); prompt(); return; }
  Serial.printf("SAVED %s %u\n", up.path + 1, (unsigned)up.size);
  if (id) {
    gcTiles();
    if (id == currentProfile) {
      int pg = currentPage;
      uiSetProfile(id);
      if (pg > 0 && pg < pageCount) uiGoPage(pg, false);
    }
  }
  prompt();
}

// ---------------------------------------------------------------- RAM preview helpers
static JsonVariant cellKey(int id, bool create) {
  if (id < 1 || id > NUM_CELLS) return JsonVariant();
  JsonVariant k = pageDoc["keys"][id - 1];
  if (k.isNull() && create) {
    JsonObject o = k.to<JsonObject>();
    o["id"] = id;
    o["name"] = "";
    JsonArray c = o["led_color"].to<JsonArray>();
    c.add(110); c.add(100); c.add(92);
  }
  return pageDoc["keys"][id - 1];
}

static void setColor(JsonVariant k, int r, int g, int b) {
  JsonArray col = k["led_color"].to<JsonArray>();
  col.add(constrain(r, 0, 255));
  col.add(constrain(g, 0, 255));
  col.add(constrain(b, 0, 255));
}

static void setActions(const char *cmd, const char *arg, const char *field) {
  int id = atoi(arg);
  const char *json = strchr(arg, ' ');
  JsonDocument tmp;
  if (!json || id < 1 || id > NUM_CELLS || deserializeJson(tmp, json + 1) || !tmp.is<JsonArray>()) {
    Serial.printf("%s <id 1-15> <json-array>\n", cmd);
    return;
  }
  cellKey(id, true)[field] = tmp.as<JsonArray>();
  uiMarkCell(id - 1);
  Serial.printf("Key %d updated in RAM\n", id);
}

// ---------------------------------------------------------------- commands
static void cmdBle(const char *arg) {
  int n = -1;
  if (!strcmp(arg, "list")) bleList();
  else if (sscanf(arg, "forget %d", &n) == 1) Serial.println(bleForget(n) ? "forgot " + String(n) : "ERR no host " + String(n));
  else if (!strcmp(arg, "pair")) { blePairOpen(); Serial.println("pair open"); }
  else if (!strcmp(arg, "cancel")) { blePairCancel(); Serial.println("pair closed"); }
  else Serial.println("ble list | ble forget <n> | ble pair | ble cancel");
}

// Returns false when the command prints its own prompt later (touch injection).
static bool runCommand(char *s) {
  char *arg = strchr(s, ' ');
  if (arg) { *arg++ = 0; while (*arg == ' ') arg++; } else arg = s + strlen(s);
  String cmd = s;
  cmd.toLowerCase();
  int a, b, c, d, e;

  if (cmd == "help") {
    Serial.println("help ls [dir] cat <f> fsinfo reboot status setprofile <n> page <n> setkey|sethold <id> <json> "
                   "setface <id> <tile> <r> <g> <b> title <id> <text> show <id> ok|alert widget <name> <json> "
                   "settime <epoch> <tzmin> setled <id> <r> <g> <b> setidle <name> setbrightness <0-255> setdim <s> "
                   "ble list|forget <n>|pair|cancel | debug: shot touch <x> <y> [ms] hold <x> <y> [ms] "
                   "swipe <x1> <y1> <x2> <y2> [ms] hid dry on|off heap log on|off lcd calibrate");
  } else if (cmd == "status") {
    Serial.printf("Profile:%d loaded:%d idle:0 mode:ble ver:%s model:touch page:%d ble:%d pages:%d dry:%d\n",
                  currentProfile, profileLoaded, FW_VERSION, currentPage + 1, hidConnected() ? 1 : 0, pageCount, hidDry() ? 1 : 0);
  } else if (cmd == "ls") {
    listFiles(*arg ? arg : "/");
  } else if (cmd == "cat") {
    char p[64];
    normPath(arg, p, sizeof p);
    if (!*arg) Serial.println("cat <file>"); else catFile(p);
  } else if (cmd == "fsinfo") {
    Serial.printf("FS_INFO:%u,%u\n", (unsigned)LittleFS.totalBytes(), (unsigned)LittleFS.usedBytes());
  } else if (cmd == "reboot") {
    Serial.println("rebooting");
    Serial.flush();
    delay(100);
    ESP.restart();
  } else if (cmd == "setprofile") {
    a = atoi(arg);
    if (a < 1 || a > NUM_PROFILES) Serial.println("invalid");
    else { uiSetProfile(a); Serial.printf("profile %d\n", a); }
  } else if (cmd == "page") {
    a = atoi(arg);
    if (a < 1 || a > pageCount) Serial.println("invalid page");
    else { uiGoPage(a - 1, false); Serial.printf("page %d\n", a); }
  } else if (cmd == "setkey") {
    setActions("setkey", arg, "actions");
  } else if (cmd == "sethold") {
    setActions("sethold", arg, "hold_actions");
  } else if (cmd == "setface") {
    char tile[12] = "";
    if (sscanf(arg, "%d %11s %d %d %d", &a, tile, &b, &c, &d) != 5 || a < 1 || a > NUM_CELLS || strlen(tile) != 8 ||
        strspn(tile, "0123456789abcdef") != 8) {
      Serial.println("setface <id> <tile> <r> <g> <b>");
    } else {
      JsonVariant k = cellKey(a, true);
      k["tile"] = tile;
      setColor(k, b, c, d);
      uiMarkCell(a - 1);
      Serial.printf("face %d %s\n", a, LittleFS.exists(String("/t/") + tile + ".565") ? "ok" : "missing tile");
    }
  } else if (cmd == "title") {
    a = atoi(arg);
    const char *text = strchr(arg, ' ');
    if (a < 1 || a > NUM_CELLS) Serial.println("title <id> <text>");
    else { cellKey(a, true)["name"] = text ? text + 1 : ""; uiMarkCell(a - 1); Serial.printf("title %d\n", a); }
  } else if (cmd == "show") {
    char what[8] = "";
    if (sscanf(arg, "%d %7s", &a, what) != 2 || a < 1 || a > NUM_CELLS) Serial.println("show <id> ok|alert");
    else { uiFlash(a - 1, strcmp(what, "alert") != 0); Serial.printf("show %d %s\n", a, what); }
  } else if (cmd == "widget") {
    const char *json = strchr(arg, ' ');
    JsonDocument doc;
    if (!json || deserializeJson(doc, json + 1) || !doc.is<JsonObject>()) Serial.println("widget <name> <json>");
    else {
      String name = String(arg).substring(0, json - arg);
      if (name == "now_playing") uiNowPlaying(doc.as<JsonObjectConst>());
      Serial.printf("widget %s\n", name.c_str());
    }
  } else if (cmd == "settime") {
    unsigned long epoch = 0;
    a = 0;
    if (sscanf(arg, "%lu %d", &epoch, &a) < 1) Serial.println("settime <epoch> <tzmin>");
    else { uiSetTime(epoch, a); Serial.println("time set"); }
  } else if (cmd == "setled") {
    if (sscanf(arg, "%d %d %d %d", &a, &b, &c, &d) != 4 || a < 1 || a > NUM_CELLS) Serial.println("setled <id> <r> <g> <b>");
    else { setColor(cellKey(a, true), b, c, d); uiMarkCell(a - 1); Serial.println("setled ok"); }
  } else if (cmd == "setidle") {
    Serial.println("setidle ok");   // v2.1 key-LED idle animations: this board has no key LEDs
  } else if (cmd == "setbrightness") {
    uiSetBrightness(atoi(arg));
    Serial.printf("brightness %d\n", uiBrightness());
  } else if (cmd == "setdim") {
    uiSetDim(atoi(arg));
    Serial.printf("dim %d\n", atoi(arg));
  } else if (cmd == "ble") {
    cmdBle(arg);
  // ---- debug / test harness ----
  } else if (cmd == "shot") {
    displayShot();
  } else if (cmd == "touch" || cmd == "hold") {
    e = cmd == "touch" ? 80 : 800;
    if (sscanf(arg, "%d %d %d", &a, &b, &e) < 2) Serial.printf("%s <x> <y> [ms]\n", cmd.c_str());
    else { touchInject(a, b, a, b, e); return false; }
  } else if (cmd == "swipe") {
    e = 250;
    if (sscanf(arg, "%d %d %d %d %d", &a, &b, &c, &d, &e) < 4) Serial.println("swipe <x1> <y1> <x2> <y2> [ms]");
    else { touchInject(a, b, c, d, e); return false; }
  } else if (cmd == "hid") {
    if (!strcmp(arg, "dry on")) hidSetDry(true);
    else if (!strcmp(arg, "dry off")) hidSetDry(false);
    uiMarkStatus();
    Serial.printf("hid dry %d connected %d\n", hidDry(), hidConnected());
  } else if (cmd == "heap") {
    Serial.printf("heap free:%u min:%u largest:%u\n", (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMinFreeHeap(), (unsigned)ESP.getMaxAllocHeap());
  } else if (cmd == "log") {
    touchLog(!strcmp(arg, "on"));
    Serial.printf("log %s\n", arg);
  } else if (cmd == "lcd") {
    displayLcdCmd(arg);
  } else if (cmd == "calibrate") {
    touchCalibrate();
  } else {
    Serial.println("unknown");
  }
  return true;
}

// ---------------------------------------------------------------- input
static void handleLine(char *s, size_t n) {
  if (up.on) {
    if (!strcmp(s, "###END###")) uploadFinish();
    else uploadLine(s, n);
    return;
  }
  while (*s == ' ') s++;
  n = strlen(s);
  while (n && s[n - 1] == ' ') s[--n] = 0;
  if (!strncmp(s, "###BEGINB###", 12)) {
    char path[64] = "";
    unsigned size = 0;
    unsigned long crc = 0;
    if (sscanf(s + 12, "%63s %u crc=%8lx", path, &size, &crc) != 3 || size == 0 || size > UPLOAD_MAX) {
      Serial.println("ERR usage: ###BEGINB### <path> <size> crc=<crc32>");
      prompt();
    } else if (!uploadOpen(path, true, size, crc)) prompt();
  } else if (!strncmp(s, "###BEGIN###", 11)) {
    char *t = s + 11;
    while (*t == ' ') t++;
    if (!*t) { Serial.println("Usage: ###BEGIN### filename.json"); prompt(); }
    else if (!uploadOpen(t, false, 0, 0)) prompt();
  } else if (!*s) {
    prompt();
  } else if (runCommand(s)) {
    prompt();
  }
}

void cliBegin() {
  up.on = false;
  lineLen = 0;
  prompt();
}

void handleSerialInput() {
  if (up.on && millis() - up.last > UPLOAD_TIMEOUT_MS) uploadAbort("Upload timed out; discarded.");
  uint32_t t0 = millis();
  while (Serial.available() && millis() - t0 < 25) {   // bounded so touch and drawing stay live
    char ch = Serial.read();
    if (ch == '\r') continue;
    if (ch != '\n') {
      if (lineLen < sizeof line - 1) line[lineLen++] = ch;
      else lineTooLong = true;
      continue;
    }
    line[lineLen] = 0;
    size_t n = lineLen;
    lineLen = 0;
    if (lineTooLong) {
      lineTooLong = false;
      if (up.on) up.failed = true;
      else { Serial.printf("ERR line longer than %d bytes\n", CLI_LINE_MAX - 1); prompt(); }
      continue;
    }
    handleLine(line, n);
  }
}
