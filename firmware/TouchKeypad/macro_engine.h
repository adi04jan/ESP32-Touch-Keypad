/* Cooperative, non-blocking macro runner (ported from v2.1).

   A press copies the key's actions (or hold_actions) into a private document
   and tick() runs one step per loop pass. Delays are scheduled waits, so the
   screen, touch and serial stay live; a new press aborts the running macro. */
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "board.h"

class MacroEngine {
 public:
  // field overrides actions / hold_actions (toggle keys turning off may use "off_actions").
  void start(JsonVariantConst key, bool hold, int cell, const char *field = nullptr);
  void tick();
  void abort();
  bool isRunning() const { return running; }

 private:
  struct Frame { JsonArrayConst arr; size_t idx; int repeatLeft; };

  void execAction(JsonObjectConst act, unsigned long now);
  void finish();

  bool running = false;
  JsonDocument macroDoc;
  Frame stack[MACRO_MAX_DEPTH];
  int depth = 0;
  unsigned long waitUntil = 0;
  int defaultDelay = 20;
  int cell = -1;
  bool dropped = false;     // an HID action found no host: alert flash at the end

  bool inText = false;
  String curText;
  size_t textPos = 0;
};

extern MacroEngine macroEngine;
