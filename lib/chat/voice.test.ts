import { expect, it, vi } from 'vitest';
import { answerVoiceCall, closeVoiceCall, createVoiceCall, getVoiceCall, pollVoiceCalls, touchVoiceCall } from './voice-broker';
it('isolates users, conversations and agents', () => {
  const id = createVoiceCall(501, 47, 'pilot-a', 'v=0')!;
  expect(getVoiceCall(id, 'other', 47)).toBeUndefined();
  expect(getVoiceCall(id, 'pilot-a', 48)).toBeUndefined();
  expect(pollVoiceCalls(502).offers).toEqual([]);
  expect(answerVoiceCall(502, id, 'v=0 answer')).toBe(false);
  expect(pollVoiceCalls(501).offers).toHaveLength(1);
  expect(pollVoiceCalls(501).offers).toHaveLength(0);
  expect(answerVoiceCall(501, id, 'v=0 answer')).toBe(true);
  expect(getVoiceCall(id, 'pilot-a', 47)?.answer).toBe('v=0 answer');
  closeVoiceCall(id, 'other', 47);
  expect(getVoiceCall(id, 'pilot-a', 47)).toBeDefined();
  closeVoiceCall(id, 'pilot-a', 47);
});
it('limits one call per operator and expires abandoned calls', () => {
  vi.useFakeTimers();
  const id = createVoiceCall(501, 47, 'pilot-b', 'v=0')!;
  expect(createVoiceCall(501, 47, 'pilot-b', 'v=0')).toBeNull();
  vi.advanceTimersByTime(30_000); touchVoiceCall(id, 'pilot-b', 47);
  vi.advanceTimersByTime(30_000); expect(getVoiceCall(id, 'pilot-b', 47)).toBeDefined();
  vi.advanceTimersByTime(46_000); expect(getVoiceCall(id, 'pilot-b', 47)).toBeUndefined();
  expect(answerVoiceCall(501, id, 'v=0')).toBe(false);
  vi.useRealTimers();
});
