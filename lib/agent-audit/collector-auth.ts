/**
 * Llave del RECOLECTOR del inventario de agentes (Auditoría → Inventario, F1).
 *
 * El recolector corre en la Mac de horus y publica por
 * POST /api/chat/auditoria/inventario. Se autentica con una llave PROPIA, en
 * un espacio de llaves aparte de los agentes (CHAT_AGENT_API_KEYS) y del MCP:
 * si se filtra, solo sirve para publicar inventario y tomar solicitudes de
 * escaneo, no para leer ni escribir conversaciones.
 *
 * Configuración (en el .env del servidor, NUNCA en el repo):
 *   AGENT_INVENTORY_COLLECTOR_KEY=<al menos 32 caracteres>
 *
 * CERRADO POR DEFECTO: sin la variable (o con una llave corta) todo responde
 * 401. Comparación en tiempo constante (safeEqualSecret).
 */
import { extractBearer, safeEqualSecret } from '../chat/agent-keys';

export const MIN_COLLECTOR_KEY_LENGTH = 32;

export function isCollectorRequest(
  request: Request,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const configurada = (env.AGENT_INVENTORY_COLLECTOR_KEY ?? '').trim();
  if (configurada.length < MIN_COLLECTOR_KEY_LENGTH) return false;
  const token = extractBearer(request.headers.get('authorization'));
  if (!token) return false;
  return safeEqualSecret(token, configurada);
}
