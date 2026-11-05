/**
 * Autenticación del EJECUTOR de automatizaciones programadas de cada Mac
 * (2026-11-04). Ver llavesEjecutor en scheduled-admin.ts:
 *   AGENT_SCHEDULED_EXECUTOR_KEYS="local:<llave>,jorge:<llave>,…"
 * Devuelve el equipo de la llave, o null. Cerrado por defecto; comparación en
 * tiempo constante contra todas las llaves (no corta en la primera).
 */
import { extractBearer, safeEqualSecret } from '../chat/agent-keys';
import { llavesEjecutor } from './scheduled-admin';

export function hostDelEjecutor(request: Request, env: NodeJS.ProcessEnv = process.env): string | null {
  const token = extractBearer(request.headers.get('authorization'));
  if (!token) return null;
  let host: string | null = null;
  for (const k of llavesEjecutor(env)) {
    if (safeEqualSecret(token, k.llave) && host === null) host = k.host;
  }
  return host;
}
