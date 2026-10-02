#include "console.h"
#include "ble_hid.h"

Console Con;

size_t Console::write(const uint8_t *b, size_t n) {
  Serial.write(b, n);
  bleConsoleWrite(b, n);
  return n;
}

void Console::flush() { bleConsoleFlush(); }
