/* The console: what the CLI and the event stream print goes to USB serial and,
   while a paired host has the Bluetooth console open (ble_hid.cpp, a Nordic UART
   service), to it as well. So Studio can run the keypad with no cable. Print
   from the main loop only. `shot` stays on USB: 410 KB is minutes over the air. */
#pragma once
#include <Arduino.h>

class Console : public Print {
 public:
  size_t write(uint8_t c) override { return write(&c, 1); }
  size_t write(const uint8_t *b, size_t n) override;
  void flush() override;   // pushes a partial Bluetooth line (the prompt has no newline)
};
extern Console Con;
