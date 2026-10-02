#include "profiles.h"
#include "board.h"
#include "storage.h"
#include <LittleFS.h>
#include <Preferences.h>
#include <vector>
#include <algorithm>
#include "defaults_gen.h"
#include "esp_rom_crc.h"

JsonDocument pageDoc;
bool profileLoaded = false;
int  currentProfile = 1;
int  currentPage = 0;
int  pageCount = 1;
int  profileDelay = 20;
int  profileBrightness = -1;
char profileName[32] = "";
uint8_t profileColor[3] = { 79, 140, 255 };

static const auto NEST = DeserializationOption::NestingLimit(24);

static String profilePath(int id) { return "/profile" + String(id) + ".json"; }

bool isProfilePath(const char *path, int *id) {
  int n = 0;
  char tail[8] = "";
  if (sscanf(path, "/profile%d.%7s", &n, tail) != 2 || strcmp(tail, "json") || n < 1 || n > NUM_PROFILES) return false;
  if (id) *id = n;
  return true;
}

static bool writeDefault(int id) {
  if (id <= DEFAULT_PROFILE_COUNT) return writeFileStr(profilePath(id).c_str(), FPSTR(DEFAULT_PROFILES[id - 1]));
  String s = "{\"schema_version\":2,\"profile_name\":\"Profile " + String(id) +
             "\",\"color\":[138,152,171],\"default_delay\":20,\"pages\":[{\"name\":\"Main\",\"keys\":[";
  for (int i = 0; i < NUM_CELLS; i++) s += i ? ",null" : "null";
  s += "]}]}";
  return writeFileStr(profilePath(id).c_str(), s);
}

static uint32_t fileCrc(const String &path) {
  File f = LittleFS.open(path, "r");
  if (!f) return 0;
  uint32_t crc = 0;
  uint8_t buf[256];
  while (f.available()) { int n = f.read(buf, sizeof buf); crc = esp_rom_crc32_le(crc, buf, n); }
  f.close();
  return crc;
}

// The shipped profiles go in on the first boot of this firmware family. A
// later firmware with changed defaults replaces a default profile only if
// the file is still the one it installed, so a user's edits are never lost.
void profilesInstallDefaults() {
  Preferences p;
  p.begin("kp", false);
  bool first = !p.isKey("defv");
  bool changed = p.getUInt("defv", 0) != DEFAULTS_VERSION;
  for (int id = 1; changed && id <= DEFAULT_PROFILE_COUNT; id++) {
    String path = profilePath(id), key = "dcrc" + String(id);
    if (!first && LittleFS.exists(path) && fileCrc(path) != p.getUInt(key.c_str(), 0)) continue;
    if (writeDefault(id)) { p.putUInt(key.c_str(), fileCrc(path)); Serial.printf("Installed default profile %d\n", id); }
  }
  if (changed) p.putUInt("defv", DEFAULTS_VERSION);
  p.end();
}

// v1 (keys[12], no pages) -> v2: the keys become page 1, padded to 15 cells.
static bool migrateV1(const String &path, JsonDocument &v1) {
  JsonDocument v2;
  v2["schema_version"] = SCHEMA_VERSION;
  v2["profile_name"] = v1["profile_name"] | "Profile";
  v2["default_delay"] = v1["default_delay"] | 30;
  if (!v1["brightness"].isNull()) v2["brightness"] = v1["brightness"];
  JsonObject pg = v2["pages"].add<JsonObject>();
  pg["name"] = "Main";
  JsonArray cells = pg["keys"].to<JsonArray>();
  for (int i = 0; i < NUM_CELLS; i++) cells.add(nullptr);
  for (JsonObject k : v1["keys"].as<JsonArray>()) {
    int id = k["id"] | 0;
    if (id >= 1 && id <= NUM_CELLS) cells[id - 1].set(k);
  }
  String out;
  serializeJson(v2, out);
  Serial.printf("Migrated %s schema v1 -> v2\n", path.c_str());
  return writeFileStr(path.c_str(), out);
}

