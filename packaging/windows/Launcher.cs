// A local file host, not a second game runtime. Uses Windows 10/11's .NET Framework.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program {
    [STAThread] static void Main(string[] args) {
        AppWindow.SetProcessDPIAware();
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        int port = 8897, stopAfter = 0;
        bool open = true, verifyOnly = false;
        foreach (string arg in args) {
            if (arg == "--no-open") open = false;
            else if (arg == "--verify-only") verifyOnly = true;
            else if (arg.StartsWith("--port=")) int.TryParse(arg.Substring(7), out port);
            else if (arg.StartsWith("--stop-after-ms=")) int.TryParse(arg.Substring(16), out stopAfter);
            else if (arg.StartsWith("--validation-profile=")) AppWindow.ValidationProfile = arg.Substring(21);
            else if (arg.StartsWith("--validation-browser=")) AppWindow.ValidationBrowser = arg.Substring(21);
        }
        try {
            using (var host = new LocalHost(AppDomain.CurrentDomain.BaseDirectory, port)) {
            if (verifyOnly) { Thread.Sleep(stopAfter > 0 ? stopAfter : 30000); return; }
            using (var window = new Form()) {
                window.Text = "异境回响 REBORN · 离线启动器";
                window.ClientSize = new Size(570, 280);
                window.FormBorderStyle = FormBorderStyle.FixedDialog;
                window.MaximizeBox = false;
                window.StartPosition = FormStartPosition.CenterScreen;
                var note = new Label { Left = 22, Top = 20, Width = 526, Height = 145,
                    Text = "独立全屏游戏窗口，无地址栏。\r\nF11 切换全屏 / 窗口；Alt+Tab 切换应用；Alt+F4 退出。\r\n\r\n使用下方浏览器的原有资料与电脑存档，不使用隐私模式。\r\n请选之前玩电脑版时使用的浏览器。",
                    Font = new Font("Microsoft YaHei UI", 10) };
                if (AppWindow.ValidationProfile != null) note.Text += "\r\n当前为隔离资料验证模式，不读取原用户存档。";
                var choices = AppWindow.Browsers();
                int preferred = AppWindow.Preferred(choices);
                var browser = new ComboBox { Left = 22, Top = 174, Width = 526, DropDownStyle = ComboBoxStyle.DropDownList };
                foreach (var choice in choices) browser.Items.Add(choice);
                if (choices.Count > 0) browser.SelectedIndex = Math.Max(0, preferred);
                if (preferred < 0) note.Text += "\r\n默认浏览器不支持独立应用窗口，请先选择 Edge 或 Chrome。";
                var enter = new Button { Left = 22, Top = 220, Width = 250, Height = 40, Text = "全屏启动游戏" };
                var close = new Button { Left = 290, Top = 220, Width = 258, Height = 40, Text = "结束游戏并关闭服务" };
                AppWindow gameWindow = null;
                Action launch = delegate {
                    if (gameWindow != null) { gameWindow.Activate(); return; }
                    if (browser.SelectedItem == null) { MessageBox.Show("电脑需要已安装 Microsoft Edge 或 Google Chrome 才能启动独立游戏窗口。本包不联网下载浏览器。", "缺少浏览器"); return; }
                    try {
                        var choice = (AppWindow.Browser)browser.SelectedItem;
                        AppWindow.Remember(choice);enter.Enabled = false;browser.Enabled = false;
                        gameWindow = new AppWindow(choice, host.Url, delegate(string message, bool full) {
                            note.Text = message;
                            if (full) window.WindowState = FormWindowState.Minimized;
                        }, delegate { window.Close(); });
                    } catch (Exception error) { enter.Enabled = true;browser.Enabled = true;MessageBox.Show(error.Message, "无法打开独立游戏窗口"); }
                };
                enter.Click += delegate { launch(); };
                close.Click += delegate { window.Close(); };
                window.FormClosing += delegate { if (gameWindow != null) gameWindow.Dispose(); };
                window.Controls.AddRange(new Control[] { note, browser, enter, close });
                System.Windows.Forms.Timer timer = null;
                window.Shown += delegate {
                    if (open && preferred >= 0) launch();
                    // Used only by packaging validation; normal launch has no time limit.
                    if (stopAfter > 0) {
                        timer = new System.Windows.Forms.Timer { Interval = stopAfter };
                        timer.Tick += delegate { timer.Stop(); window.Close(); };
                        timer.Start();
                    }
                };
                Application.Run(window);
                if (timer != null) timer.Dispose();
            }
            }
        } catch (Exception error) {
            string hint = error is SocketException
                ? "本机端口正在使用，或系统阻止了启动。请关闭旧版启动窗口后重试。\r\n"
                : "请先将整个电脑离线包解压到普通文件夹，再运行启动器。\r\n";
            MessageBox.Show(hint + error.Message, "无法启动异境回响", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Environment.ExitCode = 1;
        }
    }
}

