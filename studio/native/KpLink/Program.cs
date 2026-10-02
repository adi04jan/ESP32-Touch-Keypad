// Studio's Bluetooth link to the Touch Keypad: the keypad's console (a Nordic UART
// service on the paired, connected keypad) bridged to stdio. No scan: Windows already
// holds the link for HID, so the paired device is opened by id and its GATT read uncached.
//   KpLink [address]   stdin -> RX writes, TX notifications -> stdout (raw bytes)
// stderr carries control lines: OPEN <name> <address> <mtu> | ERR <reason> | CLOSED <reason>.
// Exit codes: 0 stdin closed, 3 no paired keypad connected, 4 no console service, 5 link lost.
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Devices.Enumeration;
using Windows.Storage.Streams;

static class Program
{
    static readonly Guid Nus = Guid.Parse("6E400001-B5A3-F393-E0A9-E50E24DCCA9E");
    static readonly Guid Rx = Guid.Parse("6E400002-B5A3-F393-E0A9-E50E24DCCA9E");
    static readonly Guid Tx = Guid.Parse("6E400003-B5A3-F393-E0A9-E50E24DCCA9E");
    static readonly TextWriter Ctl = Console.Error;

    static int Main(string[] args)
    {
        try { return Run(args.Length > 0 ? args[0] : null).GetAwaiter().GetResult(); }
        catch (Exception e) { Ctl.WriteLine($"ERR {e.GetType().Name} 0x{e.HResult:X8}: {e.Message} {e.StackTrace?.Split('\n').FirstOrDefault()?.Trim()}"); return 2; }
    }

    static async Task<int> Run(string? address)
    {
        var aqs = BluetoothLEDevice.GetDeviceSelectorFromPairingState(true);
        var paired = await DeviceInformation.FindAllAsync(aqs, null, DeviceInformationKind.AssociationEndpoint);
        foreach (var d in paired)
        {
            if (!d.Name.Contains("Touch Keypad", StringComparison.OrdinalIgnoreCase)) continue;
            if (address != null && !d.Id.EndsWith(address, StringComparison.OrdinalIgnoreCase)) continue;
            using var dev = await BluetoothLEDevice.FromIdAsync(d.Id);
            if (dev is null || dev.ConnectionStatus != BluetoothConnectionStatus.Connected) continue;
            return await Bridge(dev);
        }
        Ctl.WriteLine("ERR no paired Touch Keypad is connected to this PC");
        return 3;
    }

    static async Task<int> Bridge(BluetoothLEDevice dev)
    {
        using var session = await GattSession.FromDeviceIdAsync(dev.BluetoothDeviceId);
        session.MaintainConnection = true;
        var svcs = await dev.GetGattServicesForUuidAsync(Nus, BluetoothCacheMode.Uncached);
        if (svcs.Status != GattCommunicationStatus.Success || svcs.Services.Count == 0)
        {
            Ctl.WriteLine($"ERR no console service ({svcs.Status}); keypad firmware 3.2.1 or newer has it");
            return 4;
        }
        // Shared, and disposed on exit: a service left to the finalizer stays held for a while
        // and the next link (Studio reconnecting) gets AccessDenied.
        using var svc = svcs.Services[0];
        GattCharacteristicsResult rxr = null!, txr = null!;
        for (int t = 0; t < 5; t++)
        {
            await svc.OpenAsync(GattSharingMode.SharedReadAndWrite);
            rxr = await svc.GetCharacteristicsForUuidAsync(Rx, BluetoothCacheMode.Uncached);
            txr = await svc.GetCharacteristicsForUuidAsync(Tx, BluetoothCacheMode.Uncached);
            if (rxr.Status != GattCommunicationStatus.AccessDenied && txr.Status != GattCommunicationStatus.AccessDenied) break;
            await Task.Delay(1000);
        }
        var rx = rxr.Characteristics.FirstOrDefault();
        var tx = txr.Characteristics.FirstOrDefault();
        if (rx is null || tx is null) { Ctl.WriteLine($"ERR console characteristics missing (rx {rxr.Status} {rxr.ProtocolError}, tx {txr.Status} {txr.ProtocolError})"); return 4; }

        var stdout = Console.OpenStandardOutput();
        tx.ValueChanged += (_, e) =>
        {
            var buf = new byte[e.CharacteristicValue.Length];
            using (var r = DataReader.FromBuffer(e.CharacteristicValue)) r.ReadBytes(buf);
            lock (stdout) { stdout.Write(buf); stdout.Flush(); }
        };
        // Fresh descriptors too: a cache from older firmware points the CCCD write at a stale handle (ATT write-not-permitted).
        await tx.GetDescriptorsAsync(BluetoothCacheMode.Uncached);
        var lost = new TaskCompletionSource<int>();
        dev.ConnectionStatusChanged += (s, _) => { if (s.ConnectionStatus == BluetoothConnectionStatus.Disconnected) lost.TrySetResult(5); };
        var sub = await tx.WriteClientCharacteristicConfigurationDescriptorAsync(GattClientCharacteristicConfigurationDescriptorValue.Notify);
        if (sub != GattCommunicationStatus.Success) { Ctl.WriteLine($"ERR subscribe failed ({sub})"); return 4; }

        Ctl.WriteLine($"OPEN {dev.Name} {dev.BluetoothAddress:X12} {session.MaxPduSize}");
        Ctl.Flush();

        // stdin -> RX in ATT-sized writes without response: the link layer still acknowledges every
        // packet, and Windows holds a write until the controller has room. The keypad buffers whole
        // uploads in RAM (8 KB receive ring), and Studio paces uploads, so nothing outruns it.
        var pump = Task.Run(async () =>
        {
            var stdin = Console.OpenStandardInput();
            var buf = new byte[512];
            int n;
            while ((n = await stdin.ReadAsync(buf)) > 0)
            {
                int chunk = Math.Max(20, session.MaxPduSize - 3);
                for (int i = 0; i < n; i += chunk)
                {
                    var part = buf.AsSpan(i, Math.Min(chunk, n - i)).ToArray();
                    var r = await rx.WriteValueWithResultAsync(part.AsBuffer(), GattWriteOption.WriteWithoutResponse);
                    if (r.Status != GattCommunicationStatus.Success) { Ctl.WriteLine($"ERR write failed ({r.Status})"); return 5; }
                }
            }
            return 0;
        });
        int code = await await Task.WhenAny(pump, lost.Task);
        Ctl.WriteLine(code == 0 ? "CLOSED stdin" : "CLOSED link lost");
        return code;
    }
}