bool loadProfile(int id) {
  if (id < 1 || id > NUM_PROFILES) return false;
  String path = profilePath(id);
  if (!LittleFS.exists(path)) writeDefault(id);

  JsonDocument filter, meta;
  filter["schema_version"] = true;
  filter["profile_name"] = true;
  filter["default_delay"] = true;
  filter["brightness"] = true;
  filter["color"] = true;
  filter["pages"][0]["name"] = true;
  filter["keys"] = true;   // v1 files only (small)
  File f = LittleFS.open(path, "r");
  if (!f) return false;
  f.setTimeout(0);
  DeserializationError err = deserializeJson(meta, f, DeserializationOption::Filter(filter), NEST);
  f.close();
  if (err) {
    Serial.printf("Profile %d parse error: %s\n", id, err.c_str());
    return false;
  }
  if ((meta["schema_version"] | 1) < 2 && meta["keys"].is<JsonArray>()) {
    if (!migrateV1(path, meta)) return false;
    return loadProfile(id);
  }
  JsonArray pages = meta["pages"];
  if (pages.isNull() || pages.size() == 0) {
    Serial.printf("Profile %d has no pages\n", id);
    return false;
  }
  currentProfile = id;
  pageCount = min((int)pages.size(), MAX_PAGES);
  profileDelay = meta["default_delay"] | 20;
  profileBrightness = meta["brightness"] | -1;
  strlcpy(profileName, meta["profile_name"] | "Profile", sizeof profileName);
  profileColor[0] = meta["color"][0] | 79;
  profileColor[1] = meta["color"][1] | 140;
  profileColor[2] = meta["color"][2] | 255;
  if (!loadPage(0)) return false;
  profileLoaded = true;

  Preferences p;
  p.begin("kp", false);
  if (p.getUChar("prof", 1) != id) p.putUChar("prof", id);
  p.end();
  Serial.printf("Loaded profile %d (%s)\n", id, profileName);
  Serial.printf("EVT:PROFILE %d\n", id);
  return true;
}

bool loadProfileSafe(int id) {
  if (loadProfile(id)) return true;
  Serial.printf("Profile %d unreadable; restoring default.\n", id);
  writeDefault(id);
  if (loadProfile(id)) return true;
  profileLoaded = false;
  return false;
}

// Leave `f` just past the '[' of the top-level "pages" array. Tracks strings
// and depth so "pages" inside a string or a nested object can't fool it.
static bool seekPages(File &f) {
  int depth = 0, klen = 0;
  bool inStr = false, esc = false, keyIsPages = false, afterColon = false;
  char key[6];
  while (f.available()) {
    char c = f.read();
    if (inStr) {
      if (esc) esc = false;
      else if (c == '\\') esc = true;
      else if (c == '"') { inStr = false; keyIsPages = depth == 1 && klen == 5 && !memcmp(key, "pages", 5); }
      else { if (klen < 6) key[klen] = c; klen++; }
      continue;
    }
    if (c == '"') { inStr = true; klen = 0; afterColon = false; }
    else if (c == ':') afterColon = depth == 1 && keyIsPages;
    else if (c == '{' || c == '[') {
      if (c == '[' && depth == 1 && afterColon) return true;
      depth++;
      afterColon = keyIsPages = false;
    } else if (c == '}' || c == ']') depth--;
    else if (c == ',') afterColon = keyIsPages = false;
  }
  return false;
}

bool loadPage(int idx) {
  if (idx < 0 || idx >= pageCount) return false;
  File f = LittleFS.open(profilePath(currentProfile), "r");
  if (!f) return false;
  f.setTimeout(0);
  bool ok = seekPages(f);
  JsonDocument skip;
  skip.set(false);
  for (int i = 0; ok && i <= idx; i++) {
    DeserializationError e = i == idx ? deserializeJson(pageDoc, f, NEST)
                                      : deserializeJson(pageDoc, f, DeserializationOption::Filter(skip), NEST);
    ok = !e && (i == idx || f.findUntil((char *)",", (char *)"]"));
  }
  f.close();
  if (!ok || !pageDoc.is<JsonObject>()) {
    Serial.printf("Page %d of profile %d unreadable\n", idx + 1, currentProfile);
    pageDoc.clear();
    return false;
  }
  if (!pageDoc["keys"].is<JsonArray>()) pageDoc["keys"].to<JsonArray>();
  JsonArray keys = pageDoc["keys"];
  while (keys.size() < NUM_CELLS) keys.add(nullptr);
  currentPage = idx;
  return true;
}

