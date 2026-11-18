#include "storage.h"
#include "board.h"
#include "console.h"
#include <LittleFS.h>
#include "esp_rom_crc.h"

bool fsBegin() {
  if (!LittleFS.begin(true)) {
    Con.println("LittleFS mount failed");
    return false;
  }
  if (!LittleFS.exists("/backups")) LittleFS.mkdir("/backups");
  if (!LittleFS.exists("/t")) LittleFS.mkdir("/t");
  return true;
}

bool writeFileStr(const char *path, const String &content) {
  return atomicWrite(path, (const uint8_t *)content.c_str(), content.length());
}

bool atomicWrite(const char *path, const uint8_t *data, size_t len) {
  String tmp = String(path) + ".tmp";
  File f = LittleFS.open(tmp, "w", true);
  if (!f) return false;
  size_t w = f.write(data, len);
  f.close();
  if (w != len) {
    LittleFS.remove(tmp);
    return false;
  }
  return commitTmp(path, true);
}

// Backups are /backups/<base>-<seq>.bak with a zero-padded sequence, so
// lexical order is chronological across reboots; only the newest
// MAX_BACKUPS_PER_FILE survive.
static void backupFile(const char *path) {
  String base = String(path + 1);
  base.replace("/", "_");
  String prefix = base + "-";
  String names[16];
  int n = 0, maxSeq = 0;
  File dir = LittleFS.open("/backups");
  for (File f = dir.openNextFile(); f && n < 16; f = dir.openNextFile()) {
    String nm = f.name();
    if (!nm.startsWith(prefix)) continue;
    names[n++] = nm;
    maxSeq = max(maxSeq, (int)nm.substring(prefix.length()).toInt());
  }
  dir.close();

  char bk[96];
  snprintf(bk, sizeof bk, "/backups/%s%06d.bak", prefix.c_str(), maxSeq + 1);
  File src = LittleFS.open(path, "r"), dst = LittleFS.open(bk, "w");
  uint8_t buf[512];
  while (src && dst && src.available()) dst.write(buf, src.read(buf, sizeof buf));
  src.close();
  dst.close();

  // names[] holds the older backups; keep MAX-1 of them plus the new one.
  for (int i = 0; i < n - 1; i++)
    for (int j = i + 1; j < n; j++)
      if (names[j] < names[i]) { String t = names[i]; names[i] = names[j]; names[j] = t; }
  for (int i = 0; i < n - (MAX_BACKUPS_PER_FILE - 1); i++)
    LittleFS.remove("/backups/" + names[i]);
}

uint32_t storageCommits = 0;

bool commitTmp(const char *path, bool backup) {
  storageCommits++;
  String tmp = String(path) + ".tmp";
  if (backup && LittleFS.exists(path)) backupFile(path);
  return LittleFS.rename(tmp, path);   // LittleFS replaces the old file in one step: no moment without either
}

void catFile(const char *path) {
  File f = LittleFS.open(path, "r");
  if (!f || f.isDirectory()) { Con.printf("ERR no such file: %s\n", path); return; }
  uint8_t buf[256];
  int last = '\n';
  while (f.available()) {
    int n = f.read(buf, sizeof buf);
    Con.write(buf, n);
    if (n > 0) last = buf[n - 1];
  }
  f.close();
  if (last != '\n') Con.println();
}

void listFiles(const char *dir) {
  File d = LittleFS.open(dir);
  if (!d) return;
  // One file: its size and CRC-32. Studio checks a profile read against the size, and skips reading a profile
  // it already holds with that CRC (each one costs the UI ~0.7 s over Bluetooth). The whole list opens every
  // file: ~1.2 s.
  if (!d.isDirectory()) {
    uint32_t crc = 0;
    uint8_t buf[256];
    for (int n; (n = d.read(buf, sizeof buf)) > 0;) crc = esp_rom_crc32_le(crc, buf, n);
    Con.printf("%s\t%u\t%08lx\n", d.path() + 1, (unsigned)d.size(), (unsigned long)crc);
    return;
  }
  for (File f = d.openNextFile(); f; f = d.openNextFile()) {
    String p = String(dir);
    if (!p.endsWith("/")) p += "/";
    p += f.name();
    if (f.isDirectory()) listFiles(p.c_str());
    else Con.printf("%s\t%u\n", p.c_str() + 1, (unsigned)f.size());
  }
}
