/* The console: what the CLI and the event stream print goes to USB serial and, while a
   paired host has the Bluetooth console open (ble_hid.cpp, a Nordic UART service), to it
   too. So Studio can run the keypad with no cable. A command's reply goes only to the
   link the command came from (conRoute, set by the CLI around each line); events (lines
   starting EVT:) and everything printed outside a command go to both. That keeps two
   hosts from reading each other's replies, and keeps a USB reply from waiting on a slow
   Bluetooth link. Print from the main loop only. `shot` stays on USB: 410 KB is minutes
   over the air. */
#pragma once
#include <Arduino.h>

enum { CON_BOTH, CON_USB, CON_BLE };
void conRoute(uint8_t to);   // CON_BOTH outside a command

class Console : public Print {
 public:
  size_t write(uint8_t c) override { return write(&c, 1); }
  size_t write(const uint8_t *b, size_t n) override;
  void flush() override;   // pushes a partial Bluetooth line (the prompt has no newline)
};
extern Console Con;
