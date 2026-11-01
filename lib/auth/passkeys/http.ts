/** Respuestas comunes de las rutas de passkeys. */
import 'server-only';
import { NextResponse } from 'next/server';
import { PasskeyRequestError, PasskeysUnavailableError } from './service';

export function passkeyErrorResponse(error: unknown, where: string) {
  if (error instanceof PasskeysUnavailableError) {
    return NextResponse.json({ error: error.message, available: false }, { status: 503 });
  }
  if (error instanceof PasskeyRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`Error ${where}:`, error);
  return NextResponse.json({ error: 'No se pudo completar la operación con el biométrico.' }, { status: 500 });
}

/** Tope simple por IP para la ruta pública de login (se reinicia cada minuto). */
const hits = new Map<string, { minute: number; count: number }>();
export function allowPublicHit(ip: string | null, perMinute = 30): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const key = ip ?? 'sin-ip';
  const entry = hits.get(key);
  if (!entry || entry.minute !== minute) {
    if (hits.size > 5_000) hits.clear();
    hits.set(key, { minute, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= perMinute;
}
