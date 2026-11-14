/* The spring that page slides and the Media and Settings sheets ride on (the mockup's, see
   docs/superpowers/specs/2026-11-04-motion-and-swipe-up-media-design.md): a damped spring stepped
   with the real frame time, and a flick that projects the release velocity forward. */
#pragma once
#include <math.h>

#define LOCK_PX 18       // a finger that moves this far along one axis has started a drag (a recorded tap rolled 17)
#define FLICK_S 0.18f    // where a release lands: position + velocity x this
#define QUICK_MS 400     // a swipe (touch.cpp's: 44 px up/down, 86 px sideways) done this soon after the touch
                         // goes where it went, wherever the spring would land: a flick gets the drag only a
                         // sample or two (touch is read between frames), too few for its speed

struct Spring { float x, v, to, k, z; bool on; };   // k stiffness, z damping ratio

// Four semi-implicit Euler substeps of a = -k(x - to) - 2z sqrt(k) v. True once it settles within
// eps (and nearly still): x snaps to `to`, v to 0, and it stops.
static inline bool springStep(Spring &s, float dt, float eps) {
  float c = 2 * s.z * sqrtf(s.k), h = dt / 4;
  for (int i = 0; i < 4; i++) { float a = -s.k * (s.x - s.to) - c * s.v; s.v += a * h; s.x += s.v * h; }
  if (fabsf(s.x - s.to) < eps && fabsf(s.v) < 0.02f) { s.x = s.to; s.v = 0; s.on = false; return true; }
  return false;
}

// The whole step a release reaches (rounded), kept within [lo, hi].
static inline float flickTarget(float x, float v, float lo, float hi) {
  float t = roundf(x + v * FLICK_S);
  return t < lo ? lo : t > hi ? hi : t;
}