// Keep the user's normal browser profile and only address the window created by
// this launch. Kiosk/private mode would discard the game's persistent storage.
internal sealed class AppWindow : IDisposable {
    // Explicit QA arguments only. A normal double-click never overrides profiles.
    public static string ValidationProfile, ValidationBrowser;
    public sealed class Browser { public string Name, Path; public override string ToString() { return Name + " · 原有用户资料"; } }
    static readonly string preference = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RealmEchoesREBORN", "launcher-browser.txt");
    public static List<Browser> Browsers() {
        var result = new List<Browser>();
        foreach (var item in new string[][] { new[] { "Microsoft Edge", "Microsoft/Edge/Application/msedge.exe" }, new[] { "Google Chrome", "Google/Chrome/Application/chrome.exe" } }) {
            foreach (var folder in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) }) {
                string file = System.IO.Path.Combine(folder, item[1].Replace('/', '\\'));
                if (File.Exists(file)) { result.Add(new Browser { Name = item[0], Path = file }); break; }
            }
        }
        return result;
    }
    public static int Preferred(List<Browser> choices) {
        string name = null;
        if (ValidationProfile != null) for (int i = 0; i < choices.Count; i++) if (choices[i].Name == ValidationBrowser) return i;
        try { if (File.Exists(preference)) name = File.ReadAllText(preference, Encoding.UTF8).Trim(); } catch (IOException) { }
        if (name == null) using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice")) {
            string id = Convert.ToString(key == null ? null : key.GetValue("ProgId"));
            if (id.StartsWith("ChromeHTML")) name = "Google Chrome";
            else if (id.StartsWith("MSEdgeHTM")) name = "Microsoft Edge";
        }
        for (int i = 0; i < choices.Count; i++) if (choices[i].Name == name) return i;
        return -1;
    }
    public static void Remember(Browser browser) {
        if (ValidationProfile != null) return;
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(preference));
        File.WriteAllText(preference, browser.Name, Encoding.UTF8);
    }
    readonly HashSet<IntPtr> before;
    readonly Browser browser;
    readonly System.Windows.Forms.Timer timer;
    readonly Action<string, bool> status;
    readonly Action ended;
    IntPtr window;
    int attempts;
    bool confirmed, keySent, disposed;
    public AppWindow(Browser selected, string url, Action<string, bool> notify, Action closed) {
        browser = selected; status = notify; ended = closed; before = Windows(browser);
        string profile = ValidationProfile == null ? "" : " --user-data-dir=\"" + System.IO.Path.GetFullPath(ValidationProfile).Replace("\"", "") + "\"";
        using (var launched = Process.Start(new ProcessStartInfo(browser.Path, "--app=\"" + url + "\" --start-fullscreen --no-first-run --no-default-browser-check" + profile) { UseShellExecute = false })) { }
        status("正在打开 " + browser.Name + " 的独立全屏窗口。\r\n存档继续保存在该浏览器原有用户资料中。\r\nF11 切换窗口；Alt+Tab 切换应用；Alt+F4 退出。", false);
        timer = new System.Windows.Forms.Timer { Interval = 250 };
        timer.Tick += delegate { Poll(); };timer.Start();
    }
    void Poll() {
        if (disposed) return;
        if (window == IntPtr.Zero) {
            foreach (IntPtr candidate in Windows(browser)) if (!before.Contains(candidate)) {
                var title = new StringBuilder(256);GetWindowText(candidate, title, title.Capacity);
                if (title.ToString().Contains("异境回响")) { window = candidate;break; }
            }
            if (window == IntPtr.Zero) {
                if (++attempts == 160) status("未能自动确认独立游戏窗口。\r\n如果窗口已经打开，请在该游戏窗口按 F11。\r\n本启动器不会切换您原有浏览器窗口的全屏状态。", false);
                return;
            }
        }
        if (!IsWindow(window)) { timer.Stop();ended();return; }
        if (confirmed) return; // Let the player use F11 normally after initial startup.
        if (Fullscreen(window)) {
            confirmed = true;status("游戏已在独立全屏窗口运行。\r\nF11 切换全屏 / 窗口；Alt+Tab 切换应用；Alt+F4 退出。\r\n关闭游戏窗口会同时停止本机服务。", true);return;
        }
        // Already-running Chromium processes can ignore --start-fullscreen.
        // Send F11 only to the newly observed game window, never a prior tab.
        if (!keySent) { keySent = true;PostMessage(window, 0x100, new IntPtr(0x7A), new IntPtr(1));PostMessage(window, 0x101, new IntPtr(0x7A), new IntPtr(unchecked((int)0xC0000001))); }
        if (++attempts == 160) status("游戏已在独立窗口打开；请按 F11 进入全屏。\r\nAlt+Tab 切换应用，Alt+F4 退出。", false);
    }
    public void Activate() { if (window != IntPtr.Zero && IsWindow(window)) { ShowWindow(window, 9);SetForegroundWindow(window); } }
    public void Dispose() { if (disposed) return;disposed = true;timer.Stop();timer.Dispose();if (window != IntPtr.Zero && IsWindow(window)) PostMessage(window, 0x10, IntPtr.Zero, IntPtr.Zero); }
    static HashSet<IntPtr> Windows(Browser browser) {
        var found = new HashSet<IntPtr>();
        EnumWindows(delegate(IntPtr handle, IntPtr unused) {
            if (!IsWindowVisible(handle)) return true;
            uint id;GetWindowThreadProcessId(handle, out id);
            try { using (var p = Process.GetProcessById((int)id)) if (p.ProcessName.Equals(System.IO.Path.GetFileNameWithoutExtension(browser.Path), StringComparison.OrdinalIgnoreCase)) found.Add(handle); }
            catch (ArgumentException) { } // Window/process can disappear between enumeration and lookup.
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
            return true;
        }, IntPtr.Zero);return found;
    }
    static bool Fullscreen(IntPtr handle) {
        RECT window;GetWindowRect(handle, out window);
        var monitor = new MONITORINFO { Size = Marshal.SizeOf(typeof(MONITORINFO)) };
        if (!GetMonitorInfo(MonitorFromWindow(handle, 2), ref monitor)) return false;
        return Math.Abs(window.Left - monitor.Monitor.Left) <= 2 && Math.Abs(window.Top - monitor.Monitor.Top) <= 2 && Math.Abs(window.Right - monitor.Monitor.Right) <= 2 && Math.Abs(window.Bottom - monitor.Monitor.Bottom) <= 2;
    }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int Size; public RECT Monitor, Work; public uint Flags; }
    delegate bool WindowVisitor(IntPtr handle, IntPtr data);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowVisitor visitor, IntPtr data);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr handle);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder text, int length);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr handle, out RECT rectangle);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr handle, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr handle, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr handle, int show);
}

