/**
 * ACCESO CON BIOMÉTRICO (passkeys) — lógica de servidor sobre dbo.user_passkey.
 *
 * - Registrar: solo con sesión iniciada (Mi perfil). Se guarda la llave pública.
 * - Entrar: el dispositivo firma un reto; se busca la llave por su id, se verifica la
 *   firma y que la persona siga activa y no sea proveedor. Exige verificación del
 *   usuario (biométrico o PIN del dispositivo): un toque sin desbloqueo no basta.
 * - Si la tabla aún no existe (pase sin SQL), todo responde «no disponible» y el login
 *   normal sigue igual.
 */
import 'server-only';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { prisma } from '../../prisma';
import { SUPPLIER_ROLE } from '../../proveedor/isolation';
import type { LoginFailureReason } from '../login-audit/constants';
import {
  MAX_PASSKEYS_PER_USER,
  PASSKEY_TIMEOUT_MS,
  isCredentialId,
  parseTransports,
  resolveRelyingParty,
  serializeTransports,
  type RelyingParty,
} from './config';

export class PasskeysUnavailableError extends Error {
  constructor(message = 'El acceso con biométrico no está disponible en este momento.') {
    super(message);
    this.name = 'PasskeysUnavailableError';
  }
}

export class PasskeyRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'PasskeyRequestError';
  }
}

export function relyingParty(): RelyingParty {
  const rp = resolveRelyingParty(process.env);
  if (!rp) throw new PasskeysUnavailableError('El sitio no tiene una URL HTTPS configurada para passkeys.');
  return rp;
}

/** ¿La tabla no existe? (pase sin el SQL). Prisma P2021 o SQL Server 208. */
function isMissingTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === 'P2021') return true;
  const message = e?.message ?? '';
  return /user_passkey/i.test(message) && /(Invalid object name|no existe|does not exist)/i.test(message);
}

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isMissingTable(error)) throw new PasskeysUnavailableError();
    throw error;
  }
}

export interface PasskeySummary {
  id: number;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listPasskeys(userId: string): Promise<PasskeySummary[]> {
  const rows = await guard(() =>
    prisma.userPasskey.findMany({
      where: { id_user: userId },
      orderBy: { created_at: 'desc' },
      select: { id_passkey: true, name: true, device_type: true, backed_up: true, created_at: true, last_used_at: true },
    })
  );
  return rows.map((r) => ({
    id: r.id_passkey,
    name: r.name,
    deviceType: r.device_type,
    backedUp: r.backed_up,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
  }));
}

export interface PasskeyUser {
  id: string;
  email: string;
  name: string | null;
}

export async function registrationOptions(user: PasskeyUser, challenge: string) {
  const rp = relyingParty();
  const existing = await guard(() =>
    prisma.userPasskey.findMany({ where: { id_user: user.id }, select: { credential_id: true, transports: true } })
  );
  if (existing.length >= MAX_PASSKEYS_PER_USER) {
    throw new PasskeyRequestError(
      `Ya tiene ${MAX_PASSKEYS_PER_USER} dispositivos registrados. Elimine uno antes de agregar otro.`,
      409
    );
  }
  return generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name || user.email,
    challenge,
    timeout: PASSKEY_TIMEOUT_MS,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: parseTransports(c.transports) as never })),
    // Llave guardada en el dispositivo (para entrar sin escribir el correo) y con
    // biométrico o PIN obligatorio.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    preferredAuthenticatorType: 'localDevice',
  });
}

