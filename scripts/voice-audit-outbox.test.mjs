import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVoiceAuditOutbox, finalTranscript } from './voice-audit-outbox.mjs';
const event = { event: 'talk.event', payload: { voiceSessionId: 'voice-1', talkEvent: {
  id: 'voice-1:7', type: 'transcript.done', final: true, timestamp: new Date().toISOString(), payload: { role: 'user', text: 'Hola' },
} } };
test('only owning-call final transcripts are exported, never deltas or consult outputs', () => {
  assert.equal(finalTranscript(event, 'other'), null);
  assert.equal(finalTranscript({ ...event, event: 'agent' }, 'voice-1'), null);
  assert.equal(finalTranscript({ ...event, payload: { ...event.payload, talkEvent: { ...event.payload.talkEvent, final: false } } }, 'voice-1'), null);
  assert.equal(finalTranscript(event, 'voice-1').role, 'user');
  assert.equal(finalTranscript({ ...event, payload: { ...event.payload, talkEvent: { ...event.payload.talkEvent, type: 'output.text.done', payload: { text: 'Respuesta' } } } }, 'voice-1').role, 'assistant');
});
test('outbox survives HTTP failure and process restart; one event has one durable slot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-audit-test-'));
  try {
    const transcript = finalTranscript(event, 'voice-1');
    const first = createVoiceAuditOutbox(dir, async () => { throw new Error('offline'); });
    first.enqueue('call-1', transcript); first.enqueue('call-1', transcript);
    await assert.rejects(first.drain());
    assert.equal(readdirSync(dir).length, 1);
    let sent;
    const restarted = createVoiceAuditOutbox(dir, async body => { sent = body; return { ok: true }; });
    await restarted.drain();
    assert.equal(sent.callId, 'call-1'); assert.equal(sent.transcript.text, 'Hola');
    assert.equal(readdirSync(dir).length, 0);
  } finally { rmSync(dir, { recursive: true }); }
});

test('replays pending finals chronologically, not by hashed filename', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-audit-order-'));
  try {
    const sent = [];
    const outbox = createVoiceAuditOutbox(dir, async body => { sent.push(body.transcript.eventId); return { ok: true }; });
    const transcript = finalTranscript(event, 'voice-1');
    outbox.enqueue('call-1', { ...transcript, eventId: 'voice-1:15', timestamp: '2026-09-10T16:00:01Z' });
    outbox.enqueue('call-1', { ...transcript, eventId: 'voice-1:10', timestamp: '2026-09-10T16:00:00Z' });
    outbox.enqueue('call-1', { ...transcript, eventId: 'voice-1:2', timestamp: '2026-09-10T16:00:00Z' });
    await outbox.drain();
    assert.deepEqual(sent, ['voice-1:2', 'voice-1:10', 'voice-1:15']);
  } finally { rmSync(dir, { recursive: true }); }
});
