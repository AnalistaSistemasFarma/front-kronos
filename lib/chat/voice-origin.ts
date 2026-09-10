/** Use the configured public URL behind proxies, never untrusted forwarded headers. */
export function isVoiceOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  try {
    const expected = new URL(process.env.NEXTAUTH_URL || request.url);
    if (!['https:', 'http:'].includes(expected.protocol)) return false;
    return origin === expected.origin;
  } catch {
    return false;
  }
}
