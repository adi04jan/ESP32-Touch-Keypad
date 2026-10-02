/* USB serial line CLI (PLAN.md §8, docs/PROTOCOL.md): commands, streamed
   ###BEGIN### / ###BEGINB### uploads, and the debug commands the test
   harness drives (shot, touch, hold, swipe, hid dry, heap). */
#pragma once

void cliBegin();
void handleSerialInput();
