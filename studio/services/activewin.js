/* Reports the focused window's process name and title (Windows). Spawns one long-lived
 * PowerShell that polls the foreground window and prints "name<TAB>title" only when
 * either changes — no per-poll process spawn, no native dependency. */
"use strict";
const { spawn } = require("child_process");

const PS = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
}
'@
$last = ""
while ($true) {
  try {
    $h = [Fg]::GetForegroundWindow()
    $procId = 0
    [void][Fg]::GetWindowThreadProcessId($h, [ref]$procId)
    $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
    $sb = New-Object System.Text.StringBuilder 256
    [void][Fg]::GetWindowText($h, $sb, 256)
    $line = "$name" + [char]9 + ($sb.ToString() -replace '\\s+', ' ')
    if ($name -and $line -ne $last) { $last = $line; [Console]::Out.WriteLine($line) }
  } catch {}
  Start-Sleep -Milliseconds 1200
}`;

let child = null;

function start(onFocus) {   // onFocus(processName, windowTitle)
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
      const [name, title = ""] = line.split("\t");
      if (name) try { onFocus(name, title); } catch (_) {}
    }
  });
  child.on("exit", () => { child = null; });
  child.on("error", () => { child = null; });
}
function stop() { if (child) { try { child.kill(); } catch (_) {} child = null; } }

module.exports = { start, stop };
