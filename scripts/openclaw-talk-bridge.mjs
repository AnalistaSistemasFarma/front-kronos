// Run on the OpenClaw host. Existing SynerLink connector credentials remain
// local; OpenClaw's SDK uses its paired device, never a browser-supplied token.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { finalTranscript, createVoiceAuditOutbox } from './voice-audit-outbox.mjs';
import { GatewayClient } from '/opt/homebrew/lib/node_modules/openclaw/dist/plugin-sdk/gateway-runtime.js';

if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node openclaw-talk-bridge.mjs <existing-connector-env> <testing-base-url>');
process.loadEnvFile(process.argv[2]);
const base = new URL(process.argv[3]);
if (base.username || base.password || base.search || base.hash) throw new Error('Invalid testing origin');
const key = process.env.SYNERLINK_AGENT_KEY;
if (!key) throw new Error('Missing existing SynerLink connector credential');
const sessions = new Map();
let quitting = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(method, data) {
  const response = await fetch(new URL('/api/chat/agent/voice', base), {
    method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`SynerLink voice HTTP ${response.status}`);
  return response.json();
}
const audit = createVoiceAuditOutbox(join(homedir(), '.openclaw', 'synerlink-voice-audit-testing'), data => api('POST', data));
async function close(id) {
  const call = sessions.get(id); if (!call || call.closing) return;
  call.closing = true; clearTimeout(call.timer);
  try { if (call.voiceSessionId) await call.client.request('talk.client.close', { sessionKey: call.sessionKey, voiceSessionId: call.voiceSessionId }); } catch { /* disconnect also fences authority */ }
  sessions.delete(id); call.client.stop();
}
async function open(job) {
  if (!Number.isSafeInteger(job.conversation) || job.conversation <= 0 || typeof job.offer !== 'string') return;
  // Testing has its own namespace; never attach to a production conversation
  // just because independent databases assigned the same numeric id.
  const sessionKey = `agent:duo:synerlink-testing-${job.conversation}`;
  let ready, reject;
  const connected = new Promise((resolve, fail) => { ready = resolve; reject = fail; });
  const client = new GatewayClient({ url: 'ws://127.0.0.1:18789', clientName: 'cli', mode: 'cli', scopes: ['operator.read', 'operator.write'],
    onEvent: frame => {
      const transcript = finalTranscript(frame, sessions.get(job.id)?.voiceSessionId);
      if (transcript) {
        try { audit.enqueue(job.id, transcript); }
        catch { console.error('Voice audit spool unavailable'); void close(job.id); }
      }
    },
    onHelloOk: ready, onConnectError: () => reject(new Error('Gateway connection rejected')),
    onClose: () => { if (sessions.has(job.id)) void close(job.id); },
  });
  const call = { client, sessionKey, timer: setTimeout(() => { reject(new Error('Talk timeout')); void close(job.id); }, 30_000) };
  sessions.set(job.id, call);
  try {
    client.start(); await connected;
    const config = await client.request('talk.client.create', { sessionKey, provider: 'openai', model: 'gpt-live-1-codex', mode: 'realtime', transport: 'webrtc', brain: 'agent-consult', capabilities: ['gateway-control-v1'] });
    call.voiceSessionId = config.voiceSessionId;
    if (!sessions.has(job.id)) { await client.request('talk.client.close', { sessionKey, voiceSessionId: config.voiceSessionId }); return; }
    if (config.clientControl?.owner !== 'gateway' || config.offerUrl !== '/plugins/openai/realtime/calls') throw new Error('Unsupported Talk transport');
    const response = await fetch(new URL(config.offerUrl, 'http://127.0.0.1:18789'), {
      method: 'POST', headers: { Authorization: `Bearer ${config.clientSecret}`, 'Content-Type': 'application/sdp' }, body: job.offer, signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error('OpenClaw offer failed');
    const sdp = await response.text();
    if (!sdp.startsWith('v=0') || sdp.length > 262144) throw new Error('Invalid SDP answer');
    if (!(await api('POST', { callId: job.id, sdp })).ok) { await close(job.id); return; }
    clearTimeout(call.timer); call.timer = setTimeout(() => void close(job.id), 10 * 60_000);
  } catch {
    // Never log SDK responses, offer tokens, credentials or provider errors.
    console.error('Talk connection failed');
    await api('POST', { callId: job.id }).catch(() => {}); await close(job.id);
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { quitting = true; });
while (!quitting) {
  // Independent from transport: audit downtime must not drop an active call.
  void audit.drain().catch(() => console.error('Voice audit pending; retrying'));
  try {
    const result = await api('GET');
    for (const id of sessions.keys()) if (!result.active.includes(id)) await close(id);
    for (const offer of result.offers) if (!sessions.has(offer.id)) void open(offer);
  } catch {
    console.error('SynerLink voice poll unavailable');
    for (const id of sessions.keys()) await close(id);
    await delay(4000);
  }
  await delay(1000);
}
await Promise.all([...sessions.keys()].map(close));

await audit.drain().catch(() => console.error("Voice audit retained for next startup"));
