import { NextResponse } from 'next/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { prisma } from '../../../../../lib/prisma';
import { readClientOrigin } from '../../../../../lib/chat/client-origin';
import { parseUserAgent } from '../../../../../lib/auth/login-audit/user-agent';
import {
  PASSKEY_CHALLENGE_COOKIE,
  consumeChallenge,
  readCookie,
} from '../../../../../lib/auth/passkeys/challenge';
import { cleanPasskeyName, passkeyDeviceName } from '../../../../../lib/auth/passkeys/config';
import { passkeyErrorResponse } from '../../../../../lib/auth/passkeys/http';
import { saveRegistration } from '../../../../../lib/auth/passkeys/service';
import { passkeySessionUser } from '../../../../../lib/auth/passkeys/session';

/** POST /api/passkeys/register/verify { response, name? } → guarda la llave pública. */
export async function POST(req: Request) {
  try {
    const user = await passkeySessionUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { response?: RegistrationResponseJSON; name?: unknown } | null;
    if (!body?.response || typeof body.response !== 'object') {
      return NextResponse.json({ error: 'Falta la respuesta del dispositivo' }, { status: 400 });
    }
    const challenge = await consumeChallenge(
      readCookie(req.headers.get('cookie'), PASSKEY_CHALLENGE_COOKIE),
      'register',
      user.id
    );
    if (!challenge) {
      return NextResponse.json({ error: 'El tiempo para registrar el dispositivo venció. Inténtelo de nuevo.' }, { status: 400 });
    }

    const origin = readClientOrigin(req);
    const suggested = passkeyDeviceName(parseUserAgent(origin.userAgent));
    const saved = await saveRegistration(user, body.response, challenge, {
      name: cleanPasskeyName(body.name, suggested),
      clientIp: origin.clientIp,
    });
    await prisma.userAuditLog.create({
      data: {
        user_id: user.id,
        action: 'PASSKEY_ADDED',
        performed_by: user.email,
        details: `Biométrico registrado: ${saved.name}${origin.clientIp ? ` (IP ${origin.clientIp})` : ''}`,
      },
    });
    const res = NextResponse.json({ ok: true, passkey: saved });
    res.cookies.delete(PASSKEY_CHALLENGE_COOKIE);
    return res;
  } catch (error) {
    return passkeyErrorResponse(error, 'POST /api/passkeys/register/verify');
  }
}
