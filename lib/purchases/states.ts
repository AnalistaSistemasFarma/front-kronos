/**
 * Maquina de estados PURA de la solicitud de compra (U_SEND_State del Draft).
 * Replica las transiciones de SAPSEND (ModalViewPurchaseRequest.jsx:112-526) para
 * que una solicitud creada en SynerLink se comporte igual al verla en SAPSEND.
 *
 *   B   borrador              -> LA (enviar), null (anular)
 *   LA  por autorizar         -> A (aprobar), NAD (no aprobar), ENC (cotizar)
 *   ENC en cotizacion         -> LA (reenviar a autorizar)
 *   NAD no aprobado           -> B (retomar)
 *   A   aprobado (con firme)  -> terminal
 *   null anulado              -> terminal
 *
 * Sin dependencias de servidor: la usan las rutas API y los tests.
 */

export type PurchaseState = 'B' | 'LA' | 'ENC' | 'NAD' | 'A' | null;

export type PurchaseAction =
  | 'enviar'
  | 'anular'
  | 'aprobar'
  | 'no_aprobar'
  | 'cotizar'
  | 'reenviar'
  | 'retomar';

interface Transition {
  from: Exclude<PurchaseState, null>;
  to: PurchaseState;
  /** El motivo es obligatorio (en SynerLink se exige tambien en el servidor). */
  requiresReason: boolean;
}

const TRANSITIONS: Record<PurchaseAction, Transition> = {
  enviar: { from: 'B', to: 'LA', requiresReason: false },
  anular: { from: 'B', to: null, requiresReason: true },
  aprobar: { from: 'LA', to: 'A', requiresReason: false },
  no_aprobar: { from: 'LA', to: 'NAD', requiresReason: true },
  cotizar: { from: 'LA', to: 'ENC', requiresReason: false },
  reenviar: { from: 'ENC', to: 'LA', requiresReason: false },
  retomar: { from: 'NAD', to: 'B', requiresReason: false },
};

export type TransitionCheck =
  | { ok: true; to: PurchaseState; requiresReason: boolean }
  | { ok: false; error: string };

/** Normaliza el valor crudo de U_SEND_State (SAP devuelve null o string). */
export function normalizeState(raw: unknown): PurchaseState {
  if (raw == null || raw === '') return null;
  const code = String(raw).trim().toUpperCase();
  return code === 'B' || code === 'LA' || code === 'ENC' || code === 'NAD' || code === 'A'
    ? code
    : null;
}

/** Verifica que `action` sea valida desde el estado actual leido de SAP. */
export function checkTransition(current: unknown, action: PurchaseAction): TransitionCheck {
  const t = TRANSITIONS[action];
  if (!t) return { ok: false, error: `Accion desconocida: ${String(action)}` };
  const state = normalizeState(current);
  if (state !== t.from) {
    return {
      ok: false,
      error: `La accion '${action}' requiere estado ${t.from}; el estado actual es ${state ?? 'sin estado'}.`,
    };
  }
  return { ok: true, to: t.to, requiresReason: t.requiresReason };
}

/** Acciones disponibles desde un estado (para pintar los botones). */
export function availableActions(current: unknown): PurchaseAction[] {
  const state = normalizeState(current);
  return (Object.keys(TRANSITIONS) as PurchaseAction[]).filter(
    (a) => TRANSITIONS[a].from === state
  );
}
