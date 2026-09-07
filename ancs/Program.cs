// ============================================================================
//  Y70 ANCS bridge — iPhone notifications, calls and battery over Bluetooth LE.
//
//  ANCS (Apple Notification Center Service) is the sanctioned route for getting
//  iPhone notifications onto a non-Apple device: the phone is the GATT server,
//  we are the client. Three characteristics matter:
//
//    Notification Source  notify  8-byte headers: something arrived/changed/went
//    Control Point        write   ask for a notification's text, or act on it
//    Data Source          notify  the answers, which arrive FRAGMENTED
//
//  Speaks the same protocol as the other helpers: one JSON object per line on
//  stdout, commands as JSON lines on stdin.
//
//    <- {"type":"notif","event":"added","uid":42,"category":"IncomingCall",...}
//    <- {"type":"battery","level":72}
//    -> {"cmd":"action","uid":42,"action":"positive"}   // answer the call
// ============================================================================
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using System.Text.Json;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Devices.Enumeration;
using Windows.Storage.Streams;

namespace Y70Ancs;

internal static class Program
{
    static readonly Guid AncsService = new("7905f431-b5ce-4e99-a40f-4b1e122d00d0");
    static readonly Guid NotificationSource = new("9fbf120d-6301-42d9-8c58-25e699a21dbd");
    static readonly Guid ControlPoint = new("69d1d8f3-45e1-49a8-9821-9bbdfdaad9d9");
    static readonly Guid DataSource = new("22eac6e9-24d6-4bb5-be44-b36ace7c7bfb");
    static readonly Guid BatteryService = new("0000180f-0000-1000-8000-00805f9b34fb");
    static readonly Guid BatteryLevel = new("00002a19-0000-1000-8000-00805f9b34fb");

    // ANCS CategoryID
    static readonly string[] Categories = {
        "Other", "IncomingCall", "MissedCall", "Voicemail", "Social", "Schedule",
        "Email", "News", "HealthAndFitness", "BusinessAndFinance", "Location", "Entertainment"
    };

    // Attributes we ask for on every notification.
    const byte AttrAppId = 0, AttrTitle = 1, AttrSubtitle = 2, AttrMessage = 3, AttrDate = 5;
    static readonly byte[] WantedAttrs = { AttrAppId, AttrTitle, AttrSubtitle, AttrMessage, AttrDate };

    static GattCharacteristic _controlPoint;
    static readonly object _outLock = new();
    static readonly List<byte> _dsBuffer = new();
    static readonly Dictionary<uint, Dictionary<string, object>> _pending = new();
    static readonly Dictionary<string, string> _appNames = new();
    static int _parentPid;

    static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        foreach (var a in args)
            if (a.StartsWith("--parent=") && int.TryParse(a[9..], out var p)) _parentPid = p;

        BluetoothLEDevice device = null;
        GattDeviceService ancs = null;

