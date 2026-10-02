/* Power: the battery on IO34 (a 2:1 divider ahead of the ADC, TP4054 charger),
   whether USB is present, and the battery-saving policy ui.cpp applies.

   The board has no VBUS pin. USB is read from the USB-serial chip's TX line,
   which idles high only while USB powers that chip (unpowered, it holds the
   ESP32's RX low). On USB the keypad runs at full power; on battery it dims
   sooner, darkens the LED and slows the CPU while the screen is off, and
   deep-sleeps after a few idle minutes (a touch wakes it). */
#pragma once
#include <Arduino.h>

void powerBegin();
void powerTick();                 // samples every 2 s
bool powerOnUsb();
int  powerBatteryPct();           // 0-100, or -1 when there is no battery reading (USB, nothing or a full cell)
int  powerBatteryMv();
bool powerCharging();             // on USB with a battery that is still filling
uint8_t powerSleepMin();          // deep sleep after N idle minutes on battery, 0 = never (NVS kp/bsleep)
void powerSetSleepMin(uint8_t m);
void powerSim(int mode);          // tests: -1 real, 0 battery, 1 USB (RAM only)
int  powerSimMode();
void powerSetDivider(float k);    // calibration: battery mV per ADC mV (NVS kp/batk)
float powerDivider();
void powerSave(bool on);          // screen off on battery: CPU 80 MHz and a dark LED; off again on wake
void powerDeepSleep();            // never returns; a touch (IO36 low) wakes the board
