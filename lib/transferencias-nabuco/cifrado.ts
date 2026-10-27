import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Cifrado de secretos guardados en BD (contraseña de Nabuco): AES-256-GCM.
 * Llave: variable de entorno NABUCO_CONFIG_KEY (cualquier texto largo; se deriva con
 * SHA-256 a 32 bytes; recomendado: `openssl rand -base64 48`). Sin llave no se guarda
 * ni se lee ningún secreto. Formato: v1:<iv b64>:<tag b64>:<cifrado b64>.
 */
function llave(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = (env.NABUCO_CONFIG_KEY ?? '').trim();
  if (raw.length < 16) throw new Error('Falta NABUCO_CONFIG_KEY (mínimo 16 caracteres) para cifrar las credenciales de Nabuco.');
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function cifrarSecreto(texto: string, env?: NodeJS.ProcessEnv): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', llave(env), iv);
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function descifrarSecreto(guardado: string, env?: NodeJS.ProcessEnv): string {
  const [v, iv, tag, enc] = String(guardado || '').split(':');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Secreto guardado con formato desconocido.');
  const decipher = createDecipheriv('aes-256-gcm', llave(env), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8');
}
