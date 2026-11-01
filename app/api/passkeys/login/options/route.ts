import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { readClientOrigin } from '../../../../../lib/chat/client-origin';
import {
  PASSKEY_CHALLENGE_COOKIE,
  challengeCookieOptions,
  sealChallenge,
} from '../../../../../lib/auth/passkeys/challenge';
import { allowPublicHit, passkeyErrorResponse } from '../../../../../lib/auth/passkeys/http';
import { loginOptions, relyingParty } from '../../../../../lib/auth/passkeys/service';

/**
 * POST /api/passkeys/login/options (PÚBLICA, sin sesión) → reto para entrar con biométrico.
 * No revela nada de los usuarios: no recibe correo y devuelve las mismas opciones a todos.
 */
export async function POST(req: Request) {
  try {
    if (!allowPublicHit(readClientOrigin(req).clientIp)) {
      return NextResponse.json({ error: 'Demasiados intentos. Espere un minuto.' }, { status: 429 });
    }
    const challenge = randomBytes(32).toString('base64url');
    const options = await loginOptions(challenge);
    const sealed = await sealChallenge({ challenge, purpose: 'login' });
    const res = NextResponse.json(options, { headers: { 'Cache-Control': 'no-store' } });
    res.cookies.set(PASSKEY_CHALLENGE_COOKIE, sealed, challengeCookieOptions(relyingParty().origin.startsWith('https:')));
    return res;
  } catch (error) {
    return passkeyErrorResponse(error, 'POST /api/passkeys/login/options');
  }
}
