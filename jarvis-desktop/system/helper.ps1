# Jarvis's Windows helper. Started once and kept running; reads one JSON request
# per line on stdin and answers with one JSON line on stdout. Keeping it alive
# means each command runs in milliseconds instead of starting PowerShell again.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int f();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

public static class JarvisWin {
  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)]
  struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  struct INPUT { public uint type; public InputUnion u; }

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SystemParametersInfo(uint action, uint param, string value, uint flags);

  const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
  const uint KEYUP = 0x0002, UNICODE = 0x0004, EXTENDED = 0x0001;

  static INPUT Key(ushort vk, bool up) {
    INPUT i = new INPUT(); i.type = INPUT_KEYBOARD;
    i.u.ki.wVk = vk;
    uint flags = up ? KEYUP : 0;
    if (IsExtended(vk)) flags |= EXTENDED;
    i.u.ki.dwFlags = flags;
    return i;
  }
  static bool IsExtended(ushort vk) {
    // Arrows, Home/End, PgUp/PgDn, Insert/Delete, Win keys and media keys.
    return (vk >= 0x21 && vk <= 0x2E) || vk == 0x5B || vk == 0x5C || (vk >= 0xA6 && vk <= 0xB7);
  }
  static void Send(List<INPUT> list) {
    if (list.Count == 0) return;
    INPUT[] arr = list.ToArray();
    SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
  }

  // Presses a combination such as {0x11, 0x54} = Ctrl+T.
  public static void Combo(int[] vks) {
    List<INPUT> list = new List<INPUT>();
    foreach (int vk in vks) list.Add(Key((ushort)vk, false));
    for (int k = vks.Length - 1; k >= 0; k--) list.Add(Key((ushort)vks[k], true));
    Send(list);
  }

  // Types any text, including Telugu or Hindi script, as real keystrokes.
  public static void TypeText(string text) {
    List<INPUT> list = new List<INPUT>();
    foreach (char c in text) {
      if (c == '\n') { list.Add(Key(0x0D, false)); list.Add(Key(0x0D, true)); continue; }
      INPUT down = new INPUT(); down.type = INPUT_KEYBOARD; down.u.ki.wScan = c; down.u.ki.dwFlags = UNICODE;
      INPUT up = new INPUT(); up.type = INPUT_KEYBOARD; up.u.ki.wScan = c; up.u.ki.dwFlags = UNICODE | KEYUP;
      list.Add(down); list.Add(up);
    }
    Send(list);
  }

  public static void Mouse(string what, int amount) {
    List<INPUT> list = new List<INPUT>();
    Func<uint, uint, INPUT> m = delegate(uint flags, uint data) {
      INPUT i = new INPUT(); i.type = INPUT_MOUSE; i.u.mi.dwFlags = flags; i.u.mi.mouseData = data; return i;
    };
    if (what == "left" || what == "double") {
      int times = what == "double" ? 2 : 1;
      for (int t = 0; t < times; t++) { list.Add(m(0x0002, 0)); list.Add(m(0x0004, 0)); }
    } else if (what == "right") {
      list.Add(m(0x0008, 0)); list.Add(m(0x0010, 0));
    } else if (what == "scroll") {
      list.Add(m(0x0800, unchecked((uint)(amount * 120))));
    }
    Send(list);
  }

  static string Title(IntPtr h) {
    int len = GetWindowTextLength(h);
    StringBuilder sb = new StringBuilder(len + 1);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }
  static string ProcessName(IntPtr h) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
  }

  public static string[] Foreground() {
    IntPtr h = GetForegroundWindow();
    return new string[] { h.ToInt64().ToString(), ProcessName(h), Title(h) };
  }

  // Real app windows: visible, titled, not owned by another window, not a tool window.
  public static List<string[]> Windows() {
    List<string[]> found = new List<string[]>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || GetWindowTextLength(h) == 0) return true;
      if (GetWindow(h, 4) != IntPtr.Zero) return true; // GW_OWNER
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true; // WS_EX_TOOLWINDOW
      found.Add(new string[] { h.ToInt64().ToString(), ProcessName(h), Title(h) });
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static void Show(long hwnd, int cmd) { ShowWindow(new IntPtr(hwnd), cmd); }
  public static void Close(long hwnd) { PostMessage(new IntPtr(hwnd), 0x0010, IntPtr.Zero, IntPtr.Zero); }

  public static bool Focus(long hwnd) {
    IntPtr h = new IntPtr(hwnd);
    if (IsIconic(h)) ShowWindow(h, 9);
    // Windows only lets the app with the last input change focus; a tap of Alt counts.
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    return SetForegroundWindow(h);
  }

  static IAudioEndpointVolume Endpoint() {
    IMMDeviceEnumerator e = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume v; Guid iid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, 0, out v));
    return v;
  }
  public static int GetVolume() { float f; Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out f)); return (int)Math.Round(f * 100); }
  public static void SetVolume(int pct) { Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, pct)) / 100f, Guid.Empty)); }
  public static bool GetMute() { bool m; Marshal.ThrowExceptionForHR(Endpoint().GetMute(out m)); return m; }
  public static void SetMute(bool m) { Marshal.ThrowExceptionForHR(Endpoint().SetMute(m, Guid.Empty)); }

  public static bool SetWallpaper(string path) { return SystemParametersInfo(20, 0, path, 3); }

  // Work in real screen pixels so on-screen element positions and clicks line up at any display scaling.
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  public static void UseRealPixels() { try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { } }

  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  public static void ClickAt(int x, int y, string button) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(40);
    Mouse(button == "right" ? "right" : button == "double" ? "double" : "left", 0);
  }
  public static long ForegroundHandle() { return GetForegroundWindow().ToInt64(); }
}
'@

