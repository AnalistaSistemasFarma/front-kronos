import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import {
  PASSKEY_CHALLENGE_COOKIE,
  challengeCookieOptions,
  sealChallenge,
} from '../../../../../lib/auth/passkeys/challenge';
import { passkeyErrorResponse } from '../../../../../lib/auth/passkeys/http';
import { registrationOptions, relyingParty } from '../../../../../lib/auth/passkeys/service';
import { passkeySessionUser } from '../../../../../lib/auth/passkeys/session';

/** POST /api/passkeys/register/options → opciones para que el dispositivo cree la llave. */
export async function POST() {
  try {
    const user = await passkeySessionUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const challenge = randomBytes(32).toString('base64url');
    const options = await registrationOptions(user, challenge);
    const sealed = await sealChallenge({ challenge, purpose: 'register', userId: user.id });
    const res = NextResponse.json(options, { headers: { 'Cache-Control': 'no-store' } });
    res.cookies.set(PASSKEY_CHALLENGE_COOKIE, sealed, challengeCookieOptions(relyingParty().origin.startsWith('https:')));
    return res;
  } catch (error) {
    return passkeyErrorResponse(error, 'POST /api/passkeys/register/options');
  }
}
