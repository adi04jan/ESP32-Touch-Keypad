#include "macro_engine.h"
#include "ble_hid.h"
#include "hid_maps.h"
#include "leds.h"
#include "profiles.h"
#include "ui.h"

MacroEngine macroEngine;

void MacroEngine::start(JsonVariantConst key, bool hold, int keyCell) {
  JsonArrayConst acts = key[hold ? "hold_actions" : "actions"].as<JsonArrayConst>();
  if (acts.isNull() || acts.size() == 0) return;
  abort();
  macroDoc.clear();
  macroDoc.set(acts);   // private copy: setkey/page loads can't pull it from under us
  depth = 0;
  stack[depth++] = { macroDoc.as<JsonArrayConst>(), 0, 0 };
  waitUntil = 0;
  inText = false;
  textPos = 0;
  defaultDelay = profileDelay;
  cell = keyCell;
  dropped = false;
  running = true;
}

void MacroEngine::tick() {
  if (!running) return;
  unsigned long now = millis();
  if ((long)(now - waitUntil) < 0) return;

  if (inText) {
    if (textPos < curText.length()) {
      if (!hidTypeChar(curText[textPos++])) dropped = true;
      waitUntil = now + TEXT_CHAR_DELAY_MS;
    } else {
      inText = false;
      waitUntil = now + defaultDelay;
    }
    return;
  }

  if (depth == 0) { finish(); return; }

  Frame &f = stack[depth - 1];
  if (f.idx >= f.arr.size()) {
    if (f.repeatLeft > 0) { f.repeatLeft--; f.idx = 0; }
    else depth--;
    return;
  }
  JsonObjectConst act = f.arr[f.idx].as<JsonObjectConst>();
  f.idx++;
  execAction(act, now);
}

void MacroEngine::execAction(JsonObjectConst act, unsigned long now) {
  const char *type = act["type"] | "";
  waitUntil = now + defaultDelay;
  bool ok = true;

  if (!*type || !strcmp(type, "comment")) return;

  if (!strcmp(type, "delay")) {
    int ms = act["ms"] | 0;
    waitUntil = now + (ms < 0 ? 0 : ms);
  } else if (!strcmp(type, "key")) {
    ok = hidPressKey(act["value"] | "");
  } else if (!strcmp(type, "keycombo")) {
    JsonArrayConst keys = act["keys"].as<JsonArrayConst>();
    if (!keys.isNull()) ok = hidSendKeyCombo(keys);
  } else if (!strcmp(type, "text") || !strcmp(type, "multiline")) {
    curText = (const char *)(act["value"] | "");
    if (curText.length() > MAX_TEXT_LEN) curText = curText.substring(0, MAX_TEXT_LEN);
    textPos = 0;
    inText = true;
    waitUntil = now;
  } else if (!strcmp(type, "hold")) {
    ok = hidHold(act["key"] | (act["value"] | ""));
  } else if (!strcmp(type, "release")) {
    hidReleaseAll();
  } else if (!strcmp(type, "repeat")) {
    int count = constrain((int)(act["count"] | 1), 1, MAX_REPEAT_COUNT);
    JsonArrayConst inner = act["actions"].as<JsonArrayConst>();
    if (!inner.isNull() && depth < MACRO_MAX_DEPTH) stack[depth++] = { inner, 0, count - 1 };
  } else if (!strcmp(type, "media")) {
    ok = hidSendMedia(mediaNameToCode(act["value"] | ""));
  } else if (!strcmp(type, "mouse_move")) {
    ok = hidMouseMove(act["x"] | 0, act["y"] | 0, act["wheel"] | 0);
  } else if (!strcmp(type, "mouse_click")) {
    const char *b = act["button"] | "LEFT";
    ok = hidMouseClick(!strcasecmp(b, "RIGHT") ? 2 : !strcasecmp(b, "MIDDLE") ? 4 : 1);
  } else if (!strcmp(type, "led")) {
    JsonArrayConst c = act["color"].as<JsonArrayConst>();
    if (!c.isNull()) ledsTint(c[0] | 0, c[1] | 0, c[2] | 0);
  } else if (!strcmp(type, "led_anim")) {
    const char *a = act["value"] | "";
    JsonArrayConst c = act["color"].as<JsonArrayConst>();
    uint8_t r = c.isNull() ? 255 : (uint8_t)(c[0] | 0), g = c.isNull() ? 255 : (uint8_t)(c[1] | 0),
            b = c.isNull() ? 255 : (uint8_t)(c[2] | 0);
    if (!strcasecmp(a, "flash")) ledsFlash(r, g, b);
    else if (!strcasecmp(a, "breathe")) ledsBreathe(r, g, b);
  } else if (!strcmp(type, "profile")) {
    int p = constrain((int)(act["value"] | 1), 1, NUM_PROFILES);
    finish();
    uiSetProfile(p);
  } else if (!strcmp(type, "telephony")) {
    ok = hidSendTelephony(act["value"] | "");
  } else if (!strcmp(type, "page")) {
    uiGoPage((act["value"] | 1) - 1, true);
  } else if (!strcmp(type, "back")) {
    uiBack();
  } else if (!strcmp(type, "host")) {
    ok = hidHostCombo(act["slot"] | -1);
  } else {
    Serial.printf("Unknown action type '%s'\n", type);
  }
  if (!ok) dropped = true;
}

void MacroEngine::finish() {
  if (!running) return;
  running = false;
  inText = false;
  depth = 0;
  hidReleaseAll();
  if (dropped && cell >= 0) uiFlash(cell, false);   // no host: alert flash (§6.7)
}

void MacroEngine::abort() { finish(); }
