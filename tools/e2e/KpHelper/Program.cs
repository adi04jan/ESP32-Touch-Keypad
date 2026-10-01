// E2E helper for the Touch Keypad: BLE pairing from a script, and a focused test window that records keystrokes.
//   KpHelper list  [name]                 -> prints paired/unpaired BLE devices matching name
//   KpHelper pair  [name] [timeoutSec]    -> pairs; prints NEED_PIN when Windows asks, reads the 6-digit pin from stdin
//   KpHelper unpair [name]                -> unpairs every paired device matching name
//   KpHelper window <outFile> [seconds]   -> topmost window with a text box; mirrors its text to outFile until closed or timeout
// Output is line based for the Python runner: OK ..., ERR ..., NEED_PIN, DEVICE <id> | <name> | paired=<bool>.
using System.Runtime.InteropServices;
using Windows.Devices.Bluetooth;
using Windows.Devices.Enumeration;

static class Program
{
    const string DefaultName = "Touch Keypad";

    [STAThread]
    static int Main(string[] args)
    {
        AttachConsole(-1);
        var verb = args.Length > 0 ? args[0] : "help";
        try
        {
            return verb switch
            {
                "list" => List(Arg(args, 1, DefaultName)).GetAwaiter().GetResult(),
                "pair" => Pair(Arg(args, 1, DefaultName), int.Parse(Arg(args, 2, "45"))).GetAwaiter().GetResult(),
                "unpair" => Unpair(Arg(args, 1, DefaultName)).GetAwaiter().GetResult(),
                "window" => Window(Arg(args, 1, "keys.txt"), int.Parse(Arg(args, 2, "0"))),
                _ => Help(),
            };
        }
        catch (Exception e) { Console.WriteLine($"ERR {e.GetType().Name}: {e.Message}"); return 2; }
    }

    static string Arg(string[] a, int i, string d) => a.Length > i ? a[i] : d;
    static int Help() { Console.WriteLine("usage: KpHelper list|pair|unpair [name] | window <outFile> [seconds]"); return 1; }

    // BLE association endpoints (paired or unpaired), filtered by name.
    static async Task<List<DeviceInformation>> Find(string name, bool paired, int seconds)
    {
        var aqs = BluetoothLEDevice.GetDeviceSelectorFromPairingState(paired);
        var props = new[] { "System.Devices.Aep.IsPaired", "System.Devices.Aep.SignalStrength" };
        var found = new Dictionary<string, DeviceInformation>();
        var watcher = DeviceInformation.CreateWatcher(aqs, props, DeviceInformationKind.AssociationEndpoint);
        watcher.Added += (_, d) => { if (d.Name.Contains(name, StringComparison.OrdinalIgnoreCase)) lock (found) found[d.Id] = d; };
        watcher.Updated += (_, u) => { lock (found) if (found.TryGetValue(u.Id, out var d)) d.Update(u); };
        watcher.Start();
        var until = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < until) { await Task.Delay(250); lock (found) if (found.Count > 0 && paired) break; }
        watcher.Stop();
        lock (found) return found.Values.ToList();
    }

    static async Task<int> List(string name)
    {
        var all = (await Find(name, false, 8)).Concat(await Find(name, true, 3)).GroupBy(d => d.Id).Select(g => g.First()).ToList();
        foreach (var d in all) Console.WriteLine($"DEVICE {d.Id} | {d.Name} | paired={d.Pairing.IsPaired}");
        Console.WriteLine($"OK {all.Count}");
        return 0;
    }

    static async Task<int> Pair(string name, int timeout)
    {
        var dev = (await Find(name, false, Math.Min(timeout, 20))).FirstOrDefault();
        if (dev is null) { Console.WriteLine($"ERR no unpaired device named '{name}' is advertising"); return 3; }
        Console.WriteLine($"DEVICE {dev.Id} | {dev.Name} | paired=false");
        var custom = dev.Pairing.Custom;
        custom.PairingRequested += (_, req) =>
        {
            switch (req.PairingKind)
            {
                case DevicePairingKinds.ProvidePin:
                    Console.WriteLine("NEED_PIN");
                    var pin = Console.ReadLine()?.Trim() ?? "";
                    req.Accept(pin);
                    break;
                case DevicePairingKinds.ConfirmPinMatch:
                    Console.WriteLine($"CONFIRM_PIN {req.Pin}");
                    req.Accept();
                    break;
                default:
                    req.Accept();
                    break;
            }
        };
        var kinds = DevicePairingKinds.ConfirmOnly | DevicePairingKinds.ProvidePin | DevicePairingKinds.ConfirmPinMatch;
        var result = await custom.PairAsync(kinds, DevicePairingProtectionLevel.Default);
        var ok = result.Status is DevicePairingResultStatus.Paired or DevicePairingResultStatus.AlreadyPaired;
        Console.WriteLine(ok ? $"OK {result.Status}" : $"ERR {result.Status}");
        return ok ? 0 : 4;
    }

    static async Task<int> Unpair(string name)
    {
        var paired = await Find(name, true, 4);
        int n = 0;
        foreach (var d in paired)
        {
            var r = await d.Pairing.UnpairAsync();
            Console.WriteLine($"{(r.Status == DeviceUnpairingResultStatus.Unpaired ? "OK" : "ERR")} unpair {d.Name} {r.Status}");
            n++;
        }
        if (n == 0) Console.WriteLine("OK nothing to unpair");
        return 0;
    }

    // A plain window whose text box receives the keypad's keystrokes; its text is mirrored to a file for the runner.
    static int Window(string outFile, int seconds)
    {
        ApplicationConfiguration.Initialize();
        var form = new Form { Text = "Touch Keypad E2E sink", Width = 640, Height = 320, TopMost = true, StartPosition = FormStartPosition.CenterScreen };
        var box = new TextBox { Multiline = true, Dock = DockStyle.Fill, Font = new Font("Consolas", 14), AcceptsReturn = true, AcceptsTab = true };
        form.Controls.Add(box);
        File.WriteAllText(outFile, "");
        box.TextChanged += (_, _) => { try { File.WriteAllText(outFile, box.Text); } catch { } };
        var refocus = new System.Windows.Forms.Timer { Interval = 500 };
        refocus.Tick += (_, _) => { if (GetForegroundWindow() != form.Handle) ForceForeground(form.Handle); if (!box.Focused) box.Focus(); };
        form.Shown += (_, _) => { ForceForeground(form.Handle); box.Focus(); refocus.Start(); Console.WriteLine("OK window"); };
        if (seconds > 0) { var t = new System.Windows.Forms.Timer { Interval = seconds * 1000 }; t.Tick += (_, _) => form.Close(); t.Start(); }
        Application.Run(form);
        return 0;
    }

    // Windows refuses SetForegroundWindow from background processes; a synthetic Alt press lifts the lock.
    static void ForceForeground(IntPtr h)
    {
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        ShowWindow(h, 9);
        SetForegroundWindow(h);
    }

    [DllImport("kernel32.dll")] static extern bool AttachConsole(int pid);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
