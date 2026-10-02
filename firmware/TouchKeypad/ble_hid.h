/* BLE HID over GATT (NimBLE): keyboard ID 1, consumer 2, mouse 3, telephony 8.
   Same call surface as v2.1's hid_layer, so macro_engine barely changes.
   Every send returns true if it reached a host or dry-run is on. */
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

void hidBegin();
bool hidPressKey(const char *name);          // tap a named key, modifier or single char
bool hidTypeChar(char c);                    // US layout
bool hidSendKeyCombo(JsonArrayConst keys);   // modifiers + keys, then release
bool hidHold(const char *name);              // press and keep held
void hidReleaseAll();
bool hidSendMedia(uint16_t usage);
bool hidMouseMove(int x, int y, int wheel);
bool hidMouseClick(uint8_t buttons);         // 1=L 2=R 4=M
bool hidSendTelephony(const char *which);    // MIC_MUTE / ANSWER / DECLINE
bool hidHostCombo(int slot);                 // reserved F13-F24 combo, slot 0-47

bool hidConnected();                         // encrypted host link up
void hidSetDry(bool on);                     // log reports as EVT:HID
bool hidDry();

void blePoll();                              // loop(): events, pairing timeout
void blePairOpen();
void blePairCancel();
bool blePairing();
uint32_t blePasskey();
uint32_t blePairLeftMs();
void bleList();
bool bleForget(int n);
int  bleBondCount();
