/* System-wide mic mute, for a `mic toggle|mute|unmute` host key: one long-lived hidden PowerShell
 * that mutes or unmutes every active capture endpoint through Core Audio (IAudioEndpointVolume),
 * so every app hears silence. That is what Logitech's and laptops' mic keys do, and their on-screen
 * icon (Logi Options+'s, for one) follows the endpoint's mute, so it shows for this key too.
 * The helper reads one command per line and answers "muted 1" or "muted 0" (or "error <text>"). */
"use strict";

const { spawn: realSpawn } = require("child_process");

const PS = `
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection c); }
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection { int GetCount(out int n); int Item(int i, out IMMDevice d); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int f1(); int f2(); int GetChannelCount(out int c); int SetMasterVolumeLevel(float l, ref Guid g); int SetMasterVolumeLevelScalar(float l, ref Guid g); int GetMasterVolumeLevel(out float l); int GetMasterVolumeLevelScalar(out float l); int a(); int b(); int c(); int d(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
public static class KpMic {
  static List<IAudioEndpointVolume> All() {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDeviceCollection c; e.EnumAudioEndpoints(1, 1, out c);
    int n; c.GetCount(out n); var o = new List<IAudioEndpointVolume>();
    for (int i = 0; i < n; i++) { IMMDevice d; c.Item(i, out d); var iid = typeof(IAudioEndpointVolume).GUID; object v; d.Activate(ref iid, 23, IntPtr.Zero, out v); o.Add((IAudioEndpointVolume)v); }
    return o;
  }
  // Muted only when every active mic is: a toggle mutes them all unless they all are already.
  public static bool Muted() { var a = All(); if (a.Count == 0) return false; foreach (var v in a) { bool m; v.GetMute(out m); if (!m) return false; } return true; }
  public static void Set(bool m) { var g = Guid.Empty; foreach (var v in All()) v.SetMute(m, ref g); }
}
'@
while ($null -ne ($l = [Console]::In.ReadLine())) {
  try {
    if ($l -eq "toggle") { [KpMic]::Set(-not [KpMic]::Muted()) }
    elseif ($l -eq "mute") { [KpMic]::Set($true) }
    elseif ($l -eq "unmute") { [KpMic]::Set($false) }
    [Console]::Out.WriteLine("muted " + [int][KpMic]::Muted())
  } catch { [Console]::Out.WriteLine("error " + $_.Exception.Message) }
}`;

const ARGS = new Set(["toggle", "mute", "unmute", "get"]);

class MicMute {
  constructor({ spawn = realSpawn, log = () => {} } = {}) {
    this.spawn = spawn;
    this.log = log;
    this.child = null;
    this.waiting = [];   // { resolve, reject } per command sent, answered in order
    this.buf = "";
  }

  _start() {
    if (this.child) return;
    const enc = Buffer.from(PS, "utf16le").toString("base64");
    const child = this.spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stdout.on("data", (d) => {
      this.buf += d.toString();
      let at;
      while ((at = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, at).trim();
        this.buf = this.buf.slice(at + 1);
        const w = this.waiting.shift();
        if (!w) continue;
        const m = line.match(/^muted ([01])$/);
        if (m) w.resolve(m[1] === "1"); else w.reject(new Error(line.replace(/^error /, "") || "no answer"));
      }
    });
    if (child.stderr) child.stderr.on("data", (d) => {   // PowerShell's CLIXML progress records are noise
      const t = String(d).trim();
      if (t && !/^#< CLIXML|^<Objs/.test(t)) this.log(`mic: ${t}\n`);
    });
    const gone = () => {
      if (this.child !== child) return;
      this.child = null;
      this.buf = "";
      for (const w of this.waiting.splice(0)) w.reject(new Error("the mic helper stopped"));
    };
    child.on("exit", gone);
    child.on("error", gone);
  }

  // "toggle" | "mute" | "unmute" | "get" -> Promise<boolean>: muted afterwards.
  run(arg) {
    if (!ARGS.has(arg)) return Promise.reject(new Error(`mic ${arg}: use toggle, mute or unmute`));
    this._start();
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.child.stdin.write(`${arg}\n`);
    });
  }

  stop() {
    const c = this.child;
    this.child = null;
    if (c) try { c.kill(); } catch (_) {}
  }
}

module.exports = { MicMute };
