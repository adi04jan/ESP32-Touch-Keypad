#include "cli.h"
#include "board.h"
#include "storage.h"
#include "profiles.h"
#include "ui.h"
#include "touch.h"
#include "display.h"
#include "ble_hid.h"
#include "leds.h"
#include <ArduinoJson.h>
#include <LittleFS.h>
#include "mbedtls/base64.h"
#include "esp_rom_crc.h"

static char line[CLI_LINE_MAX];
static size_t lineLen = 0;
static bool lineTooLong = false;

// Uploads collect in RAM and touch flash only after ###END###: this core's UART
// ISR is not in IRAM, so a flash erase mid-stream overflows the 128-byte RX FIFO
// and drops bytes. The host waits for the reply, so nothing arrives during the write.
static struct {
  bool on, bin;
  char path[64];
  uint8_t *buf;
  size_t size, cap, want;
  uint32_t crc, wantCrc, last;
  bool failed, tooBig, art;
} up;

bool cliUploading() { return up.on; }

static void prompt() { Serial.print("macropad:$ "); }

static void normPath(const char *in, char *out, size_t n) {
  snprintf(out, n, "%s%s", *in == '/' ? "" : "/", in);
}

// ---------------------------------------------------------------- uploads
static bool uploadOpen(const char *path, bool bin, size_t want, uint32_t crc) {
  normPath(path, up.path, sizeof up.path);
  if (strstr(up.path, "..") || strlen(path) > 56) { Serial.println("ERR bad path"); return false; }
  up.cap = bin ? want : 8192;
  up.art = bin && !strcmp(up.path, "/ram:art");   // album art goes straight to the player's buffer
  up.buf = up.art ? uiArtBuffer(want) : (uint8_t *)malloc(up.cap);
  if (!up.buf) { Serial.printf("ERR no RAM for %u bytes\n", (unsigned)up.cap); return false; }
  up.on = true;
  up.bin = bin;
  up.size = 0;
  up.want = want;
  up.crc = 0;
  up.wantCrc = crc;
  up.failed = up.tooBig = false;
  up.last = millis();
  Serial.printf("RECV %s\n", up.path);
  return true;
}

static void uploadEnd() {
  if (!up.art) free(up.buf);
  up.buf = nullptr;
  up.on = false;
}

static bool append(const uint8_t *d, size_t n) {
  if (up.size + n > up.cap) {
    size_t cap = up.cap;
    while (cap < up.size + n) cap *= 2;
    if (cap > UPLOAD_MAX) cap = UPLOAD_MAX;
    uint8_t *nb = up.size + n <= cap ? (uint8_t *)realloc(up.buf, cap) : nullptr;
    if (!nb) return false;
    up.buf = nb;
    up.cap = cap;
  }
  memcpy(up.buf + up.size, d, n);
  up.size += n;
  return true;
}

static bool writeTmp(const String &tmp) {
  File f = LittleFS.open(tmp, "w", true);
  bool ok = f && f.write(up.buf, up.size) == up.size;
  f.close();
  if (!ok) LittleFS.remove(tmp);
  return ok;
}

static void uploadAbort(const char *why) {
  uploadEnd();
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
    if (mbedtls_base64_decode(out, sizeof out, &got, (const uint8_t *)s, n) != 0 || !append(out, got)) { up.failed = true; return; }
    up.crc = esp_rom_crc32_le(up.crc, out, got);
  } else {
    s[n] = '\n';   // the line buffer always has room for it
    up.tooBig = up.size + n + 1 > UPLOAD_MAX;
    if (up.tooBig || !append((const uint8_t *)s, n + 1)) up.failed = true;
  }
}

static void uploadFinish() {
  String tmp = String(up.path) + ".tmp";
  if (up.art) {
    bool ok = !up.failed && up.size == up.want && up.crc == up.wantCrc;
    uiArtDone(ok);
    if (ok) Serial.println("SAVED ram:art");
    else Serial.printf("ERR art %u of %u bytes, crc %08lx\n", (unsigned)up.size, (unsigned)up.want, (unsigned long)up.crc);
    uploadEnd();
    prompt();
    return;
  }
  if (up.bin) {
    if (up.failed || up.size != up.want) Serial.printf("ERR size mismatch %u != %u\n", (unsigned)up.size, (unsigned)up.want);
    else if (up.crc != up.wantCrc) Serial.printf("ERR crc mismatch %08lx != %08lx\n", (unsigned long)up.crc, (unsigned long)up.wantCrc);
    else if (!writeTmp(tmp) || !commitTmp(up.path, false)) Serial.printf("ERR cannot save %s\n", up.path);
    else { Serial.printf("SAVED %s\n", up.path); uiMarkAll(); }
    uploadEnd();
    prompt();
    return;
  }
  if (up.failed) {
    Serial.println(up.tooBig ? "Upload too large; discarded." : "ERR out of RAM");
    uploadEnd();
    prompt();
    return;
  }
  size_t size = up.size;
  bool written = writeTmp(tmp);
  uploadEnd();
  if (!written) { Serial.printf("ERR cannot write %s\n", tmp.c_str()); prompt(); return; }

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
  Serial.printf("SAVED %s %u\n", up.path + 1, (unsigned)size);
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
  else if (sscanf(arg, "use %d", &n) == 1) Serial.println(bleUse(n) ? "using " + String(n) : "ERR no host " + String(n));
  else Serial.println("ble list | ble forget <n> | ble use <n> | ble pair | ble cancel");
}

