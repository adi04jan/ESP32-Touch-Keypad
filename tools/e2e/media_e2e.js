/* Media player end to end, on real hardware and the real Windows media session:
 *   KpHelper media  -> a silent session ("KP Test Track", magenta cover)
 *   Studio feeds    -> widget now_playing + album art to the keypad (services/feeds.js, device.js)
 *   keypad          -> player page shows the cover; a tap on the seek bar emits EVT:SEEK
 *   Studio          -> seeks the session; KpHelper reports the new position.
 * Usage: node tools/e2e/media_e2e.js   (keypad on USB, KP_TEST firmware; nothing is heard: volume 0, silent audio) */
"use strict";
const path = require("path");
const { spawn } = require("child_process");
const studio = path.join(__dirname, "..", "..", "studio", "services");
const { SerialLink } = require(path.join(studio, "serial"));
const { Device } = require(path.join(studio, "device"));
const feeds = require(path.join(studio, "feeds"));

const HELPER = path.join(__dirname, "bin", "KpHelper.exe");
const TITLE = "KP Test Track";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`); await sleep(50); } }
const step = (s) => console.log(`[media] ${s}`);

// One pixel from the keypad's `shot` (base64 RGB565 little-endian lines between ###SHOT### and ###END###).
async function pixel(link, x, y) {
  const reply = await link.command("shot", 30000);
  const lines = reply.split("\n").map((l) => l.trim());
  const head = lines.findIndex((l) => l.startsWith("###SHOT###"));
  const [, w] = lines[head].split(/\s+/).map(Number);
  const b64 = lines.slice(head + 1, lines.indexOf("###END###")).filter((l) => /^[A-Za-z0-9+/=]+$/.test(l)).join("");
  const v = Buffer.from(b64, "base64").readUInt16LE((y * w + x) * 2);
  return [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31].map(Math.round);
}

(async () => {
  const pos = [];
  const helper = spawn(HELPER, ["media", "90", TITLE], { windowsHide: true });
  helper.stdout.on("data", (d) => { for (const m of d.toString().matchAll(/POS (\d+)/g)) pos.push(+m[1]); });
  const settings = { baud: 921600, settime_enabled: false, art_enabled: true, host_slots: {} };
  const link = new SerialLink();
  const dev = new Device({ link, backup: { autoBackup: () => null }, settings: { load: () => settings, save: (p) => Object.assign(settings, p) } });
  let sent = null, artOk = false, fail = null;
  const seeks = [];
  try {
    const r = await dev.connect();
    if (!r.ok) throw new Error(r.error);
    step(`keypad on ${r.path}, fw ${r.status.ver}`);
    await link.command("setdim 0");
    await link.command("setprofile 1");
    await link.command("page 2");
    link.on("seek", (s) => { seeks.push(s); feeds.seekNowPlaying(s); });
    feeds.startNowPlaying(
      (np) => { if (np.title === TITLE && dev.nowPlaying(np)) sent = np; },
      (e) => step(`helper: ${e}`),
      (bmp, key) => { if (key.startsWith(TITLE)) dev.art(bmp, key).then((ok) => { artOk = artOk || ok; }); });
    await until("the session reaches Studio and the keypad", () => sent && sent.playing && sent.len > 0, 20000);
    step(`now_playing sent: ${JSON.stringify(sent)}`);
    if (sent.album !== "E2E Album" || sent.artist !== "Keypad Test") throw new Error("album/artist not carried");
    await until("album art uploaded to ram:art", () => artOk, 20000);
    step("album art uploaded");
    await sleep(800);
    const c = await pixel(link, 80, 108);
    step(`cover pixel ${c}`);
    if (!(c[0] > 200 && c[1] < 60 && c[2] > 200)) throw new Error(`cover not magenta on the player: ${c}`);

    const before = pos.at(-1) || 0;
    await link.command("touch 388 153 80");          // 75% along the seek bar
    await until("EVT:SEEK", () => seeks.length, 5000);
    const want = seeks[0];
    step(`EVT:SEEK ${want} (was at ${before} s of ${sent.len})`);
    if (Math.abs(want - Math.round(sent.len * 0.75)) > 3) throw new Error(`seek target ${want} is not 75% of ${sent.len}`);
    await until(`the session moved to ~${want} s`, () => pos.some((p) => Math.abs(p - want) <= 3), 8000);
    step(`session position now ${pos.at(-1)} s`);
    console.log("MEDIA E2E OK");
  } catch (e) { fail = e; }
  feeds.stopNowPlaying();
  helper.kill();
  try { await link.command("setdim 120"); await link.command("page 1"); } catch (_) {}
  link.disconnect();
  if (fail) { console.error(`MEDIA E2E FAILED: ${fail.message}`); process.exit(1); }
  process.exit(0);
})();
