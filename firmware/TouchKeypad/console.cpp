#include "console.h"
#include "ble_hid.h"

Console Con;

static uint8_t route = CON_BOTH;
static bool lineStart = true, evtLine = false;

void conRoute(uint8_t to) { route = to; }

size_t Console::write(const uint8_t *b, size_t n) {
  if (!n) return 0;
  // An event goes to both, even mid-command. Events are printed as one chunk starting "EVT:"
  // (println adds its CRLF as a second chunk, which continues the line); the prompt before
  // them has no newline, so a line-start test would miss them.
  if (n >= 4 && !memcmp(b, "EVT:", 4)) evtLine = true;
  else if (lineStart) evtLine = false;
  bool both = route == CON_BOTH || evtLine;
  if (both || route == CON_USB) Serial.write(b, n);
  if (both || route == CON_BLE) bleConsoleWrite(b, n);
  lineStart = b[n - 1] == '\n';
  return n;
}

void Console::flush() { bleConsoleFlush(); }
