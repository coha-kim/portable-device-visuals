// The one button on Harvey Pocket, on GPIO 0 (the board's BOOT button, or pin 12 of the 12-pin header to
// ground). Pressing is holding; three quick presses reset to baseline; ten minutes without button activity
// sleeps, and the press that wakes does nothing else. Movement and touch don't count as activity.
#pragma once
#include <stdint.h>

constexpr int BUTTON_PIN = 0;
constexpr int64_t DEBOUNCE_MICROS = 20000, TRIPLE_MICROS = 500000, SLEEP_MICROS = 600000000;   // TRIPLE: press to press

struct PocketButton {
  bool held = false, asleep = false, reset = false;   // reset: true for the one update after the third press
  void update(bool pressed, int64_t now) {
    reset = false;
    if (pressed != raw_) { raw_ = pressed; changed_ = now; }
    if (raw_ != down_ && now - changed_ >= DEBOUNCE_MICROS) {
      down_ = raw_; activity_ = now;
      if (down_) press(now); else held = false;
    }
    if (down_) activity_ = now;
    if (now - activity_ >= SLEEP_MICROS) asleep = true;
  }
 private:
  bool raw_ = false, down_ = false;
  int64_t changed_ = 0, activity_ = 0, lastPress_ = 0;
  int presses_ = 0;
  void press(int64_t now) {
    if (asleep) { asleep = false; presses_ = 0; return; }
    presses_ = presses_ && now - lastPress_ <= TRIPLE_MICROS ? presses_ + 1 : 1; lastPress_ = now;
    if (presses_ == 3) { reset = true; presses_ = 0; return; }
    held = true;
  }
};
