/* Feeds (PLAN.md §10): status-bar clock (`settime`) and the media player page
 * from the Windows media session (`widget now_playing {…}`, album art to
 * `ram:art`, seeks back from the keypad). The media helper is one long-lived
 * Windows PowerShell 5.1 process (WinRT projection is not available in pwsh 7)
 * that prints a JSON line whenever the session changes, an {"art": …} line when
 * a new cover is ready, and reads `seek <seconds>` lines on stdin. */
"use strict";

const { spawn } = require("child_process");

// tz = minutes east of UTC (IST = 330). ponytail: switch to a POSIX TZ string if PROTOCOL.md asks.
function timeCommand(date = new Date()) {
  return `settime ${Math.floor(date.getTime() / 1000)} ${-date.getTimezoneOffset()}`;
}

const NP_FIELDS = ["title", "album", "artist", "app", "pos", "len", "playing"];
function nowPlayingCommand(np) {
  const o = {};
  for (const k of NP_FIELDS) o[k] = np[k] ?? (k === "playing" ? false : k === "pos" || k === "len" ? 0 : "");
  for (const k of ["title", "album", "artist"]) o[k] = String(o[k]).slice(0, 64);
  o.app = String(o.app).split("!").pop().replace(/\.exe$/i, "").split(".").pop().slice(0, 32);
  return `widget now_playing ${JSON.stringify(o)}`;
}

// Send on track / state change, or when the position drifts >= 5 s from what the
// device can extrapolate (it advances pos itself while playing).
function shouldSend(prev, next, sentAtMs, nowMs) {
  if (!prev) return true;
  if (prev.title !== next.title || prev.artist !== next.artist || prev.album !== next.album || prev.playing !== next.playing || prev.len !== next.len) return true;
  const expected = prev.pos + (prev.playing ? Math.round((nowMs - sentAtMs) / 1000) : 0);
  return Math.abs(next.pos - expected) >= 5;
}

// The helper's 128x128 24-bit BMP cover -> the player's big-endian RGB565 buffer.
const ART = 128;
function bmpToRgb565(bmp) {
  if (bmp.length < 54 || bmp.toString("latin1", 0, 2) !== "BM") throw new Error("not a BMP");
  const off = bmp.readUInt32LE(10), w = bmp.readInt32LE(18), h0 = bmp.readInt32LE(22), bpp = bmp.readUInt16LE(28);
  const h = Math.abs(h0), stride = Math.ceil((w * 3) / 4) * 4;
  if (w !== ART || h !== ART || bpp !== 24 || bmp.length < off + stride * h) throw new Error(`cover must be ${ART}x${ART} 24-bit, got ${w}x${h} ${bpp}-bit`);
  const out = Buffer.alloc(w * h * 2);
  for (let y = 0; y < h; y++) {
    const row = off + (h0 > 0 ? h - 1 - y : y) * stride;     // positive height = bottom-up rows
    for (let x = 0; x < w; x++) {
      const i = row + x * 3, b = bmp[i], g = bmp[i + 1], r = bmp[i + 2];
      out.writeUInt16BE(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3), (y * w + x) * 2);
    }
  }
  return out;
}

const NP_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
function Cover($p) {
  if (-not $p.Thumbnail) { return '' }
  $ras = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  # PowerShell 5.1 sees the projected stream as a bare __ComObject and can't bind it;
  # invoking AsStreamForRead through reflection lets the CLR do the interface cast.
  $st = $asRead.Invoke($null, @($ras))
  $img = [System.Drawing.Image]::FromStream($st)
  $side = [Math]::Min($img.Width, $img.Height)
  $bmp = New-Object System.Drawing.Bitmap 128, 128, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, 128, 128), [int](($img.Width - $side) / 2), [int](($img.Height - $side) / 2), $side, $side, [System.Drawing.GraphicsUnit]::Pixel)
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose(); $st.Dispose()
  [Convert]::ToBase64String($ms.ToArray())
}
$last = ''; $artKey = ''; $artTries = 0
# Console.In.ReadLineAsync blocks in .NET Framework; the raw stdin stream reads on the pool.
$stdin = [Console]::OpenStandardInput(); $inBuf = New-Object byte[] 256; $pend = ''
$rd = $stdin.ReadAsync($inBuf, 0, 256)
while ($true) {
  try {
    $s = $mgr.GetCurrentSession()
    if ($rd.IsCompleted) {
      $n = $rd.Result
      if ($n -le 0) { exit }
      $pend += [Text.Encoding]::ASCII.GetString($inBuf, 0, $n)
      while ($pend.Contains("\`n")) {
        $i = $pend.IndexOf("\`n"); $line = $pend.Substring(0, $i).Trim(); $pend = $pend.Substring($i + 1)
        if ($s -and $line -match '^seek (\\d+)$') { $null = Await ($s.TryChangePlaybackPositionAsync([long]$matches[1] * 10000000)) ([bool]) }
      }
      $rd = $stdin.ReadAsync($inBuf, 0, 256)
    }
    if ($s) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $tl = $s.GetTimelineProperties()
      $o = [ordered]@{ title = $p.Title; album = $p.AlbumTitle; artist = $p.Artist; app = $s.SourceAppUserModelId; pos = [int]$tl.Position.TotalSeconds; len = [int]$tl.EndTime.TotalSeconds; playing = ($s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') }
    } else { $o = [ordered]@{ title = ''; album = ''; artist = ''; app = ''; pos = 0; len = 0; playing = $false } }
    $j = $o | ConvertTo-Json -Compress
    if ($j -ne $last) { $last = $j; [Console]::Out.WriteLine($j); [Console]::Out.Flush() }
    # Covers often arrive seconds after the track: keep asking for ~15 s per track.
    $key = "$($o.title)|$($o.artist)|$($o.album)"
    if ($key -ne $artKey) { $artKey = $key; $artTries = 0 }
    if ($s -and $artTries -ge 0 -and $artTries -lt 30) {
      $artTries++
      $a = Cover $p
      if ($a) { $artTries = -1; [Console]::Out.WriteLine((@{ art = $a; key = $key } | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
    }
  } catch { [Console]::Error.WriteLine($_.Exception.Message) }
  Start-Sleep -Milliseconds 500
}`;

let child = null;

/* onData({title, album, artist, app, pos, len, playing}); onArt(bmpBuffer, key).
 * Returns false if not on Windows or already running. */
function startNowPlaying(onData, onError = () => {}, onArt = () => {}) {
  if (process.platform !== "win32" || child) return false;
  const enc = Buffer.from(NP_PS, "utf16le").toString("base64");
  try {
    child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc], { windowsHide: true });
  } catch (e) { child = null; onError(e.message); return false; }
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch (_) { continue; }
      if (typeof o.art === "string") onArt(Buffer.from(o.art, "base64"), o.key);
      else onData(o);
    }
  });
  child.stderr.on("data", (d) => { const s = d.toString().trim(); if (s && !/CLIXML|<Objs/.test(s)) onError(s); });
  child.on("exit", () => { child = null; });
  child.on("error", (e) => { child = null; onError(e.message); });
  return true;
}
function seekNowPlaying(sec) {
  if (!child || !child.stdin.writable) return false;
  child.stdin.write(`seek ${Math.max(0, Math.round(sec))}\n`);
  return true;
}
function stopNowPlaying() { if (child) { try { child.stdin.end(); child.kill(); } catch (_) {} child = null; } }

module.exports = { timeCommand, nowPlayingCommand, shouldSend, bmpToRgb565, startNowPlaying, seekNowPlaying, stopNowPlaying, NP_PS };
