/**
 * Maquina de estados PURA de la oferta de venta (U_SEND_State del Draft oOrders).
 * Usa los mismos codigos que SAPSEND (priceAuthorization, balanceAuthorization,
 * balanceAuthorizationDA) para que una oferta creada en SynerLink se vea igual en
 * SAPSEND mientras conviven.
 *
 *   B     borrador                       -> enviar (motor de reglas: AP, AE o pedido)
 *   AP    en autorizacion de precios     -> aprobar_precios (AE o pedido), devolver_precios (NAP)
 *   NAP   devuelto a corregir precio     -> reenviar (motor de reglas)
 *   AE    autorizacion dir. comercial    -> aprobar_comercial (AEDA), negar_comercial (NADC)
 *   AEDA  autorizacion dir. administrat. -> aprobar_administrativa (A), negar_administrativa (NADA)
 *   NADC  no aprobo dir. comercial       -> retomar (B)
 *   NADA  no aprobo dir. administrativa  -> retomar (B)
 *   A     aprobado, con pedido           -> terminal
 *
 * Los destinos que dependen de reglas (enviar, reenviar, aprobar_precios) los
 * resuelve rules.ts; aqui solo se valida que la accion sea posible.
 * AC, EAC y NAC (cantidades) quedan como estados heredados de solo lectura: nadie
 * los escribe en SAPSEND y no hay registros en OLP desde 2025.
 * Anular no cambia U_SEND_State (como SAPSEND): marca la oferta como cancelada.
 *
 * Sin dependencias de servidor: la usan las rutas API, el motor y los tests.
 */

export type SalesState = 'B' | 'AP' | 'NAP' | 'AE' | 'AEDA' | 'NADC' | 'NADA' | 'A';

/** Estados que SAPSEND define pero que este modulo solo muestra. */
export type LegacySalesState = 'AC' | 'EAC' | 'NAC' | 'ER';

export type SalesAction =
  | 'enviar'
  | 'reenviar'
  | 'aprobar_precios'
  | 'devolver_precios'
  | 'aprobar_comercial'
  | 'negar_comercial'
  | 'aprobar_administrativa'
  | 'negar_administrativa'
  | 'retomar'
  | 'anular';

/** Destino fijo, o 'reglas' cuando lo decide el motor (AP, AE o pedido). */
export type SalesTarget = SalesState | 'reglas' | 'sin_cambio';

interface Transition {
  from: SalesState[];
  to: SalesTarget;
  /** El motivo es obligatorio (tambien se exige en el servidor). */
  requiresReason: boolean;
}

const TRANSITIONS: Record<SalesAction, Transition> = {
  enviar: { from: ['B'], to: 'reglas', requiresReason: false },
  reenviar: { from: ['NAP'], to: 'reglas', requiresReason: false },
  aprobar_precios: { from: ['AP'], to: 'reglas', requiresReason: false },
  devolver_precios: { from: ['AP'], to: 'NAP', requiresReason: true },
  aprobar_comercial: { from: ['AE'], to: 'AEDA', requiresReason: false },
  negar_comercial: { from: ['AE'], to: 'NADC', requiresReason: true },
  aprobar_administrativa: { from: ['AEDA'], to: 'A', requiresReason: false },
  negar_administrativa: { from: ['AEDA'], to: 'NADA', requiresReason: true },
  retomar: { from: ['NADC', 'NADA'], to: 'B', requiresReason: false },
  anular: { from: ['B', 'NAP', 'NADC', 'NADA'], to: 'sin_cambio', requiresReason: true },
};

const STATES: readonly SalesState[] = ['B', 'AP', 'NAP', 'AE', 'AEDA', 'NADC', 'NADA', 'A'];
const LEGACY: readonly LegacySalesState[] = ['AC', 'EAC', 'NAC', 'ER'];

export const STATE_LABELS: Record<SalesState | LegacySalesState, string> = {
  B: 'En borrador',
  AP: 'En autorización de precios',
  NAP: 'Devuelto a corregir precio',
  AE: 'En autorización de extracupo (dirección comercial)',
  AEDA: 'En autorización por dirección administrativa',
  NADC: 'No aprobó dirección comercial',
  NADA: 'No aprobó dirección administrativa',
  A: 'Aprobado',
  AC: 'En autorización de cantidades',
  EAC: 'En espera de cantidades',
  NAC: 'Devuelto a corregir cantidades',
  ER: 'En backorder',
};

/** Normaliza el valor crudo de U_SEND_State. Devuelve null si no es un estado operable. */
export function normalizeState(raw: unknown): SalesState | null {
  if (raw == null) return null;
  const code = String(raw).trim().toUpperCase();
  return (STATES as readonly string[]).includes(code) ? (code as SalesState) : null;
}

/** true si el estado es heredado de SAPSEND (solo lectura en SynerLink). */
export function isLegacyState(raw: unknown): boolean {
  if (raw == null) return false;
  return (LEGACY as readonly string[]).includes(String(raw).trim().toUpperCase());
}

export type TransitionCheck =
  | { ok: true; to: SalesTarget; requiresReason: boolean }
  | { ok: false; error: string };

/** Verifica que `action` sea valida desde el estado actual leido de SAP. */
export function checkTransition(current: unknown, action: SalesAction): TransitionCheck {
  const t = TRANSITIONS[action];
  if (!t) return { ok: false, error: `Accion desconocida: ${String(action)}` };
  const state = normalizeState(current);
  if (state == null || !t.from.includes(state)) {
    return {
      ok: false,
      error: `La accion '${action}' requiere estado ${t.from.join(' o ')}; el estado actual es ${
        state ?? (current == null || current === '' ? 'sin estado' : String(current))
      }.`,
    };
  }
  return { ok: true, to: t.to, requiresReason: t.requiresReason };
}

/** Acciones disponibles desde un estado (para pintar los botones). */
export function availableActions(current: unknown): SalesAction[] {
  const state = normalizeState(current);
  if (state == null) return [];
  return (Object.keys(TRANSITIONS) as SalesAction[]).filter((a) => TRANSITIONS[a].from.includes(state));
}
