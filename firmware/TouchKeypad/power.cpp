#include "power.h"
#include "board.h"
#include "console.h"
#include "display.h"
#include "ui.h"
#include "leds.h"
#include "ble_hid.h"
#include <Preferences.h>
#include <driver/gpio.h>
#include <esp_sleep.h>

static int mvNow = 0, pctNow = -1, sim = -1;
static float mvAvg = 0;
static bool usb = true, saving = false;
static float kDiv = 2.0f;           // the board's 100k/100k divider; a calibration knob
static uint8_t sleepMin = 5;
static uint32_t lastSample = 0;

static int readMv() {
  uint32_t s = 0;
  for (int i = 0; i < 16; i++) s += analogReadMilliVolts(PIN_BAT_ADC);
  return (int)(s / 16 * kDiv);
}

// The CH340's TXD idles high while USB powers it; unpowered it holds our RX low.
// Traffic toggles the line, so any high sample in 1 ms counts.
static bool usbLine() {
  for (int i = 0; i < 40; i++) {
    if (gpio_get_level(GPIO_NUM_3)) return true;
    delayMicroseconds(25);
  }
  return false;
}

// Resting Li-ion curve (mV -> %), interpolated.
static int toPct(int mv) {
  static const int16_t V[] = { 3300, 3500, 3600, 3650, 3700, 3750, 3800, 3900, 4000, 4100, 4180 };
  static const uint8_t P[] = { 0, 5, 12, 20, 30, 42, 52, 65, 78, 90, 100 };
  if (mv <= V[0]) return 0;
  for (int i = 1; i < 11; i++)
    if (mv < V[i]) return P[i - 1] + (P[i] - P[i - 1]) * (mv - V[i - 1]) / (V[i] - V[i - 1]);
  return 100;
}

static void sample() {
  bool wasUsb = usb;
  int wasPct = pctNow;
  mvNow = readMv();
  mvAvg = mvAvg ? mvAvg * 0.75f + mvNow * 0.25f : mvNow;
  usb = sim >= 0 ? sim == 1 : usbLine();
  // On battery the cell is the supply. On USB a reading under 4.25 V is a cell
  // being charged; above it is the charger's open output (no cell) or a full one.
  bool cell = !usb || (mvAvg > 2800 && mvAvg < 4250);
  if (sim == 0 && mvAvg >= 4250) mvAvg = 3950;     // simulated battery on a USB-only bench
  pctNow = cell ? toPct((int)mvAvg) : -1;
  if (usb != wasUsb) uiPowerChanged();
  if (usb != wasUsb || pctNow != wasPct) {
    uiMarkStatus();
    bleSetBattery(pctNow < 0 ? 100 : pctNow);
  }
}

void powerBegin() {
  analogSetPinAttenuation(PIN_BAT_ADC, ADC_11db);
  Preferences p;
  p.begin("kp", true);
  sleepMin = p.getUChar("bsleep", 5);
  kDiv = p.getFloat("batk", 2.0f);
  p.end();
  sample();
}

void powerTick() {
  if (millis() - lastSample < 2000) return;
  lastSample = millis();
  sample();
}

bool powerOnUsb() { return usb; }
int powerBatteryPct() { return pctNow; }
int powerBatteryMv() { return mvNow; }
bool powerCharging() { return usb && pctNow >= 0 && pctNow < 100; }
uint8_t powerSleepMin() { return sleepMin; }
int powerSimMode() { return sim; }
float powerDivider() { return kDiv; }

void powerSetSleepMin(uint8_t m) {
  sleepMin = m;
  Preferences p;
  p.begin("kp", false);
  p.putUChar("bsleep", m);
  p.end();
}

void powerSetDivider(float k) {
  if (k < 1 || k > 4) return;
  kDiv = k;
  Preferences p;
  p.begin("kp", false);
  p.putFloat("batk", k);
  p.end();
  mvAvg = 0;
  sample();
}

void powerSim(int mode) {
  sim = mode < -1 || mode > 1 ? -1 : mode;
  mvAvg = 0;
  sample();
}

void powerSave(bool on) {
  if (on == saving) return;
  saving = on;
  setCpuFrequencyMhz(on ? 80 : 240);
  ledsDark(on);
}

void powerDeepSleep() {
  Con.println("EVT:POWER sleep");
  Con.flush(); Serial.flush();
  ledsDark(true);
  ledsTick();
  digitalWrite(PIN_AMP_EN, HIGH);                    // amp off
  displaySetBacklight(0);
  lcd.sleep();
  esp_sleep_enable_ext0_wakeup(GPIO_NUM_36, 0);      // the touch controller's IRQ goes low on a touch
  esp_deep_sleep_start();
}
