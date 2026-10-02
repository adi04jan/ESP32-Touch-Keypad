/* Reports the focused window's process name (Windows). Spawns one long-lived
 * PowerShell that polls the foreground window and prints the process name only
 * when it changes — no per-poll process spawn, no native dependency. */
"use strict";
const { spawn } = require("child_process");

const PS = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int p);
}
'@
$last = ""
while ($true) {
  try {
    $h = [Fg]::GetForegroundWindow()
    $procId = 0
    [void][Fg]::GetWindowThreadProcessId($h, [ref]$procId)
    $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
    if ($name -and $name -ne $last) { $last = $name; Write-Output $name }
  } catch {}
  Start-Sleep -Milliseconds 1200
}`;

let child = null;

function start(onProcess) {
  if (process.platform !== "win32" || child) return;
  const enc = Buffer.from(PS, "utf16le").toString("base64");
  try {
    child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc], { windowsHide: true });
  } catch (_) { child = null; return; }
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) try { onProcess(line); } catch (_) {}
    }
  });
  child.on("exit", () => { child = null; });
  child.on("error", () => { child = null; });
}
function stop() { if (child) { try { child.kill(); } catch (_) {} child = null; } }

module.exports = { start, stop };
