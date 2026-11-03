/* LittleFS helpers: atomic write with numbered backups (ported from v2.1). */
#pragma once
#include <Arduino.h>

bool fsBegin();
bool writeFileStr(const char *path, const String &content);
// Write to <path>.tmp, then commitTmp().
bool atomicWrite(const char *path, const uint8_t *data, size_t len);
// Back up the current <path> (when `backup`), then rename <path>.tmp over it.
bool commitTmp(const char *path, bool backup);
extern uint32_t storageCommits;   // counts commits and `rm`s: a view cached from the files is stale once it moves
void catFile(const char *path);   // stream a file to Serial
void listFiles(const char *dir);  // recursive "path\tsize" lines
