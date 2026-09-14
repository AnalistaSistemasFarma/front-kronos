import { mkdirSync, writeFileSync, renameSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Gateway-owned final events only: no deltas, tool results, or session history
// replay (which would duplicate spoken answers and import unrelated turns).
export function finalTranscript(frame, voiceSessionId) {
  if (frame?.event !== 'talk.event' || !voiceSessionId || frame.payload?.voiceSessionId !== voiceSessionId) return null;
  const event = frame.payload.talkEvent;
  if (event?.final !== true || !['transcript.done', 'output.text.done'].includes(event.type) ||
      typeof event.id !== 'string' || typeof event.payload?.text !== 'string' || !event.payload.text.trim()) return null;
  if (event.type === 'transcript.done' && event.payload.role !== 'user') return null;
  return { eventId: event.id, role: event.type === 'transcript.done' ? 'user' : 'assistant',
    text: event.payload.text, timestamp: event.timestamp };
}
export function createVoiceAuditOutbox(directory, send) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let draining = false;
  return {
    enqueue(callId, transcript) {
      const name = createHash('sha256').update(`${callId}:${transcript.eventId}`).digest('hex') + '.json';
      const path = join(directory, name);
      writeFileSync(path + '.tmp', JSON.stringify({ action: 'transcript', callId, transcript }), { mode: 0o600 });
      renameSync(path + '.tmp', path);
    },
    async drain() {
      if (draining) return;
      draining = true;
      try {
        const pending = readdirSync(directory).filter(n => /^[a-f0-9]{64}\.json$/.test(n)).map(name => {
          const path = join(directory, name);
          return { path, payload: JSON.parse(readFileSync(path, 'utf8')) };
        }).sort((a, b) => Date.parse(a.payload.transcript.timestamp) - Date.parse(b.payload.transcript.timestamp)
          || a.payload.transcript.eventId.localeCompare(b.payload.transcript.eventId, 'en', { numeric: true }));
        for (const { path, payload } of pending) {
          if (!(await send(payload)).ok) throw new Error('Voice audit unacknowledged');
          unlinkSync(path);
        }
      } finally { draining = false; }
    },
  };
}