internal sealed class LocalHost : IDisposable {
    readonly string root;
    readonly int port;
    readonly HashSet<string> allowed;
    readonly TcpListener listener;
    readonly HashSet<TcpClient> clients = new HashSet<TcpClient>();
    readonly object gate = new object();
    volatile bool stopping;
    public string Url { get { return "http://127.0.0.1:" + port + "/play.html?v=229"; } }

    public LocalHost(string folder, int requestedPort) {
        if (requestedPort < 1 || requestedPort > 65535) throw new ArgumentException("端口无效。");
        root = Path.GetFullPath(Path.Combine(folder, "game")) + Path.DirectorySeparatorChar;
        allowed = new HashSet<string>(File.ReadAllLines(Path.Combine(folder, "asset-paths.txt"), Encoding.UTF8), StringComparer.Ordinal);
        if (!allowed.Contains("play.html") || !File.Exists(root + "play.html")) throw new FileNotFoundException("缺少 game/play.html。");
        port = requestedPort;
        listener = new TcpListener(IPAddress.Loopback, port);
        listener.Server.ExclusiveAddressUse = true;
        listener.Start(128);
        new Thread(Accept) { IsBackground = true, Name = "REBORN local host" }.Start();
    }

    void Accept() {
        while (!stopping) {
            TcpClient client;
            try { client = listener.AcceptTcpClient(); }
            catch (SocketException) { if (stopping) break; continue; }
            catch (ObjectDisposedException) { break; }
            lock (gate) {
                if (stopping || clients.Count >= 64) { client.Close(); continue; }
                clients.Add(client);
            }
            ThreadPool.QueueUserWorkItem(delegate { Serve(client); });
        }
    }