# --- Wi-Fi / Bluetooth radios (Windows Runtime; no admin needed) -------------
[JarvisWin]::UseRealPixels()

# --- things you can click in the front window (Windows UI Automation) ---------
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$script:A = [System.Windows.Automation.AutomationElement]
$script:clickableTypes = @(
  [System.Windows.Automation.ControlType]::Button, [System.Windows.Automation.ControlType]::Hyperlink,
  [System.Windows.Automation.ControlType]::MenuItem, [System.Windows.Automation.ControlType]::TabItem,
  [System.Windows.Automation.ControlType]::ListItem, [System.Windows.Automation.ControlType]::CheckBox,
  [System.Windows.Automation.ControlType]::RadioButton, [System.Windows.Automation.ControlType]::Edit,
  [System.Windows.Automation.ControlType]::ComboBox, [System.Windows.Automation.ControlType]::TreeItem,
  [System.Windows.Automation.ControlType]::SplitButton, [System.Windows.Automation.ControlType]::DataItem
)
$script:clickableCondition = New-Object System.Windows.Automation.OrCondition -ArgumentList (,[System.Windows.Automation.Condition[]]@(
  $script:clickableTypes | ForEach-Object { New-Object System.Windows.Automation.PropertyCondition -ArgumentList $script:A::ControlTypeProperty, $_ }
))

# Some older apps report their buttons as plain named "Pane"s; include those when asked.
$script:withPanesCondition = New-Object System.Windows.Automation.OrCondition -ArgumentList (,[System.Windows.Automation.Condition[]]@(
  $script:clickableCondition,
  (New-Object System.Windows.Automation.PropertyCondition -ArgumentList $script:A::ControlTypeProperty, ([System.Windows.Automation.ControlType]::Pane))
))

