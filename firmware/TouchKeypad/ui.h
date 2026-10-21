/* The screen (firmware/DESIGN.md, mocked in docs/device/index.html): status
   band, glass key grid, page stations, media player, settings sheet, pairing,
   touch calibration, toasts and the volume panel.

   A damage-tracked renderer: any dirty rectangle of the scene is drawn into a
   small chunk buffer and sent by DMA while the next chunk renders. A 60 Hz
   frame clock drives the animations, each of which redraws only its own
   region (press, rings, page pop-in wave, sheet wipe, toast, volume). */
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

enum : uint8_t { G_DOWN, G_HOLD, G_TAP, G_SWIPE_L, G_SWIPE_R, G_SWIPE_U, G_SWIPE_D, G_MOVE };

void uiBegin();
void uiTick();                       // call every loop(); draws at most one frame per 16 ms
void uiMarkAll();
void uiMarkCell(int cell);
void uiMarkStatus();
void uiActivity();                   // resets the dim/off timers
bool uiWake();                       // true if the screen was dimmed/off (that touch is swallowed)
void uiGesture(uint8_t kind, int x0, int y0, int x1, int y1);

void uiGoPage(int idx, bool push);   // emits EVT:PAGE
void uiBack();
void uiSetProfile(int n);            // emits EVT:PROFILE, shows a toast
void uiFlash(int cell, bool ok);     // ok / alert ring on a key
void uiToast(const char *text);
// Autogenerate a profile for the PC's current app (Studio asks Claude). The sheet's
// Generate button sends EVT:AUTOGEN and shows AG_ASK; Studio answers with `autogen`.
enum { AG_ASK, AG_BUSY, AG_DONE, AG_FAIL };
void uiAutogen(int state, const char *text);
void uiSetTime(uint32_t epoch, int tzMin);
void uiNowPlaying(JsonObjectConst o);   // {title, album, artist, app, pos, len, playing}
void uiVolume(JsonObjectConst o);       // {level 0-100, muted}: the volume panel shows the real level
void uiMediaKey(const char *value);     // a media action ran (volume panel, play state)
uint8_t *uiArtBuffer(size_t size);      // album art upload target: 128x128 big-endian RGB565
void uiArtDone(bool ok);
void uiPairShow(uint32_t passkey);
void uiPairClose();
void uiOpenSheet(int tab = -1);         // tab 1 = Profiles (the status band's profile button)
void uiCloseSheet();
bool uiSheetOpen();
// Notifications: the bell in the status band counts the unread, a banner drops in for each new
// one (banner false: kept quietly in the list), the shade lists the newest. Studio sends the PC's
// (`notify`); the keypad adds its own. A tag updates the notification that has it.
void uiNotify(const char *app, const char *title, const char *body, const char *icon, const char *tag = "", bool banner = true);
void uiNotifyClear();
void uiNotifyList();                    // `notify list`
void uiOpenShade();                     // the pull-down: brightness, profile, hosts, notifications
void uiCloseShade();
void uiSetBrightness(int level);     // 0-255, live + NVS
int  uiBrightness();
void uiSetIconMotion(bool on);       // icon animations: on a fired key, a few idle keys at a time, a wave every 20-30 s; NVS kp/ianim
void uiIconWave();                   // `iconanim wave`: run the wave now
bool uiIconMotion();
void uiSetDim(int seconds);          // on battery dim after min(N, 20) s idle (0 = 20); USB stays lit. NVS; wakes the screen
int  uiDim();
void uiSetTheme(int i, bool save = true);   // device theme (themes.h); wipes it in; NVS kp/theme
int  uiTheme();
int  uiThemeCount();
const char *uiThemeId(int i);
int  uiThemeFind(const char *id);    // by id, title or 1-based number; -1 if none
void uiThemeReset();
void uiPowerChanged();
const char *uiScreenState();         // lit | dim | off (tests)               // USB came or went: wake, redraw the status band                 // drop the saved theme: back to the default (Daylight)
void uiCalibrate();                  // touch calibration screen (also on first boot and BOOT held 2 s)
void uiCalibrateCancel();
bool uiCalibrating();
const char *uiModeName();            // home | sheet | pair | cal | shade | menu
void uiPerf(bool reset);             // `perf`: frame timing of animated frames
void uiPerfLog();                    // `perf log`: the latest frames one by one
void uiRenderBench();                // `rbench`: render cost per scene part