export async function saveRegistration(
  user: PasskeyUser,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  meta: { name: string; clientIp: string | null }
): Promise<PasskeySummary> {
  const rp = relyingParty();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch (error) {
    throw new PasskeyRequestError(
      `El dispositivo no pudo registrarse: ${error instanceof Error ? error.message : 'respuesta inválida'}`
    );
  }
  if (!verification.verified) throw new PasskeyRequestError('El dispositivo no pudo registrarse.');
  const info = verification.registrationInfo;
  const credential = info.credential;

  const count = await guard(() => prisma.userPasskey.count({ where: { id_user: user.id } }));
  if (count >= MAX_PASSKEYS_PER_USER) {
    throw new PasskeyRequestError(`Ya tiene ${MAX_PASSKEYS_PER_USER} dispositivos registrados.`, 409);
  }
  const duplicated = await guard(() =>
    prisma.userPasskey.findUnique({ where: { credential_id: credential.id }, select: { id_passkey: true } })
  );
  if (duplicated) throw new PasskeyRequestError('Este dispositivo ya está registrado.', 409);

  const row = await guard(() =>
    prisma.userPasskey.create({
      data: {
        id_user: user.id,
        credential_id: credential.id,
        public_key: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: serializeTransports(credential.transports ?? response.response.transports),
        device_type: info.credentialDeviceType,
        backed_up: info.credentialBackedUp,
        aaguid: info.aaguid || null,
        name: meta.name,
        created_ip: meta.clientIp ? meta.clientIp.slice(0, 64) : null,
      },
    })
  );
  return {
    id: row.id_passkey,
    name: row.name,
    deviceType: row.device_type,
    backedUp: row.backed_up,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: null,
  };
}

export async function deletePasskey(userId: string, id: number): Promise<{ name: string } | null> {
  return guard(async () => {
    const row = await prisma.userPasskey.findFirst({ where: { id_passkey: id, id_user: userId }, select: { name: true } });
    if (!row) return null;
    await prisma.userPasskey.delete({ where: { id_passkey: id } });
    return { name: row.name };
  });
}

export async function loginOptions(challenge: string) {
  const rp = relyingParty();
  // Sin allowCredentials: el dispositivo ofrece las llaves que tenga para este sitio
  // (la persona no escribe su correo).
  return generateAuthenticationOptions({
    rpID: rp.rpID,
    challenge,
    timeout: PASSKEY_TIMEOUT_MS,
    userVerification: 'required',
  });
}

export type PasskeyLoginResult =
  | { ok: true; user: { id: string; email: string; name: string | null; image: string | null } }
  | { ok: false; reason: LoginFailureReason; identifier: string | null; userId?: string | null; userName?: string | null };

/** Verifica la firma del dispositivo y devuelve la persona. Nunca lanza por datos malos. */
export async function verifyLogin(
  response: AuthenticationResponseJSON,
  expectedChallenge: string
): Promise<PasskeyLoginResult> {
  const rp = relyingParty();
  if (!isCredentialId(response?.id)) return { ok: false, reason: 'PASSKEY_INVALIDA', identifier: null };

  const passkey = await guard(() =>
    prisma.userPasskey.findUnique({
      where: { credential_id: response.id },
      include: { user: { select: { id: true, email: true, name: true, image: true, role: true, isActive: true } } },
    })
  );
  if (!passkey) return { ok: false, reason: 'PASSKEY_NO_REGISTRADA', identifier: null };

  const u = passkey.user;
  const who = { identifier: u.email, userId: u.id, userName: u.name };
  if (u.role === SUPPLIER_ROLE) return { ok: false, reason: 'PROVEEDOR_EN_LOGIN_INTERNO', ...who };
  if (!u.isActive) return { ok: false, reason: 'USUARIO_INACTIVO', ...who };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.credential_id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: Number(passkey.counter),
        transports: parseTransports(passkey.transports) as never,
      },
    });
  } catch {
    return { ok: false, reason: 'PASSKEY_INVALIDA', ...who };
  }
  if (!verification.verified) return { ok: false, reason: 'PASSKEY_INVALIDA', ...who };

  await guard(() =>
    prisma.userPasskey.update({
      where: { id_passkey: passkey.id_passkey },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        backed_up: verification.authenticationInfo.credentialBackedUp,
        last_used_at: new Date(),
      },
    })
  );
  return { ok: true, user: { id: u.id, email: u.email, name: u.name, image: u.image } };
}
