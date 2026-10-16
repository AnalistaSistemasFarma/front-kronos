/**
 * Decisiones por artículo (FASE 1) — utilidades PURAS: catálogo, lectura y
 * validación de filtros de la URL y armado del CSV. Sin BD ni red (se prueban
 * con Vitest en decisiones.test.ts). Las consultas viven en decisionesDb.ts.
 *
 * Las filas las calcula analytics/predictivo/decisiones_articulo.py y las
 * publica analytics/predictivo/publicar_decisiones.js en dbo.predictivo_decisiones.
 */

export const DECISIONES_EMPRESAS = [1, 3]; // F1: Farmalógica y OLP

export const CATALOGO_DECISIONES = {
  D1: { titulo: 'Reabastecer', opciones: ['urgente', 'pronto', 'no', 'no_aplica'] },
  D2: { titulo: 'Riesgo de quiebre en 30 días', opciones: ['alto', 'medio', 'bajo'] },
  D3: { titulo: 'Vence antes de venderse', opciones: ['alto', 'medio', 'bajo'] },
  D7: { titulo: 'Registro sanitario por vencer', opciones: ['bloquea', 'renovar_ya', 'vigilar', 'ok'] },
} as const;

export type CodigoDecision = keyof typeof CATALOGO_DECISIONES;
export type Calidad = 'alta' | 'media' | 'baja';
export const CALIDADES: Calidad[] = ['alta', 'media', 'baja'];

export const ETIQUETA_OPCION: Record<string, string> = {
  urgente: 'Urgente',
  pronto: 'Pronto',
  no: 'No por ahora',
  no_aplica: 'No aplica',
  alto: 'Alto',
  medio: 'Medio',
  bajo: 'Bajo',
  bloquea: 'Bloquea la venta',
  renovar_ya: 'Renovar ya',
  vigilar: 'Vigilar',
  ok: 'Vigente',
};

export interface FilaDecision {
  item_code: string;
  item_nombre: string | null;
  decision: CodigoDecision;
  opcion: string;
  probabilidad: number | null;
  cantidad: number | null;
  impacto_cop: number | null;
  prioridad: number | null;
  calidad: Calidad;
  accionable: boolean;
  motivo: string;
}

export interface FiltrosDecisiones {
  companyId: number;
  decision: CodigoDecision | null;
  opcion: string | null;
  probMin: number | null;
  calidad: Calidad | null;
  q: string | null;
  soloAccionables: boolean;
  page: number;
  pageSize: number;
  csv: boolean;
}

export const PAGE_SIZE_MAX = 200;
export const CSV_MAX_FILAS = 20000;

export function esDecision(v: string | null): v is CodigoDecision {
  return v !== null && Object.prototype.hasOwnProperty.call(CATALOGO_DECISIONES, v);
}

/** Lee y valida los filtros. Devuelve un mensaje de error si algo no es válido. */
export function parseFiltros(sp: URLSearchParams): { filtros: FiltrosDecisiones } | { error: string } {
  const companyId = Number(sp.get('companyId'));
  if (!Number.isInteger(companyId) || companyId <= 0) return { error: 'companyId inválido' };

  const d = sp.get('decision') || null;
  if (d !== null && !esDecision(d)) return { error: 'decision inválida' };
  const decision = d as CodigoDecision | null;

  const opcion = sp.get('opcion') || null;
  if (opcion !== null) {
    const validas: readonly string[] = decision
      ? CATALOGO_DECISIONES[decision].opciones
      : Object.values(CATALOGO_DECISIONES).flatMap((x) => [...x.opciones]);
    if (!validas.includes(opcion)) return { error: 'opcion inválida' };
  }

  const pm = sp.get('probMin');
  let probMin: number | null = null;
  if (pm !== null && pm !== '') {
    probMin = Number(pm);
    if (!Number.isFinite(probMin) || probMin < 0 || probMin > 1) return { error: 'probMin debe estar entre 0 y 1' };
  }

  const c = sp.get('calidad') || null;
  if (c !== null && !CALIDADES.includes(c as Calidad)) return { error: 'calidad inválida' };

  const qRaw = (sp.get('q') || '').trim().slice(0, 100);
  const page = Math.max(1, Math.floor(Number(sp.get('page')) || 1));
  const ps = Math.floor(Number(sp.get('pageSize')) || 50);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, ps));

  return {
    filtros: {
      companyId,
      decision,
      opcion,
      probMin,
      calidad: c as Calidad | null,
      q: qRaw || null,
      soloAccionables: sp.get('accionables') === '1' || sp.get('accionables') === 'true',
      page,
      pageSize,
      csv: sp.get('formato') === 'csv',
    },
  };
}

/** Patrón LIKE con los comodines de SQL Server escapados (se usa con ESCAPE '!'). */
export function patronBusqueda(q: string): string {
  return `%${q.replace(/[!%_[]/g, (m) => `!${m}`)}%`;
}

function celda(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  // evita inyección de fórmulas al abrir en Excel
  if (/^[=+\-@]/.test(s) && typeof v !== 'number') s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV con separador ';' y decimales con coma (Excel en español), con BOM para las tildes. */
export function aCsv(filas: FilaDecision[]): string {
  const cab = [
    'Código',
    'Artículo',
    'Decisión',
    'Opción',
    'Probabilidad',
    'Cantidad',
    'Impacto (COP)',
    'Prioridad',
    'Calidad del dato',
    'Accionable',
    'Motivo',
  ];
  const lineas = filas.map((f) =>
    [
      f.item_code,
      f.item_nombre,
      `${f.decision} ${CATALOGO_DECISIONES[f.decision]?.titulo ?? ''}`.trim(),
      ETIQUETA_OPCION[f.opcion] ?? f.opcion,
      f.probabilidad,
      f.cantidad,
      f.impacto_cop === null ? null : Math.round(f.impacto_cop),
      f.prioridad === null ? null : Math.round(f.prioridad),
      f.calidad,
      f.accionable ? 'Sí' : 'No',
      f.motivo,
    ]
      .map(celda)
      .join(';')
  );
  return '\uFEFF' + [cab.join(';'), ...lineas].join('\r\n') + '\r\n';
}
