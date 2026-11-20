#!/usr/bin/env node
// Service Layer collector of the SAP monitor. Runs on the horus Mac (launchd com.horus.monitor-sap,
// every 5 min) — NEVER as a task on the SAP server. Each run opens ONE read-only SSH session to
// serfarma07 and runs a short PowerShell that:
//   - reads the NEW bytes of the balancer access log and of the Securityevent log since the last
//     offset (FileShare.ReadWrite, at most MAX_BYTES per file, no locks on the log);
//   - lists the httpd processes of the b1s500xx services (handles, memory, threads).
// Then it aggregates here (view calls per 5 min, logins/logouts per hour), keeps the offsets in
// STATE_DIR/state.json and POSTs the aggregates to SynerLink (/api/system-metrics/sap/ingest).
// Raw lines and session ids never leave this Mac (only counts are sent; nothing is kept but offsets).
//
// Config: env file given by --env (default ~/.horus/monitor-sap/collector.env):
//   SAP_MONITOR_INGEST_URL   e.g. https://<testing>/api/system-metrics/sap/ingest
//   SAP_MONITOR_INGEST_KEY   Bearer key (same as SAP_MONITOR_INGEST_KEYS on the server)
//   SAP_MONITOR_DRY_RUN      1 = post with dryRun:true (server validates, writes nothing) — default 1
//   SAP_MONITOR_SSH_HOST     default serfarma07 (alias in ~/.ssh/config)
//   SAP_MONITOR_STATE_DIR    default ~/.horus/monitor-sap
//   SAP_MONITOR_FIRST_RUN_BYTES  bytes read back on the very first run (default 256 KB, max 4 MB)
// Flags: --once (default), --print (print payload summary), --no-post.
//
// Install on the horus Mac (DISABLED until the production go):
//   mkdir -p ~/.horus/monitor-sap && chmod 700 ~/.horus/monitor-sap
//   cp scripts/sap-monitor/{collector,slLog}.mjs ~/.horus/monitor-sap/
//   cp scripts/sap-monitor/com.horus.monitor-sap.plist ~/Library/LaunchAgents/
//   launchctl disable gui/$(id -u)/com.horus.monitor-sap
// Go-live: SAP_MONITOR_DRY_RUN=0 in collector.env, then launchctl enable … && launchctl bootstrap gui/$(id -u) <plist>.
// Rollback: launchctl bootout gui/$(id -u)/com.horus.monitor-sap && launchctl disable gui/$(id -u)/com.horus.monitor-sap

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aggregateSessions, aggregateViewCalls, completeLines, parseAccessLine, parseSecurityLine } from './slLog.mjs';

const args = new Set(process.argv.slice(2));
const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const HOME = os.homedir();
const envFile = argValue('--env') ?? path.join(HOME, '.horus/monitor-sap/collector.env');
const env = { ...process.env };
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2];
  }
}
const SSH_HOST = env.SAP_MONITOR_SSH_HOST || 'serfarma07';
const STATE_DIR = (env.SAP_MONITOR_STATE_DIR || path.join(HOME, '.horus/monitor-sap')).replace(/^~/, HOME);
const DRY_RUN = env.SAP_MONITOR_DRY_RUN !== '0';
const MAX_BYTES = 4 * 1024 * 1024;
const FIRST_RUN_BYTES = Math.min(Number(env.SAP_MONITOR_FIRST_RUN_BYTES) || 256 * 1024, MAX_BYTES);
const SSH_TIMEOUT_MS = 90_000;

const log = (...a) => console.log(new Date().toISOString(), ...a);
fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
const statePath = path.join(STATE_DIR, 'state.json');
const lockPath = path.join(STATE_DIR, 'run.lock');

// Skip if the previous run is still alive (lock younger than 10 min).
try {
  const st = fs.statSync(lockPath);
  if (Date.now() - st.mtimeMs < 10 * 60_000) {
    log('Corrida anterior aún activa; se omite este ciclo.');
    process.exit(0);
  }
} catch {}
fs.writeFileSync(lockPath, String(process.pid));
const releaseLock = () => fs.rmSync(lockPath, { force: true });

const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { access: null, security: null };

