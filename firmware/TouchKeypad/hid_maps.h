/* Name <-> HID usage tables (v2.1 names, plus F13-F24 and a US ASCII map). */
#pragma once
#include <Arduino.h>

uint8_t  keyNameToHid(const char *s);        // 0 if not a named key
uint8_t  modifierNameToBit(const char *s);   // boot-report modifier bit, 0 if none
uint16_t mediaNameToCode(const char *s);     // consumer usage, 0 if none
bool     asciiToHid(char c, uint8_t &code, bool &shift);   // US layout
