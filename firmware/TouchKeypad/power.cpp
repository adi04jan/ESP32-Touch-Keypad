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

static int mvNow = 0, pctNow = -1, sim = -1, simMv = 0;
static float mvAvg = 0;
static bool usb = true, saving = false;
static float kDiv = 2.0f;           // the board's 100k/100k divider; a calibration knob
static uint8_t sleepMin = 5;
static uint32_t lastSample = 0, emptyAt = 0, offAt = 0;

// Held through deep sleep, or they float: the backlight and the amp could sit half on.
static const struct { uint8_t pin, level; } HOLD[] = {
  { PIN_LCD_BL, LOW }, { PIN_AMP_EN, HIGH }, { PIN_LED_R, HIGH }, { PIN_LED_G, HIGH }, { PIN_LED_B, HIGH },
  { PIN_LCD_CS, HIGH }, { PIN_TOUCH_CS, HIGH },
};

static int readMv() {
  uint32_t s = 0;
  for (int i = 0; i < 16; i++) s += analogReadMilliVolts(PIN_BAT_ADC);
  return (int)(s / 16 * kDiv);
}

// The CH340's TXD idles high while USB powers it; unpowered it lets go, and the UART's pull-up
// would read high on battery too (measured), so sample RX pulled down. Traffic toggles the
// line, so any high sample in 1 ms counts. On battery the UART reads the low as a break (a NUL).
static bool usbLine() {
  gpio_set_pull_mode(GPIO_NUM_3, GPIO_PULLDOWN_ONLY);
  delay(1);
  bool high = false;
  for (int i = 0; i < 40 && !high; i++) {
    high = gpio_get_level(GPIO_NUM_3);
    delayMicroseconds(25);
  }
  gpio_set_pull_mode(GPIO_NUM_3, GPIO_PULLUP_ONLY);
  return high;
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
  if (sim == 0 && simMv) mvNow = mvAvg = simMv;    // tests: a battery at a chosen voltage
  // On battery the cell is the supply. On USB a reading under 4.25 V is a cell
  // being charged; above it is the charger's open output (no cell) or a full one.
  bool cell = !usb || (mvAvg > 2800 && mvAvg < 4250);
  if (sim == 0 && mvAvg >= 4250) mvAvg = 3950;     // simulated battery on a USB-only bench
  int pct = cell ? toPct((int)mvAvg) : -1;
  // On battery the charge only falls: a lit screen sags the cell, and the
  // reading must not climb back when the screen goes dark.
  // ponytail: reads a few % low while lit; compensating needs the cell's internal resistance (measure a real cell)
  if (!usb && !wasUsb && wasPct >= 0 && pct > wasPct) pct = wasPct;
  pctNow = pct;
  if (usb) emptyAt = 0;
  else if (pct == 0 && !emptyAt) {                 // 3.30 V, spent: say so, then sleep (a touch wakes it to say so again)
    emptyAt = millis() | 1;
    Con.println("EVT:POWER empty");
    uiWake();
    uiNotify("Keypad", "Battery empty", "Plug in USB to charge", "battery-low", "battery");
  }
  if (usb != wasUsb) uiPowerChanged();
  if (usb != wasUsb || pctNow != wasPct) {
    uiMarkStatus();
    bleSetBattery(pctNow < 0 ? 100 : pctNow);
  }
}

void powerUnhold() {
  gpio_deep_sleep_hold_dis();
  for (auto &h : HOLD) gpio_hold_dis((gpio_num_t)h.pin);
}

void powerBegin() {
  esp_sleep_wakeup_cause_t w = esp_sleep_get_wakeup_cause();
  if (w == ESP_SLEEP_WAKEUP_EXT0 || w == ESP_SLEEP_WAKEUP_TIMER)
    Con.printf("EVT:POWER wake %s\n", w == ESP_SLEEP_WAKEUP_EXT0 ? "touch" : "timer");
  analogSetPinAttenuation(PIN_BAT_ADC, ADC_11db);
  Preferences p;
  p.begin("kp", true);
  sleepMin = p.getUChar("bsleep", 5);
  kDiv = p.getFloat("batk", 2.0f);
  p.end();
  sample();
}

void powerTick() {
  // signed: both are millis() | 1, a millisecond ahead half the time, and delay(1) can return within it
  if (emptyAt && (int32_t)(millis() - emptyAt) > 5000) powerDeepSleep();   // the banner has had its moment
  if (offAt && (int32_t)(millis() - offAt) > 2000) powerDeepSleep(0, false);
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
  pctNow = -1;                                       // a fresh reading, free to rise
  sample();
}

void powerSim(int mode, int mv) {
  mode = mode < -1 || mode > 1 ? -1 : mode;
  if (mode != sim) pctNow = -1;                      // a new source starts a fresh reading
  sim = mode;
  simMv = mode == 0 ? mv : 0;
  mvAvg = 0;
  sample();
}

void powerSave(bool on) {
  if (on == saving) return;
  saving = on;
  setCpuFrequencyMhz(on ? 80 : 240);
  ledsDark(on);
}
bool powerSaving() { return saving; }

void powerOff() {
  if (offAt) return;
  offAt = millis() | 1;
  uiWake();
  uiNotify("Keypad", "Turned off", "Press RESET to turn it on", "power", "power");
}

void powerDeepSleep(uint32_t wakeS, bool touchWakes) {
  Con.println("EVT:POWER sleep");
  Con.flush(); Serial.flush();
  displaySetBacklight(0);                            // the panel sleeps with it
  dacDisable(PIN_DAC);                               // the click's DAC idles at mid-scale otherwise
  for (auto &h : HOLD) {                             // pinMode also detaches the LEDs' PWM
    pinMode(h.pin, OUTPUT);
    digitalWrite(h.pin, h.level);
    gpio_hold_en((gpio_num_t)h.pin);
  }
  gpio_deep_sleep_hold_en();
  if (touchWakes) esp_sleep_enable_ext0_wakeup(GPIO_NUM_36, 0);   // the touch controller's IRQ goes low on a touch
  else esp_sleep_pd_config(ESP_PD_DOMAIN_RTC_PERIPH, ESP_PD_OPTION_ON);   // as a touch wake keeps it: the held pins measured at 0.20 mA
  if (wakeS) esp_sleep_enable_timer_wakeup(wakeS * 1000000ULL);
  esp_deep_sleep_start();
}