function powershell(request) {
  const req = JSON.stringify(request).replace(/'/g, "''");
  return `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
$req = ConvertFrom-Json '${req}'
$dir = 'C:\\Program Files\\SAP\\SAP Business One ServerTools\\ServiceLayer\\logs'
function Read-Tail($pattern, $st) {
  $files = @(Get-ChildItem -Path $dir -Filter $pattern -File | Sort-Object Name)
  if ($files.Count -eq 0) { return @() }
  if ($st -and $st.file) { $files = @($files | Where-Object { $_.Name -ge $st.file } | Select-Object -Last 2) } else { $files = @($files | Select-Object -Last 1) }
  $out = @()
  foreach ($f in $files) {
    $start = 0
    if ($st -and $st.file -eq $f.Name) { $start = [int64]$st.offset } elseif (-not ($st -and $st.file)) { $start = [math]::Max(0, $f.Length - $req.firstRunBytes) }
    if ($start -gt $f.Length) { $start = 0 }
    $len = [math]::Min($f.Length - $start, $req.maxBytes)
    $b64 = ''
    if ($len -gt 0) {
      $fs = [System.IO.File]::Open($f.FullName, 'Open', 'Read', 'ReadWrite')
      try { [void]$fs.Seek($start, 'Begin'); $buf = New-Object byte[] $len; $n = $fs.Read($buf, 0, $len); $b64 = [Convert]::ToBase64String($buf, 0, $n) } finally { $fs.Dispose() }
    }
    $out += [pscustomobject]@{ file = $f.Name; start = $start; size = $f.Length; data = $b64; firstRun = (-not ($st -and $st.file)) }
  }
  return $out
}
$access = Read-Tail 'access_50000_log_*' $req.access
$security = Read-Tail 'Securityevent.*.b1s.log' $req.security
$svc = @{}
Get-CimInstance Win32_Service -Filter "Name LIKE 'b1s5%'" | ForEach-Object { if ($_.ProcessId) { $svc[[int]$_.ProcessId] = $_.Name } }
$parent = @{}
Get-CimInstance Win32_Process -Filter "Name='httpd.exe'" | ForEach-Object { $parent[[int]$_.ProcessId] = [int]$_.ParentProcessId }
$nodes = @(Get-Process -Name httpd -ErrorAction SilentlyContinue | ForEach-Object {
  $name = $svc[[int]$_.Id]; if (-not $name) { $name = $svc[[int]$parent[[int]$_.Id]] }
  if ($name) { [pscustomobject]@{ service = $name; pid = $_.Id; handles = $_.Handles; memMb = [math]::Round($_.WorkingSet64 / 1MB); threads = $_.Threads.Count; startedAt = $_.StartTime.ToUniversalTime().ToString('o') } }
})
[pscustomobject]@{ access = @($access); security = @($security); nodes = $nodes; now = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress -Depth 4`;
}

function runSsh(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', SSH_HOST, `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM'); // our own ssh child only
      reject(new Error(`SSH superó ${SSH_TIMEOUT_MS / 1000} s`));
    }, SSH_TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`SSH terminó con código ${code}: ${err.trim().slice(0, 300)}`));
      const start = out.indexOf('{');
      try {
        resolve(JSON.parse(out.slice(start)));
      } catch {
        reject(new Error(`Respuesta no JSON (${out.length} bytes)`));
      }
    });
  });
}

/** Turns the chunks of one log into complete lines and the next offset. */
function consume(chunks, prev) {
  const lines = [];
  let next = prev;
  for (const c of chunks ?? []) {
    const text = Buffer.from(c.data || '', 'base64').toString('latin1');
    let { lines: ls, consumed } = completeLines(text);
    // First run starts in the middle of a line: drop it.
    if (c.firstRun && c.start > 0 && ls.length) ls = ls.slice(1);
    lines.push(...ls);
    next = { file: c.file, offset: Number(c.start) + consumed };
  }
  return { lines, next };
}

async function main() {
  const t0 = Date.now();
  const res = await runSsh(powershell({ access: state.access, security: state.security, maxBytes: MAX_BYTES, firstRunBytes: FIRST_RUN_BYTES }));
  const access = consume(res.access, state.access);
  const security = consume(res.security, state.security);

  const secEntries = security.lines.map((l) => parseSecurityLine(l)).filter(Boolean);
  const { sessions } = aggregateSessions(secEntries);

  const accEntries = access.lines.map((l) => parseAccessLine(l)).filter(Boolean);
  const viewCalls = aggregateViewCalls(accEntries);
  const nodes = (Array.isArray(res.nodes) ? res.nodes : res.nodes ? [res.nodes] : []).map((nd) => ({
    service: String(nd.service).toLowerCase(),
    pid: nd.pid,
    handles: nd.handles,
    memMb: nd.memMb,
    threads: nd.threads,
    startedAt: nd.startedAt,
  }));

  const payload = { source: 'serfarma07', collectedAt: res.now ?? new Date().toISOString(), dryRun: DRY_RUN, nodes, viewCalls, sessions };
  const summary = {
    sshMs: Date.now() - t0,
    accessLines: access.lines.length,
    accessFrom: accEntries[0]?.at?.toISOString() ?? null,
    accessTo: accEntries[accEntries.length - 1]?.at?.toISOString() ?? null,
    securityLines: security.lines.length,
    nodes: nodes.length,
    maxHandles: nodes.reduce((m, nd) => Math.max(m, nd.handles), 0),
    viewCalls: viewCalls.length,
    viewTimeouts: viewCalls.reduce((s, v) => s + v.timeouts, 0),
    sessionRows: sessions.length,
    dryRun: DRY_RUN,
  };
  fs.writeFileSync(path.join(STATE_DIR, 'last-payload.json'), JSON.stringify(payload, null, 2), { mode: 0o600 });

  let posted = 'sin-envio';
  if (!args.has('--no-post') && env.SAP_MONITOR_INGEST_URL && env.SAP_MONITOR_INGEST_KEY) {
    const r = await fetch(env.SAP_MONITOR_INGEST_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.SAP_MONITOR_INGEST_KEY}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await r.text();
    posted = `${r.status} ${text.slice(0, 200)}`;
    // Keep the offsets only if the server took the data (or in dry-run, where nothing is stored anyway).
    if (!r.ok) throw new Error(`Ingesta respondió ${posted}`);
  }
  // In dry-run without a server the offsets also advance, so the next run reads only new lines.
  state.access = access.next;
  state.security = security.next;
  delete state.sids;
  fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  log('OK', JSON.stringify(summary), 'envío:', posted);
  if (args.has('--print')) console.log(JSON.stringify({ ...payload, sessions: payload.sessions.slice(0, 20), viewCalls: payload.viewCalls.slice(0, 20) }, null, 2));
}

main()
  .then(() => {
    releaseLock();
    process.exit(0);
  })
  .catch((e) => {
    releaseLock();
    log('ERROR', e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
