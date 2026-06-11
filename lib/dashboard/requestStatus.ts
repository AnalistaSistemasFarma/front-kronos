/** Estados del dashboard de solicitudes (alineados a status_case: Abierto, En Proceso, etc.). */
export type RequestDashboardStatus =
  | 'Cerrada'
  | 'Pendiente'
  | 'Abierto'
  | 'En proceso'
  | 'Sin estado';

const CLOSED_RE = /cerrad|resuelt|completad|completado|finalizad|closed|cancelad/i;
const ABIERTO_RE = /abiert/i;
const EN_PROCESO_RE = /en\s*proceso|en\s*progreso|asignad|\bopen\b|en\s*curso/i;
const PENDING_RE = /pendient|sin\s*empezar|\bnuevo\b|not\s*started|por\s*hacer/i;

const EXACT_ALIASES: Record<string, RequestDashboardStatus> = {
  abierto: 'Abierto',
  abierta: 'Abierto',
  'en proceso': 'En proceso',
  'en progreso': 'En proceso',
  asignado: 'En proceso',
  asignada: 'En proceso',
  open: 'En proceso',
  'en curso': 'En proceso',
  pendiente: 'Pendiente',
  'sin empezar': 'Pendiente',
  nuevo: 'Pendiente',
  cancelado: 'Cerrada',
  cancelada: 'Cerrada',
  cerrado: 'Cerrada',
  cerrada: 'Cerrada',
  resuelto: 'Cerrada',
  resuelta: 'Cerrada',
  completado: 'Cerrada',
  completada: 'Cerrada',
  finalizado: 'Cerrada',
  finalizada: 'Cerrada',
  closed: 'Cerrada',
};

export function normalizeRequestStatus(
  status: string | null | undefined
): RequestDashboardStatus {
  const raw = (status ?? '').trim();
  if (!raw) return 'Sin estado';

  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  const exact = EXACT_ALIASES[key];
  if (exact) return exact;

  if (CLOSED_RE.test(key)) return 'Cerrada';
  if (PENDING_RE.test(key)) return 'Pendiente';
  if (ABIERTO_RE.test(key)) return 'Abierto';
  if (EN_PROCESO_RE.test(key)) return 'En proceso';

  return 'Sin estado';
}

export function isRequestClosedStatus(status: string | null | undefined): boolean {
  return normalizeRequestStatus(status) === 'Cerrada';
}

export function countRequestsByDashboardStatus(
  requests: { estado_solicitud: string }[]
): {
  total: number;
  cerrada: number;
  pendiente: number;
  abierto: number;
  enProceso: number;
} {
  let cerrada = 0;
  let pendiente = 0;
  let abierto = 0;
  let enProceso = 0;

  for (const r of requests) {
    const bucket = normalizeRequestStatus(r.estado_solicitud);
    switch (bucket) {
      case 'Cerrada':
        cerrada += 1;
        break;
      case 'Pendiente':
        pendiente += 1;
        break;
      case 'Abierto':
        abierto += 1;
        break;
      case 'En proceso':
        enProceso += 1;
        break;
      default:
        break;
    }
  }

  return { total: requests.length, cerrada, pendiente, abierto, enProceso };
}