function Get-Clickables([int]$max, [bool]$panes) {
  $hwnd = [JarvisWin]::ForegroundHandle()
  $root = $script:A::FromHandle([IntPtr]$hwnd)
  $win = $root.Current.BoundingRectangle
  $cache = New-Object System.Windows.Automation.CacheRequest
  foreach ($p in @($script:A::NameProperty, $script:A::ControlTypeProperty, $script:A::BoundingRectangleProperty,
                   $script:A::IsOffscreenProperty, $script:A::IsEnabledProperty, $script:A::HelpTextProperty)) { $cache.Add($p) }
  $cache.AutomationElementMode = [System.Windows.Automation.AutomationElementMode]::None
  $cache.TreeScope = [System.Windows.Automation.TreeScope]::Element
  $scope = $cache.Activate()
  $cond = if ($panes) { $script:withPanesCondition } else { $script:clickableCondition }
  try { $found = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond) } finally { $scope.Dispose() }
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($e in $found) {
    $c = $e.Cached
    if ($c.IsOffscreen -or -not $c.IsEnabled) { continue }
    $r = $c.BoundingRectangle
    if ($r.IsEmpty -or $r.Width -lt 4 -or $r.Height -lt 4) { continue }
    $isPane = $c.ControlType -eq [System.Windows.Automation.ControlType]::Pane
    if ($isPane -and (-not $c.Name -or $r.Height -gt 90)) { continue }
    # only what you can actually see inside the window
    if ($r.X + $r.Width / 2 -lt $win.X -or $r.X + $r.Width / 2 -gt $win.Right -or $r.Y + $r.Height / 2 -lt $win.Y -or $r.Y + $r.Height / 2 -gt $win.Bottom) { continue }
    $out.Add(@{ name = "$($c.Name)"; help = "$($c.HelpText)"; type = $c.ControlType.ProgrammaticName.Replace('ControlType.', '');
      x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height })
    if ($out.Count -ge $max) { break }
  }
  return ,$out.ToArray()
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$type) {
  $task = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
[Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null
[Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null
[Windows.Devices.Radios.RadioState, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null

function Get-Radio([string]$kind) {
  Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
  $radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
  $radios | Where-Object { $_.Kind -eq $kind } | Select-Object -First 1
}

function Invoke-Request($req) {
  $a = $req.args
  switch ($req.cmd) {
    'ping' { return 'pong' }
    'combo' { [JarvisWin]::Combo([int[]]$a.keys); return $true }
    'type' {
      $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($a.b64))
      [JarvisWin]::TypeText($text); return $true
    }
    'mouse' { [JarvisWin]::Mouse($a.what, [int]$a.amount); return $true }
    'foreground' { $f = [JarvisWin]::Foreground(); return @{ hwnd = $f[0]; process = $f[1]; title = $f[2] } }
    'windows' { return ,@([JarvisWin]::Windows() | ForEach-Object { @{ hwnd = $_[0]; process = $_[1]; title = $_[2] } }) }
    'show' { [JarvisWin]::Show([long]$a.hwnd, [int]$a.cmd); return $true }
    'close' { [JarvisWin]::Close([long]$a.hwnd); return $true }
    'focus' { return [JarvisWin]::Focus([long]$a.hwnd) }
    'volume-get' { return @{ volume = [JarvisWin]::GetVolume(); muted = [JarvisWin]::GetMute() } }
    'volume-set' { [JarvisWin]::SetVolume([int]$a.volume); return [JarvisWin]::GetVolume() }
    'mute-set' { [JarvisWin]::SetMute([bool]$a.muted); return [JarvisWin]::GetMute() }
    'wallpaper-set' { return [JarvisWin]::SetWallpaper($a.path) }
    'radio-get' {
      $r = Get-Radio $a.kind
      if (-not $r) { throw "No $($a.kind) radio on this PC" }
      return "$($r.State)"
    }
    'radio-set' {
      $r = Get-Radio $a.kind
      if (-not $r) { throw "No $($a.kind) radio on this PC" }
      $status = Await ($r.SetStateAsync($a.state)) ([Windows.Devices.Radios.RadioAccessStatus])
      if ("$status" -ne 'Allowed') { throw "Windows refused to change $($a.kind) ($status)" }
      return "$((Get-Radio $a.kind).State)"
    }
    'brightness-get' {
      $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1
      return [int]$b.CurrentBrightness
    }
    'brightness-set' {
      $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1
      Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$a.level } | Out-Null
      return [int]$a.level
    }
    'clickables' { return Get-Clickables ([int]$(if ($a.max) { $a.max } else { 300 })) ([bool]$a.panes) }
    'click-at' { [JarvisWin]::ClickAt([int]$a.x, [int]$a.y, "$($a.button)"); return $true }
    'start-apps' { return ,@(Get-StartApps | ForEach-Object { @{ name = $_.Name; id = $_.AppID } }) }
    default { throw "Unknown helper command: $($req.cmd)" }
  }
}

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $req = $null
  try {
    $req = $line | ConvertFrom-Json
    $result = Invoke-Request $req
    $out = @{ id = $req.id; ok = $true; result = $result }
  } catch {
    $id = if ($req) { $req.id } else { $null }
    $out = @{ id = $id; ok = $false; error = "$($_.Exception.Message)" }
  }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
