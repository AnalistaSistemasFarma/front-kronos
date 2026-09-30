import { prisma } from '../prisma';
import {
  CSV_MAX_FILAS,
  patronBusqueda,
  type FilaDecision,
  type FiltrosDecisiones,
} from './decisiones';

/**
 * Lectura de dbo.predictivo_decisiones (sin modelo Prisma: $queryRaw
 * parametrizado, igual que predictivo_snapshots). Siempre se lee la ÚLTIMA
 * fecha de corte publicada de la empresa. Si la tabla no existe todavía en la
 * base, se responde "sin datos" en vez de fallar.
 */

async function tablaExiste(): Promise<boolean> {
  const r = await prisma.$queryRaw<{ oid: number | null }[]>`
    SELECT OBJECT_ID(N'dbo.predictivo_decisiones', N'U') AS oid`;
  return Boolean(r[0]?.oid);
}

async function ultimaCorrida(companyId: number): Promise<{ fecha: Date; generado: Date; version: string } | null> {
  const r = await prisma.$queryRaw<{ fecha: Date | null; generado: Date | null; version: string | null }[]>`
    SELECT TOP 1 fecha_corte AS fecha, generado_en AS generado, version_motor AS version
    FROM dbo.predictivo_decisiones
    WHERE company_id = ${companyId}
    ORDER BY fecha_corte DESC, generado_en DESC`;
  const f = r[0];
  return f?.fecha ? { fecha: f.fecha, generado: f.generado as Date, version: f.version ?? '' } : null;
}

function isoFecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface PaginaDecisiones {
  fecha_corte: string | null;
  generado_en: string | null;
  total: number;
  page: number;
  pageSize: number;
  filas: FilaDecision[];
}

export async function listarDecisiones(f: FiltrosDecisiones): Promise<PaginaDecisiones> {
  const vacio = { fecha_corte: null, generado_en: null, total: 0, page: f.page, pageSize: f.pageSize, filas: [] };
  if (!(await tablaExiste())) return vacio;
  const corrida = await ultimaCorrida(f.companyId);
  if (!corrida) return vacio;

  const fecha = isoFecha(corrida.fecha);
  const like = f.q ? patronBusqueda(f.q) : null;
  const acc = f.soloAccionables ? 1 : 0;
  const offset = f.csv ? 0 : (f.page - 1) * f.pageSize;
  const limite = f.csv ? CSV_MAX_FILAS : f.pageSize;

  // Todos los filtros son parámetros (NULL = sin filtro).
  const totalRows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*) AS n FROM dbo.predictivo_decisiones
    WHERE company_id = ${f.companyId} AND fecha_corte = CAST(${fecha} AS DATE)
      AND (${f.decision} IS NULL OR decision = ${f.decision})
      AND (${f.opcion} IS NULL OR opcion = ${f.opcion})
      AND (${f.probMin} IS NULL OR probabilidad >= ${f.probMin})
      AND (${f.calidad} IS NULL OR calidad = ${f.calidad})
      AND (${acc} = 0 OR accionable = 1)
      AND (${like} IS NULL OR item_code LIKE ${like} ESCAPE '!' OR item_nombre LIKE ${like} ESCAPE '!')`;

  const filas = await prisma.$queryRaw<FilaDecision[]>`
    SELECT item_code, item_nombre, decision, opcion,
           CAST(probabilidad AS FLOAT) AS probabilidad, CAST(cantidad AS FLOAT) AS cantidad,
           CAST(impacto_cop AS FLOAT) AS impacto_cop, CAST(prioridad AS FLOAT) AS prioridad,
           calidad, accionable, motivo
    FROM dbo.predictivo_decisiones
    WHERE company_id = ${f.companyId} AND fecha_corte = CAST(${fecha} AS DATE)
      AND (${f.decision} IS NULL OR decision = ${f.decision})
      AND (${f.opcion} IS NULL OR opcion = ${f.opcion})
      AND (${f.probMin} IS NULL OR probabilidad >= ${f.probMin})
      AND (${f.calidad} IS NULL OR calidad = ${f.calidad})
      AND (${acc} = 0 OR accionable = 1)
      AND (${like} IS NULL OR item_code LIKE ${like} ESCAPE '!' OR item_nombre LIKE ${like} ESCAPE '!')
    ORDER BY accionable DESC, CASE WHEN prioridad IS NULL THEN 1 ELSE 0 END, prioridad DESC,
             probabilidad DESC, item_code, decision
    OFFSET ${offset} ROWS FETCH NEXT ${limite} ROWS ONLY`;

  return {
    fecha_corte: fecha,
    generado_en: corrida.generado ? corrida.generado.toISOString() : null,
    total: Number(totalRows[0]?.n ?? 0),
    page: f.page,
    pageSize: f.pageSize,
    filas: filas.map((r) => ({ ...r, accionable: Boolean(r.accionable) })),
  };
}

export interface ResumenDecisiones {
  fecha_corte: string | null;
  generado_en: string | null;
  version_motor: string | null;
  total: number;
  por_decision: {
    decision: string;
    opciones: Record<string, number>;
    accionables: number;
    impacto_accionable: number;
    calidad: Record<string, number>;
  }[];
}

export async function resumenDecisiones(companyId: number): Promise<ResumenDecisiones> {
  const vacio = { fecha_corte: null, generado_en: null, version_motor: null, total: 0, por_decision: [] };
  if (!(await tablaExiste())) return vacio;
  const corrida = await ultimaCorrida(companyId);
  if (!corrida) return vacio;
  const fecha = isoFecha(corrida.fecha);
  const rows = await prisma.$queryRaw<
    { decision: string; opcion: string; calidad: string; accionable: boolean; n: number; impacto: number | null }[]
  >`
    SELECT decision, opcion, calidad, accionable, COUNT(*) AS n,
           CAST(SUM(COALESCE(impacto_cop, 0)) AS FLOAT) AS impacto
    FROM dbo.predictivo_decisiones
    WHERE company_id = ${companyId} AND fecha_corte = CAST(${fecha} AS DATE)
    GROUP BY decision, opcion, calidad, accionable`;
  const mapa = new Map<string, ResumenDecisiones['por_decision'][number]>();
  let total = 0;
  for (const r of rows) {
    const n = Number(r.n);
    total += n;
    const d =
      mapa.get(r.decision) ??
      { decision: r.decision, opciones: {}, accionables: 0, impacto_accionable: 0, calidad: {} };
    d.opciones[r.opcion] = (d.opciones[r.opcion] ?? 0) + n;
    d.calidad[r.calidad] = (d.calidad[r.calidad] ?? 0) + n;
    if (r.accionable) {
      d.accionables += n;
      d.impacto_accionable += Number(r.impacto ?? 0);
    }
    mapa.set(r.decision, d);
  }
  return {
    fecha_corte: fecha,
    generado_en: corrida.generado ? corrida.generado.toISOString() : null,
    version_motor: corrida.version,
    total,
    por_decision: [...mapa.values()].sort((a, b) => a.decision.localeCompare(b.decision)),
  };
}