static void cmdTouchcal(const char *arg) {
  float m[6];
  if (!strncmp(arg, "set", 3) && sscanf(arg + 3, "%f %f %f %f %f %f", &m[0], &m[1], &m[2], &m[3], &m[4], &m[5]) == 6) touchSetCal(m, true);
  else if (!strcmp(arg, "clear")) touchClearCal();
  else if (*arg) { Serial.println("touchcal | touchcal set <a b c d e f> | touchcal clear"); return; }
  touchGetCal(m);
  Serial.printf("cal:%d %.6f %.6f %.3f %.6f %.6f %.3f\n", touchCalibrated(), m[0], m[1], m[2], m[3], m[4], m[5]);
}

static void cmdLed(const char *arg) {
  char name[12] = "";
  int r, g, b;
  int n = sscanf(arg, "%11s %d %d %d", name, &r, &g, &b);
  int p = n >= 1 ? ledsPatternFromName(name) : -2;
  if (p == -1) { Serial.println("led rainbow|breathe|solid|status|off [r g b]"); return; }
  if (p >= 0) ledsSetPattern(p);
  if (n == 4) ledsSetColor(constrain(r, 0, 255), constrain(g, 0, 255), constrain(b, 0, 255));
  uint8_t c[3], now[3];
  ledsGetColor(c);
  ledsCurrent(now);
  uiMarkAll();
  Serial.printf("led %s color %d %d %d brightness %d showing %d %d %d\n", ledsPatternName(ledsPattern()), c[0], c[1], c[2],
                ledsBrightness(), now[0], now[1], now[2]);
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
    Serial.printf("Profile:%d loaded:%d idle:0 mode:ble ver:%s model:touch page:%d ble:%d pages:%d dry:%d ui:%s cal:%d theme:%s\n",
                  currentProfile, profileLoaded, FW_VERSION, currentPage + 1, hidConnected() ? 1 : 0, pageCount, hidDry() ? 1 : 0,
                  uiModeName(), touchCalibrated() ? 1 : 0, uiThemeId(uiTheme()));
  } else if (cmd == "ls") {
    listFiles(*arg ? arg : "/");
  } else if (cmd == "cat") {
    char p[64];
    normPath(arg, p, sizeof p);
    if (!*arg) Serial.println("cat <file>"); else catFile(p);
  } else if (cmd == "rm") {
    char p[64];
    normPath(arg, p, sizeof p);
    if (!*arg || strstr(p, "..")) Serial.println("rm <file>");
    else if (!LittleFS.exists(p) || LittleFS.open(p).isDirectory()) Serial.printf("ERR no such file: %s\n", p);
    else { LittleFS.remove(p); Serial.printf("removed %s\n", p); if (isProfilePath(p)) gcTiles(); }
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
      else if (name == "volume") uiVolume(doc.as<JsonObjectConst>());
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
    if (*arg) uiSetBrightness(atoi(arg));   // no argument: just report
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
  } else if (cmd == "bench") {
    displayBench();
  } else if (cmd == "calibrate") {
    if (!strcmp(arg, "cancel")) uiCalibrateCancel(); else uiCalibrate();
    Serial.printf("ui %s\n", uiModeName());
  } else if (cmd == "touchcal") {
    cmdTouchcal(arg);
  } else if (cmd == "traw") {
    e = 120;
    if (sscanf(arg, "%d %d %d", &a, &b, &e) < 2) Serial.println("traw <rx> <ry> [ms]");
    else { touchInjectRaw(a, b, e); return false; }
  } else if (cmd == "perf") {
    uiPerf(!strcmp(arg, "reset"));
  } else if (cmd == "rbench") {
    uiRenderBench();
    uiMarkAll();
  } else if (cmd == "led") {
    cmdLed(arg);
  } else if (cmd == "ledbright") {
    if (*arg) ledsSetBrightness(constrain(atoi(arg), 0, 255));
    Serial.printf("ledbright %d\n", ledsBrightness());
  } else if (cmd == "theme") {
    if (!strcmp(arg, "default")) uiThemeReset();
    int t = *arg && strcmp(arg, "default") ? uiThemeFind(arg) : uiTheme();
    if (t < 0) {
      Serial.print("theme");
      for (int i = 0; i < uiThemeCount(); i++) Serial.printf(" %s", uiThemeId(i));
      Serial.println();
    } else {
      if (*arg) uiSetTheme(t);
      Serial.printf("theme %s\n", uiThemeId(t));
    }
  } else if (cmd == "click") {
    if (*arg) feedbackSetClick(!strcmp(arg, "on"));
    Serial.printf("click %s\n", feedbackClickOn() ? "on" : "off");
  } else if (cmd == "hostname") {
    if (!*arg) Serial.println("hostname <name>");
    else Serial.println(bleSetHostName(arg) ? "hostname set" : "ERR no host connected");
  } else if (cmd == "toast") {
    uiToast(arg);
    Serial.println("toast");
  } else if (cmd == "sheet") {
    if (!strcmp(arg, "close")) uiCloseSheet(); else uiOpenSheet();
    Serial.printf("ui %s\n", uiModeName());
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
      if (up.on) up.failed = true;   // a line longer than CLI_LINE_MAX: the upload is corrupt
      else { Serial.printf("ERR line longer than %d bytes\n", CLI_LINE_MAX - 1); prompt(); }
      continue;
    }
    handleLine(line, n);
  }
}
