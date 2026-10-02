/* Feeds (PLAN.md §10): status-bar clock (`settime`) and Now Playing from the
 * Windows media session (`widget now_playing {…}`). The media helper is one
 * long-lived Windows PowerShell 5.1 process (WinRT projection is not available
 * in pwsh 7) that prints a JSON line whenever the session changes. */
"use strict";

const { spawn } = require("child_process");

// tz = minutes east of UTC (IST = 330). ponytail: switch to a POSIX TZ string if PROTOCOL.md asks.
function timeCommand(date = new Date()) {
  return `settime ${Math.floor(date.getTime() / 1000)} ${-date.getTimezoneOffset()}`;
}

const NP_FIELDS = ["title", "artist", "app", "pos", "len", "playing"];
function nowPlayingCommand(np) {
  const o = {};
  for (const k of NP_FIELDS) o[k] = np[k] ?? (k === "playing" ? false : k === "pos" || k === "len" ? 0 : "");
  o.title = String(o.title).slice(0, 64);
  o.artist = String(o.artist).slice(0, 64);
  o.app = String(o.app).split("!").pop().replace(/\.exe$/i, "").slice(0, 32);
  return `widget now_playing ${JSON.stringify(o)}`;
}

// Send on track / state change, or when the position drifts >= 5 s from what the
// device can extrapolate (it advances pos itself while playing).
function shouldSend(prev, next, sentAtMs, nowMs) {
  if (!prev) return true;
  if (prev.title !== next.title || prev.artist !== next.artist || prev.playing !== next.playing || prev.len !== next.len) return true;
  const expected = prev.pos + (prev.playing ? Math.round((nowMs - sentAtMs) / 1000) : 0);
  return Math.abs(next.pos - expected) >= 5;
}

const NP_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$last = ''
while ($true) {
  try {
    $s = $mgr.GetCurrentSession()
    if ($s) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $tl = $s.GetTimelineProperties()
      $o = [ordered]@{ title = $p.Title; artist = $p.Artist; app = $s.SourceAppUserModelId; pos = [int]$tl.Position.TotalSeconds; len = [int]$tl.EndTime.TotalSeconds; playing = ($s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') }
    } else { $o = [ordered]@{ title = ''; artist = ''; app = ''; pos = 0; len = 0; playing = $false } }
    $j = $o | ConvertTo-Json -Compress
    if ($j -ne $last) { $last = $j; [Console]::Out.WriteLine($j); [Console]::Out.Flush() }
  } catch { [Console]::Error.WriteLine($_.Exception.Message) }
  Start-Sleep -Milliseconds 1000
}`;

let child = null;

// onData({title, artist, app, pos, len, playing}); returns false if not on Windows.
function startNowPlaying(onData, onError = () => {}) {
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
      try { onData(JSON.parse(line)); } catch (_) {}
    }
  });
  child.stderr.on("data", (d) => { const s = d.toString().trim(); if (s && !/CLIXML|<Objs/.test(s)) onError(s); });
  child.on("exit", () => { child = null; });
  child.on("error", (e) => { child = null; onError(e.message); });
  return true;
}
function stopNowPlaying() { if (child) { try { child.kill(); } catch (_) {} child = null; } }

module.exports = { timeCommand, nowPlayingCommand, shouldSend, startNowPlaying, stopNowPlaying, NP_PS };
