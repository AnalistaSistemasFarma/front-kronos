import { afterEach, expect, it, vi } from 'vitest';
import { isVoiceOriginAllowed } from './voice-origin';
afterEach(() => vi.unstubAllEnvs());
const request = (origin?: string) => new Request('http://localhost:3030/api/chat/conversations/13/voice', { headers: origin ? { origin } : {} });
it('accepts the configured HTTPS public origin behind a proxy', () => {
  vi.stubEnv('NEXTAUTH_URL', 'https://chat.example');
  expect(isVoiceOriginAllowed(request('https://chat.example'))).toBe(true);
  expect(isVoiceOriginAllowed(request('http://localhost:3030'))).toBe(false);
});
it('rejects foreign, missing and opaque origins', () => {
  vi.stubEnv('NEXTAUTH_URL', 'https://chat.example');
  for (const origin of [undefined, 'null', 'https://evil.example', 'https://chat.example.evil.example', 'http://chat.example']) {
    expect(isVoiceOriginAllowed(request(origin))).toBe(false);
  }
});
it('does not trust spoofed forwarded headers', () => {
  vi.stubEnv('NEXTAUTH_URL', 'https://chat.example');
  const req = request('https://evil.example');
  req.headers.set('x-forwarded-host', 'evil.example');
  req.headers.set('x-forwarded-proto', 'https');
  expect(isVoiceOriginAllowed(req)).toBe(false);
});
it('supports direct access without public configuration and fails closed on invalid config', () => {
  vi.stubEnv('NEXTAUTH_URL', '');
  expect(isVoiceOriginAllowed(request('http://localhost:3030'))).toBe(true);
  vi.stubEnv('NEXTAUTH_URL', 'invalid');
  expect(isVoiceOriginAllowed(request('http://localhost:3030'))).toBe(false);
});
