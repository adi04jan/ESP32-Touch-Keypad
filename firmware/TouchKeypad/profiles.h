/* Profile files (schema v2, §7) and the active page.

   Only the page on screen is held in RAM (pageDoc); pages are stream-parsed
   from /profile<n>.json on demand, so a 64 KB profile never sits in the heap.
   v1 files (keys[12]) are migrated to v2 on first load. */
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

#define MAX_PAGES 16

extern JsonDocument pageDoc;   // {"name":..., "keys":[15 cells]}
extern bool profileLoaded;
extern int  currentProfile;    // 1..NUM_PROFILES
extern int  currentPage;       // 0-based
extern int  pageCount;
extern int  profileDelay;      // default_delay
extern int  profileBrightness; // -1 if the profile has none
extern char profileName[32];

bool loadProfile(int id);      // emits EVT:PROFILE
bool loadProfileSafe(int id);  // on failure restore the default and retry
bool loadPage(int idx);
bool validateProfile(const char *path, String &err);   // syntax + shape, low RAM
void gcTiles();                // delete /t files no profile references
bool isProfilePath(const char *path, int *id = nullptr);
