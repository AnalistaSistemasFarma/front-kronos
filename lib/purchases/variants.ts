/**
 * Variantes del listado de solicitudes, PURAS. Equivalen a las pantallas de
 * SAPSEND (PurchaseRequestTemplate.jsx:91-203), pero en una sola vista:
 *   mias          -> «Mis solicitudes»   U_SEND_UserId = usuario (en esa empresa)
 *   area          -> «Compras del area»  U_SEND_Dep = departamento del usuario
 *   por_autorizar -> estado LA
 *   cotizacion    -> estado ENC          («Solicitudes por cotizar»)
 *   todas         -> sin filtro
 * Los borradores anulados (U_SEND_State null) se ocultan salvo en «todas»,
 * como en SAPSEND (filtra «estado distinto de null»).
 */

export type PurchaseVariant = 'todas' | 'mias' | 'area' | 'por_autorizar' | 'cotizacion';

export const VARIANT_OPTIONS: { value: PurchaseVariant; label: string }[] = [
  { value: 'mias', label: 'Mis solicitudes' },
  { value: 'area', label: 'Mi area' },
  { value: 'por_autorizar', label: 'Por autorizar' },
  { value: 'cotizacion', label: 'Por cotizar' },
  { value: 'todas', label: 'Todas' },
];

/** Mapeo SAPSEND del usuario en una empresa. */
export interface SapsendIdentity {
  sapsendUserId: number | null;
  sapsendDepartmentId: number | null;
}

interface Row {
  companyId: number;
  U_SEND_State?: unknown;
  U_SEND_UserId?: unknown;
  U_SEND_Dep?: unknown;
}

const same = (a: unknown, b: number | null) => b != null && a != null && String(a).trim() === String(b);

/** ¿La fila pertenece a la variante? `identity` = mapeo del usuario en la empresa de la fila. */
export function matchesVariant(row: Row, variant: PurchaseVariant, identity?: SapsendIdentity): boolean {
  const state = row.U_SEND_State == null ? '' : String(row.U_SEND_State).trim();
  switch (variant) {
    case 'todas':
      return true;
    case 'mias':
      return state !== '' && same(row.U_SEND_UserId, identity?.sapsendUserId ?? null);
    case 'area':
      return state !== '' && same(row.U_SEND_Dep, identity?.sapsendDepartmentId ?? null);
    case 'por_autorizar':
      return state === 'LA';
    case 'cotizacion':
      return state === 'ENC';
  }
}
