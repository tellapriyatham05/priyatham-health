// Talks to the long-running PowerShell helper (helper.ps1) over stdin/stdout.
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

class WinHelper {
  constructor(scriptPath = path.join(__dirname, 'helper.ps1')) {
    this.scriptPath = scriptPath;
    this.nextId = 1;
    this.waiting = new Map();
    this.readyPromise = null;
    this.proc = null;
  }

  start() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise((resolve, reject) => {
      this.proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';
      this.proc.stderr.on('data', (d) => { stderr += d; });
      const lines = readline.createInterface({ input: this.proc.stdout });
      lines.on('line', (line) => {
        let msg;
        try { msg = JSON.parse(line.replace(/^﻿/, '')); } catch { return; }
        if (msg.ready) { clearTimeout(this.startTimer); return resolve(); }
        const pending = this.waiting.get(msg.id);
        if (!pending) return;
        this.waiting.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.ok) pending.resolve(msg.result);
        else pending.reject(new Error(msg.error));
      });
      // A helper that never says it is ready (blocked by antivirus, stuck loading) must not
      // freeze JARVIS: give up after 20 s and start a fresh one on the next call.
      this.startTimer = setTimeout(() => {
        reject(new Error('Windows helper did not start in 20 s'));
        this.readyPromise = null;
        try { this.proc.kill(); } catch { /* already gone */ }
      }, 20000);
      this.proc.on('exit', (code) => {
        clearTimeout(this.startTimer);
        const err = new Error(`Windows helper stopped (code ${code}) ${stderr.slice(-400)}`);
        reject(err);
        for (const p of this.waiting.values()) { clearTimeout(p.timer); p.reject(err); }
        this.waiting.clear();
        this.readyPromise = null; // next call restarts it
      });
    });
    return this.readyPromise;
  }

  async call(cmd, args = {}, timeoutMs = 15000) {
    await this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`Windows helper timed out on "${cmd}"`));
      }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  stop() {
    if (this.proc) this.proc.kill();
  }
}

module.exports = { WinHelper };