bool validateProfile(const char *path, String &err) {
  JsonDocument filter, doc;
  filter["schema_version"] = true;
  filter["pages"][0]["keys"][0]["id"] = true;
  filter["keys"][0]["id"] = true;
  File f = LittleFS.open(path, "r");
  if (!f) { err = "cannot open"; return false; }
  f.setTimeout(0);
  DeserializationError e = deserializeJson(doc, f, DeserializationOption::Filter(filter), NEST);
  f.close();
  if (e) { err = String("invalid JSON (") + e.c_str() + ")"; return false; }
  if (!doc.is<JsonObject>()) { err = "invalid profile (not an object)"; return false; }
  int ver = doc["schema_version"] | 1;
  if (ver == 1) {
    if (!doc["keys"].is<JsonArray>()) { err = "invalid profile (v1 needs keys[])"; return false; }
    return true;
  }
  if (ver != 2) { err = "invalid profile (schema_version must be 1 or 2)"; return false; }
  JsonArray pages = doc["pages"];
  if (pages.isNull() || pages.size() < 1 || pages.size() > MAX_PAGES) { err = "invalid profile (pages[] must have 1-16 pages)"; return false; }
  for (JsonVariant pg : pages) {
    JsonArray keys = pg["keys"];
    if (!pg.is<JsonObject>() || keys.isNull() || keys.size() > NUM_CELLS) { err = "invalid profile (each page needs keys[] of up to 15 cells)"; return false; }
  }
  return true;
}

void gcTiles() {
  std::vector<String> keep;
  JsonDocument filter;
  filter["pages"][0]["keys"][0]["tile"] = true;
  for (int n = 1; n <= NUM_PROFILES; n++) {
    File f = LittleFS.open(profilePath(n), "r");
    if (!f) continue;
    f.setTimeout(0);
    JsonDocument doc;
    DeserializationError e = deserializeJson(doc, f, DeserializationOption::Filter(filter), NEST);
    f.close();
    if (e) return;   // can't tell what is referenced: delete nothing
    for (JsonObject pg : doc["pages"].as<JsonArray>())
      for (JsonVariant k : pg["keys"].as<JsonArray>())
        if (const char *t = k["tile"]) keep.push_back(String(t) + ".565");
  }
  std::vector<String> del;
  File dir = LittleFS.open("/t");
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    String nm = f.name();
    if (!nm.endsWith(".tmp") && std::find(keep.begin(), keep.end(), nm) == keep.end()) del.push_back(nm);
  }
  dir.close();
  for (auto &nm : del) LittleFS.remove("/t/" + nm);
  if (!del.empty()) Serial.printf("Removed %u unreferenced tiles\n", (unsigned)del.size());
}

// Name, page count and colour of a slot without loading it (the settings sheet).
bool profileMeta(int id, char *name, size_t len, int *pages, uint8_t col[3]) {
  File f = LittleFS.open(profilePath(id), "r");
  if (!f) return false;
  f.setTimeout(0);
  JsonDocument filter, doc;
  filter["profile_name"] = true;
  filter["color"] = true;
  filter["pages"][0]["name"] = true;
  DeserializationError e = deserializeJson(doc, f, DeserializationOption::Filter(filter), NEST);
  f.close();
  if (e) return false;
  strlcpy(name, doc["profile_name"] | "Profile", len);
  *pages = doc["pages"].size();
  for (int i = 0; i < 3; i++) col[i] = doc["color"][i] | 138;
  return true;
}
