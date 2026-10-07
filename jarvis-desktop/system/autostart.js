// Keeps Jarvis running: starts it when you sign in to Windows, and a keep-alive task
// launches it every 5 minutes in case it ever closed. A launch while Jarvis is already
// running does nothing (single-instance lock + --background). "Quit Jarvis" from the
// menu is respected until the next sign-in.
const { execFile } = require('child_process');

const TASK_LOGIN = 'Jarvis - start at login';
const TASK_KEEPALIVE = 'Jarvis - keep running';

function runPowerShell(script, log) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
    { windowsHide: true }, (err, _out, stderr) => {
      if (err) log(`startup task update failed: ${stderr || err.message}`);
      else log('startup tasks updated');
    });
}

function setAutoStart(app, on, log = () => {}) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: on, args: ['--background', '--login'] });
  const exe = process.execPath.replace(/'/g, "''");
  if (!on) {
    runPowerShell(`
      Unregister-ScheduledTask -TaskName '${TASK_LOGIN}' -Confirm:$false -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName '${TASK_KEEPALIVE}' -Confirm:$false -ErrorAction SilentlyContinue`, log);
    return;
  }
  runPowerShell(`
    $ErrorActionPreference = 'Stop'
    $exe = '${exe}'
    $user = "$env:USERDOMAIN\\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName '${TASK_LOGIN}' -Force -Settings $settings -Principal $principal \`
      -Action (New-ScheduledTaskAction -Execute $exe -Argument '--background --login') \`
      -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $user) | Out-Null
    Register-ScheduledTask -TaskName '${TASK_KEEPALIVE}' -Force -Settings $settings -Principal $principal \`
      -Action (New-ScheduledTaskAction -Execute $exe -Argument '--background') \`
      -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)) | Out-Null`, log);
}

module.exports = { setAutoStart, TASK_LOGIN, TASK_KEEPALIVE };