    void Serve(TcpClient client) {
        try {
            client.ReceiveTimeout = 15000;
            client.SendTimeout = 15000;
            client.NoDelay = true;
            using (NetworkStream stream = client.GetStream()) {
                byte[] requestBuffer = new byte[4096];
                int requestOffset = 0, requestCount = 0;
                for (int count = 0; count < 256 && !stopping; count++) {
                    string request = ReadHeader(stream, requestBuffer, ref requestOffset, ref requestCount);
                    if (request == null) break;
                    string[] lines = request.Split(new string[] { "\r\n" }, StringSplitOptions.None);
                    string[] first = lines[0].Split(' ');
                    var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    for (int i = 1; i < lines.Length; i++) {
                        int colon = lines[i].IndexOf(':');
                        if (colon > 0) headers[lines[i].Substring(0, colon).Trim()] = lines[i].Substring(colon + 1).Trim();
                    }
                    string host, length, transfer;
                    if (first.Length != 3 || !headers.TryGetValue("Host", out host) || host != "127.0.0.1:" + port ||
                        (headers.TryGetValue("Content-Length", out length) && length != "0") || headers.TryGetValue("Transfer-Encoding", out transfer)) {
                        Empty(stream, "400 Bad Request", ""); break;
                    }
                    if (first[0] != "GET" && first[0] != "HEAD") { Empty(stream, "405 Method Not Allowed", "Allow: GET, HEAD\r\n"); break; }
                    string path = Uri.UnescapeDataString(first[1].Split('?')[0]);
                    if (path == "/") path = "/index.html";
                    if (!path.StartsWith("/") || path.Contains("\\") || path.Contains("\0")) { Empty(stream, "404 Not Found", ""); break; }
                    string relative = path.Substring(1);
                    string file = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
                    if (!allowed.Contains(relative) || !file.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(file)) {
                        Empty(stream, "404 Not Found", ""); break;
                    }
                    using (FileStream input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.SequentialScan)) {
                        long start = 0, end = input.Length - 1;
                        string range, connection;
                        bool partial = headers.TryGetValue("Range", out range);
                        if (partial && !ParseRange(range, input.Length, out start, out end)) {
                            Empty(stream, "416 Range Not Satisfiable", "Content-Range: bytes */" + input.Length + "\r\n"); break;
                        }
                        bool keep = count < 255 && first[2] == "HTTP/1.1" && (!headers.TryGetValue("Connection", out connection) || !connection.Equals("close", StringComparison.OrdinalIgnoreCase));
                        long size = Math.Max(0, end - start + 1);
                        string extra = partial ? "Content-Range: bytes " + start + "-" + end + "/" + input.Length + "\r\n" : "";
                        Write(stream, "HTTP/1.1 " + (partial ? "206 Partial Content" : "200 OK") + "\r\nContent-Length: " + size +
                            "\r\nContent-Type: " + Mime(file) + "\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nAccept-Ranges: bytes\r\nConnection: " +
                            (keep ? "keep-alive" : "close") + "\r\n" + extra + "\r\n");
                        if (first[0] != "HEAD") {
                            input.Position = start;
                            byte[] buffer = new byte[65536];
                            while (size > 0) {
                                int read = input.Read(buffer, 0, (int)Math.Min(size, buffer.Length));
                                if (read == 0) break;
                                stream.Write(buffer, 0, read); size -= read;
                            }
                        }
                        if (!keep) break;
                    }
                }
            }
        } catch (IOException) { } catch (SocketException) { } catch (ObjectDisposedException) { }
        catch (ArgumentException) { } catch (UriFormatException) { } catch (NotSupportedException) { }
        finally { client.Close(); lock (gate) clients.Remove(client); }
    }

    static string ReadHeader(NetworkStream stream, byte[] buffer, ref int offset, ref int count) {
        var bytes = new List<byte>(1024);
        while (bytes.Count < 16384) {
            // Read socket data in chunks; one receive per header byte delays first load.
            if (offset == count) {
                count = stream.Read(buffer, 0, buffer.Length); offset = 0;
                if (count == 0) return null;
            }
            bytes.Add(buffer[offset++]);
            int n = bytes.Count;
            if (n >= 4 && bytes[n - 4] == 13 && bytes[n - 3] == 10 && bytes[n - 2] == 13 && bytes[n - 1] == 10) return Encoding.ASCII.GetString(bytes.ToArray());
        }
        return null;
    }
    static bool ParseRange(string range, long size, out long start, out long end) {
        start = 0; end = size - 1;
        if (size == 0 || !range.StartsWith("bytes=") || range.Contains(",")) return false;
        string[] parts = range.Substring(6).Split('-');
        if (parts.Length != 2) return false;
        if (parts[0] == "") {
            long suffix; if (!long.TryParse(parts[1], out suffix) || suffix <= 0) return false;
            start = Math.Max(0, size - suffix);
        } else {
            if (!long.TryParse(parts[0], out start) || start < 0 || start >= size) return false;
            if (parts[1] != "" && (!long.TryParse(parts[1], out end) || end < start)) return false;
            end = Math.Min(end, size - 1);
        }
        return true;
    }
    static void Write(NetworkStream stream, string text) { byte[] data = Encoding.ASCII.GetBytes(text); stream.Write(data, 0, data.Length); }
    static void Empty(NetworkStream stream, string status, string extra) { Write(stream, "HTTP/1.1 " + status + "\r\nContent-Length: 0\r\nConnection: close\r\n" + extra + "\r\n"); }
    static string Mime(string file) {
        switch (Path.GetExtension(file).ToLowerInvariant()) {
            case ".html": return "text/html; charset=utf-8";
            case ".js": case ".mjs": return "text/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".json": return "application/json";
            case ".webmanifest": return "application/manifest+json";
            case ".gltf": return "model/gltf+json";
            case ".glb": return "model/gltf-binary";
            case ".png": return "image/png";
            case ".jpg": case ".jpeg": return "image/jpeg";
            case ".webp": return "image/webp";
            case ".ogg": return "audio/ogg";
            case ".mp3": return "audio/mpeg";
            case ".svg": return "image/svg+xml";
            case ".md": case ".txt": return "text/plain; charset=utf-8";
            default: return "application/octet-stream";
        }
    }
    public void Dispose() {
        stopping = true; listener.Stop();
        lock (gate) { foreach (TcpClient client in clients) client.Close(); }
    }
}