        try
        {
            (device, ancs) = await FindAncsDevice();
            if (ancs == null)
            {
                Emit(new { type = "error", error = "no paired iPhone exposing ANCS was found" });
                return 1;
            }
            Emit(new { type = "ready", device = device.Name, connection = device.ConnectionStatus.ToString() });

            var chars = (await ancs.GetCharacteristicsAsync()).Characteristics;
            var notifSrc = chars.FirstOrDefault(c => c.Uuid == NotificationSource);
            var dataSrc = chars.FirstOrDefault(c => c.Uuid == DataSource);
            _controlPoint = chars.FirstOrDefault(c => c.Uuid == ControlPoint);

            if (notifSrc == null || dataSrc == null || _controlPoint == null)
            {
                Emit(new { type = "error", error = "ANCS is missing a characteristic" });
                return 1;
            }

            // Data Source first: a notification can arrive the instant we
            // subscribe to the source, and its attributes would land nowhere.
            dataSrc.ValueChanged += OnDataSource;
            var dsOk = await dataSrc.WriteClientCharacteristicConfigurationDescriptorAsync(
                GattClientCharacteristicConfigurationDescriptorValue.Notify);

            notifSrc.ValueChanged += OnNotificationSource;
            var nsOk = await notifSrc.WriteClientCharacteristicConfigurationDescriptorAsync(
                GattClientCharacteristicConfigurationDescriptorValue.Notify);

            Emit(new { type = "subscribed", notificationSource = nsOk.ToString(), dataSource = dsOk.ToString() });
            if (nsOk != GattCommunicationStatus.Success)
            {
                Emit(new { type = "error", error = "iOS refused the notification subscription: " + nsOk });
                return 1;
            }

            await StartBattery(device);

            // Commands from the server, plus a watchdog on the parent.
            _ = Task.Run(ReadCommands);
            while (true)
            {
                await Task.Delay(2000);
                if (_parentPid > 0 && !ProcessAlive(_parentPid)) return 0;
                if (device.ConnectionStatus == BluetoothConnectionStatus.Disconnected)
                    Emit(new { type = "disconnected" });
            }
        }
        catch (Exception ex)
        {
            Emit(new { type = "error", error = ex.Message });
            return 1;
        }
        finally
        {
            ancs?.Dispose();
            device?.Dispose();
        }
    }

    static bool ProcessAlive(int pid)
    {
        try { System.Diagnostics.Process.GetProcessById(pid); return true; }
        catch { return false; }
    }

    // ---------------------------------------------------------------- device
    static async Task<(BluetoothLEDevice, GattDeviceService)> FindAncsDevice()
    {
        var selector = BluetoothLEDevice.GetDeviceSelectorFromPairingState(true);
        var found = await DeviceInformation.FindAllAsync(selector);
        foreach (var info in found)
        {
            BluetoothLEDevice dev = null;
            try
            {
                dev = await BluetoothLEDevice.FromIdAsync(info.Id);
                if (dev == null) continue;
                var services = await dev.GetGattServicesAsync();
                if (services.Status != GattCommunicationStatus.Success) { dev.Dispose(); continue; }
                var ancs = services.Services.FirstOrDefault(s => s.Uuid == AncsService);
                if (ancs != null) return (dev, ancs);
                dev.Dispose();
            }
            catch { dev?.Dispose(); }
        }
        return (null, null);
    }

    // ---------------------------------------------------------------- battery
    static async Task StartBattery(BluetoothLEDevice device)
    {
        try
        {
            var services = await device.GetGattServicesForUuidAsync(BatteryService);
            var svc = services.Services.FirstOrDefault();
            if (svc == null) return;
            var ch = (await svc.GetCharacteristicsForUuidAsync(BatteryLevel)).Characteristics.FirstOrDefault();
            if (ch == null) return;

            var read = await ch.ReadValueAsync();
            if (read.Status == GattCommunicationStatus.Success)
                Emit(new { type = "battery", level = ToBytes(read.Value)[0] });

            // Not every phone allows subscribing; the one-shot read above still
            // gave us a value, so a refusal here is not fatal.
            if (ch.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Notify))
            {
                ch.ValueChanged += (_, a) => Emit(new { type = "battery", level = ToBytes(a.CharacteristicValue)[0] });
                await ch.WriteClientCharacteristicConfigurationDescriptorAsync(
                    GattClientCharacteristicConfigurationDescriptorValue.Notify);
            }
        }
        catch (Exception ex) { Emit(new { type = "warn", warn = "battery: " + ex.Message }); }
    }

    // ------------------------------------------------------- notification src
    static async void OnNotificationSource(GattCharacteristic sender, GattValueChangedEventArgs args)
    {
        try
        {
            var b = ToBytes(args.CharacteristicValue);
            if (b.Length < 8) return;

            byte eventId = b[0], flags = b[1], categoryId = b[2], categoryCount = b[3];
            uint uid = BitConverter.ToUInt32(b, 4);
            string ev = eventId switch { 0 => "added", 1 => "modified", 2 => "removed", _ => "unknown" };

            if (ev == "removed")
            {
                _pending.Remove(uid);
                Emit(new { type = "notif", @event = "removed", uid });
                return;
            }

            var meta = new Dictionary<string, object>
            {
                ["uid"] = uid,
                ["event"] = ev,
                ["categoryId"] = categoryId,
                ["category"] = categoryId < Categories.Length ? Categories[categoryId] : "Other",
                ["count"] = categoryCount,
                ["silent"] = (flags & 0x01) != 0,
                ["important"] = (flags & 0x02) != 0,
                ["preExisting"] = (flags & 0x04) != 0,
                // Whether the notification offers actions at all. An incoming
                // call has both: positive answers it, negative declines.
                ["positive"] = (flags & 0x08) != 0,
                ["negative"] = (flags & 0x10) != 0,
            };
            _pending[uid] = meta;

            // Header only says something happened; the text has to be asked for.
            await RequestAttributes(uid);
        }
        catch (Exception ex) { Emit(new { type = "warn", warn = "notif-src: " + ex.Message }); }
    }

    static async Task RequestAttributes(uint uid)
    {
        var req = new List<byte> { 0x00 };                 // CommandID: GetNotificationAttributes
        req.AddRange(BitConverter.GetBytes(uid));
        foreach (var attr in WantedAttrs)
        {
            req.Add(attr);
            // Only the text attributes take a length; asking for one on AppId or
            // Date makes iOS reject the whole request.
            if (attr is AttrTitle or AttrSubtitle) req.AddRange(BitConverter.GetBytes((ushort)64));
            else if (attr == AttrMessage) req.AddRange(BitConverter.GetBytes((ushort)512));
        }
        await WriteControlPoint(req.ToArray());
    }

    static async Task WriteControlPoint(byte[] data)
    {
        try
        {
            var writer = new DataWriter();
            writer.WriteBytes(data);
            await _controlPoint.WriteValueAsync(writer.DetachBuffer(), GattWriteOption.WriteWithResponse);
        }
        catch (Exception ex) { Emit(new { type = "warn", warn = "control-point: " + ex.Message }); }
    }

    // ------------------------------------------------------------ data source
    // Answers arrive in fragments across several notifications, so bytes are
    // accumulated and parsed only once a whole response is present.
    static void OnDataSource(GattCharacteristic sender, GattValueChangedEventArgs args)
    {
        try
        {
            lock (_dsBuffer)
            {
                _dsBuffer.AddRange(ToBytes(args.CharacteristicValue));
                while (TryParseOne()) { }
            }
        }
        catch (Exception ex) { Emit(new { type = "warn", warn = "data-src: " + ex.Message }); }
    }

    static bool TryParseOne()
    {
        var buf = _dsBuffer;
        if (buf.Count < 5) return false;

        byte commandId = buf[0];
        int pos = 1;
        uint uid = 0;
        string appId = null;

        if (commandId == 0x00)                       // GetNotificationAttributes
        {
            uid = BitConverter.ToUInt32(buf.GetRange(1, 4).ToArray(), 0);
            pos = 5;
        }
        else if (commandId == 0x01)                  // GetAppAttributes
        {
            int end = buf.IndexOf(0x00, 1);          // app id is NUL-terminated
            if (end < 0) return false;
            appId = Encoding.UTF8.GetString(buf.GetRange(1, end - 1).ToArray());
            pos = end + 1;
        }
        else { buf.Clear(); return false; }          // out of sync; resynchronise

        var attrs = new Dictionary<byte, string>();
        int wanted = commandId == 0x00 ? WantedAttrs.Length : 1;
        while (attrs.Count < wanted)
        {
            if (pos + 3 > buf.Count) return false;   // wait for more fragments
            byte attrId = buf[pos];
            int len = BitConverter.ToUInt16(buf.GetRange(pos + 1, 2).ToArray(), 0);
            if (pos + 3 + len > buf.Count) return false;
            attrs[attrId] = len > 0
                ? Encoding.UTF8.GetString(buf.GetRange(pos + 3, len).ToArray())
                : "";
            pos += 3 + len;
        }

        buf.RemoveRange(0, pos);

        if (commandId == 0x01)
        {
            if (appId != null && attrs.TryGetValue(0, out var display) && !string.IsNullOrEmpty(display))
                _appNames[appId] = display;
            return true;
        }

        if (!_pending.TryGetValue(uid, out var meta)) return true;
        _pending.Remove(uid);

        var bundle = attrs.GetValueOrDefault(AttrAppId, "");
        meta["app"] = bundle;
        meta["appName"] = _appNames.GetValueOrDefault(bundle, PrettyApp(bundle));
        meta["title"] = attrs.GetValueOrDefault(AttrTitle, "");
        meta["subtitle"] = attrs.GetValueOrDefault(AttrSubtitle, "");
        meta["message"] = attrs.GetValueOrDefault(AttrMessage, "");
        meta["date"] = attrs.GetValueOrDefault(AttrDate, "");
        meta["type"] = "notif";
        Emit(meta);

        // Ask once for the app's display name, so next time it reads "Messages"
        // rather than "com.apple.MobileSMS".
        if (!string.IsNullOrEmpty(bundle) && !_appNames.ContainsKey(bundle))
        {
            _appNames[bundle] = PrettyApp(bundle);       // placeholder until it answers
            _ = RequestAppName(bundle);
        }
        return true;
    }

    static async Task RequestAppName(string bundleId)
    {
        var req = new List<byte> { 0x01 };                // CommandID: GetAppAttributes
        req.AddRange(Encoding.UTF8.GetBytes(bundleId));
        req.Add(0x00);
        req.Add(0x00);                                    // AttributeID: DisplayName
        await WriteControlPoint(req.ToArray());
    }

    // "com.apple.MobileSMS" -> "MobileSMS", as a stand-in until iOS tells us.
    static string PrettyApp(string bundle)
    {
        if (string.IsNullOrEmpty(bundle)) return "";
        var parts = bundle.Split('.');
        return parts.Length > 0 ? parts[^1] : bundle;
    }

    // ---------------------------------------------------------------- stdin
    static async Task ReadCommands()
    {
        using var stdin = Console.OpenStandardInput();
        using var reader = new StreamReader(stdin, Encoding.UTF8);
        while (true)
        {
            var line = await reader.ReadLineAsync();
            if (line == null) { Environment.Exit(0); return; }
            line = line.Trim();
            if (line.Length == 0) continue;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                var cmd = root.GetProperty("cmd").GetString();
                if (cmd == "action")
                {
                    uint uid = root.GetProperty("uid").GetUInt32();
                    var action = root.GetProperty("action").GetString();
                    // ActionID 0 = Positive (answer), 1 = Negative (decline, or
                    // hang up while a call is in progress).
                    byte actionId = action == "positive" ? (byte)0 : (byte)1;
                    var req = new List<byte> { 0x02 };     // PerformNotificationAction
                    req.AddRange(BitConverter.GetBytes(uid));
                    req.Add(actionId);
                    await WriteControlPoint(req.ToArray());
                    Emit(new { type = "acted", uid, action });
                }
            }
            catch (Exception ex) { Emit(new { type = "warn", warn = "cmd: " + ex.Message }); }
        }
    }

    // ---------------------------------------------------------------- output
    static byte[] ToBytes(IBuffer buffer)
    {
        var bytes = new byte[buffer.Length];
        DataReader.FromBuffer(buffer).ReadBytes(bytes);
        return bytes;
    }

    static void Emit(object obj)
    {
        var json = JsonSerializer.Serialize(obj);
        lock (_outLock)
        {
            Console.Out.WriteLine(json);
            Console.Out.Flush();
        }
    }
}
