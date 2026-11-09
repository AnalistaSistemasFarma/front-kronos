/**
 * MEJORA CONTINUA de los flujos de trabajo — acceso a la base (2026-11-09).
 * Reglas puras en ./mejora-continua-rules.ts; diseño en docs/flujos-mejora-continua.md.
 *
 * SOLO LECTURA sobre las solicitudes y sus tareas (requests_general, task_request_general,
 * notes, workflow_execution_log). Lo único que se escribe es la DECISIÓN de una persona sobre
 * una sugerencia (workflow_mejora_decision). El flujo se cambia en el editor, como siempre.
 *
 * Quién lo ve: administradores de SynerLink o quien tenga el subproceso de Flujos de trabajo
 * o de Administración de flujos (los mismos que editan los flujos).
 * Dónde: empresas habilitadas (MEJORA_CONTINUA_EMPRESAS, por defecto OLP = 3 y 10).
 */
import { prisma } from '../prisma';
import { checkAdminPrivileges } from '../access-control';
import { getAssignedSubprocessIdsForUser } from '../process/subprocessAssignments';
import {
  DIAS_HISTORIA,
  calcularTendencia,
  diagnosticar,
  tendenciaEmpresa,
  resumirFlujo,
  totalizar,
  type DecisionResumen,
  type Diagnostico,
  type ResumenFlujo,
  type ErroresSap,
  type Nota,
  type Solicitud,
  type TareaDef,
  type TareaInstancia,
} from './mejora-continua-rules';

const URLS_FLUJOS = ['/process/request-general/workflows', '/process/request-general/admin-workflow'];
const CACHE_MS = 30 * 60_000;
/** Las fechas de solicitudes y tareas están guardadas en hora de Colombia (sin zona). */
const COT_MS = 5 * 60 * 60_000;

export class MejoraError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export function empresasHabilitadas(): number[] {
  const raw = process.env.MEJORA_CONTINUA_EMPRESAS ?? '3,10';
  return raw
    .split(',')
    .map((x) => Number.parseInt(x.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** ¿Puede ver la mejora continua y decidir sobre sus sugerencias? */
export async function puedeMejorarFlujos(user: { id: string; email: string }): Promise<boolean> {
  if (await checkAdminPrivileges(user.email)) return true;
  const subs = await prisma.subprocess.findMany({ where: { subprocess_url: { in: URLS_FLUJOS } }, select: { id_subprocess: true } });
  if (subs.length === 0) return false;
  const asignados = await getAssignedSubprocessIdsForUser(user.id);
  return subs.some((s) => asignados.includes(s.id_subprocess));
}

async function empresaDelFlujo(idProcessCategory: number): Promise<{ idCompany: number | null; nombre: string } | null> {
  const filas = await prisma.$queryRaw<{ id_company: number | null; process: string }[]>`
    SELECT TOP 1 ccr.id_company, pc.process
    FROM dbo.process_category pc
    LEFT JOIN dbo.company_category_request ccr ON ccr.id_category_request = pc.id_category_request
    WHERE pc.id = ${idProcessCategory}`;
  return filas[0] ? { idCompany: filas[0].id_company, nombre: filas[0].process } : null;
}

const cache = new Map<number, { en: number; valor: Diagnostico }>();

/** Diagnóstico del flujo (últimos 6 meses), con caché de 30 minutos. */
export async function diagnosticoDelFlujo(idProcessCategory: number, opciones: { refrescar?: boolean } = {}) {
  const flujo = await empresaDelFlujo(idProcessCategory);
  if (!flujo) throw new MejoraError('Flujo no encontrado.', 404);
  const habilitado = flujo.idCompany !== null && empresasHabilitadas().includes(flujo.idCompany);
  if (!habilitado) return { habilitado: false as const, flujo: flujo.nombre };

  const hit = cache.get(idProcessCategory);
  if (!opciones.refrescar && hit && Date.now() - hit.en < CACHE_MS) {
    return { habilitado: true as const, flujo: flujo.nombre, calculadoEn: new Date(hit.en).toISOString(), diagnostico: hit.valor };
  }

  const ahora = new Date(Date.now() - COT_MS); // «ahora» en la misma hora local de la base
  const desde = new Date(ahora.getTime() - DIAS_HISTORIA * 86_400_000);

  const tareas = await prisma.$queryRaw<
    { id: number; task: string; display_order: number | null; is_sequential: boolean | null; is_authorization: boolean | null; task_kind: string | null; asignados: number }[]
  >`
    SELECT t.id, t.task, t.display_order, t.is_sequential, t.is_authorization, t.task_kind,
           (SELECT COUNT(*) FROM dbo.user_task_request_general u WHERE u.id_task = t.id) AS asignados
    FROM dbo.task_process_category t
    WHERE t.id_process_category = ${idProcessCategory} AND t.active = 1`;

  const solicitudes = await prisma.$queryRaw<{ id: number; created_at: Date; date_resolution: Date | null; status_req: number | null }[]>`
    SELECT r.id, r.created_at, r.date_resolution, r.status_req
    FROM dbo.requests_general r
    WHERE r.created_at >= ${desde}
      AND (r.id_process_category = ${idProcessCategory}
           OR r.id IN (SELECT p.id_request_general FROM dbo.process_category_request_general p WHERE p.id_process_category = ${idProcessCategory}))`;

  const ids = solicitudes.map((s) => s.id);
  const idsTareas = tareas.map((t) => t.id);
  let instancias: { id_request_general: number; id_task: number; id_status: number | null; date_resolution: Date | null; id_executor_final: string | null; resolution: string | null }[] = [];
  let notas: { id_request: number; note: string }[] = [];
  let errores: { id_task: number; total: number; errores: number }[] = [];
  if (ids.length > 0 && idsTareas.length > 0) {
    // Por lotes: SQL Server admite hasta 2100 parámetros por consulta.
    for (let i = 0; i < ids.length; i += 1000) {
      const lote = ids.slice(i, i + 1000);
      instancias = instancias.concat(
        await prisma.$queryRawUnsafe(
          `SELECT t.id_request_general, t.id_task, t.id_status, t.date_resolution, t.id_executor_final, LEFT(CAST(t.resolution AS NVARCHAR(MAX)), 300) AS resolution
           FROM dbo.task_request_general t
           WHERE t.id_request_general IN (${lote.map((_, j) => `@P${j + 1}`).join(',')})`,
          ...lote
        )
      );
      notas = notas.concat(
        await prisma.$queryRawUnsafe(
          `SELECT n.id_request, LEFT(CAST(n.note AS NVARCHAR(MAX)), 1000) AS note FROM dbo.notes n WHERE n.id_request IN (${lote.map((_, j) => `@P${j + 1}`).join(',')})`,
          ...lote
        )
      );
    }
    errores = await prisma.$queryRawUnsafe(
      `SELECT w.id_task, COUNT(*) AS total, SUM(CASE WHEN w.status = 'error' THEN 1 ELSE 0 END) AS errores
       FROM dbo.workflow_execution_log w
       WHERE w.id_task IN (${idsTareas.map((_, j) => `@P${j + 1}`).join(',')}) AND w.started_at >= @P${idsTareas.length + 1}
       GROUP BY w.id_task`,
      ...idsTareas,
      new Date(Date.now() - DIAS_HISTORIA * 86_400_000)
    );
  }

  const ejecutores = [...new Set(instancias.map((i) => i.id_executor_final).filter((x): x is string => !!x))];
  const personas = ejecutores.length > 0 ? await prisma.user.findMany({ where: { id: { in: ejecutores } }, select: { id: true, name: true } }) : [];
  const idsSet = new Set(idsTareas);

  const diagnostico = diagnosticar({
    ahora,
    tareas: tareas.map<TareaDef>((t) => ({
      id: t.id,
      nombre: t.task,
      orden: t.display_order ?? 0,
      secuencial: Boolean(t.is_sequential),
      autorizacion: Boolean(t.is_authorization),
      tipo: t.task_kind,
      asignados: Number(t.asignados),
    })),
    solicitudes: solicitudes.map<Solicitud>((s) => ({ id: s.id, creada: s.created_at, resuelta: s.date_resolution, estado: s.status_req })),
    instancias: instancias
      .filter((i) => idsSet.has(i.id_task))
      .map<TareaInstancia>((i) => ({
        idSolicitud: i.id_request_general,
        idTarea: i.id_task,
        estado: i.id_status,
        resuelta: i.date_resolution,
        ejecutor: i.id_executor_final,
        resolucion: i.resolution,
      })),
    notas: notas.map<Nota>((n) => ({ idSolicitud: n.id_request, texto: n.note ?? '' })),
    erroresSap: errores.map<ErroresSap>((e) => ({ idTarea: e.id_task, total: Number(e.total), errores: Number(e.errores) })),
    nombres: new Map(personas.map((p) => [p.id, p.name?.trim() || 'una persona'])),
  });
  const en = Date.now();
  cache.set(idProcessCategory, { en, valor: diagnostico });
  return { habilitado: true as const, flujo: flujo.nombre, calculadoEn: new Date(en).toISOString(), diagnostico };
}

/* ───────────────────────────── Decisiones ───────────────────────────── */

export interface Decision {
  clave: string;
  estado: 'aplicada' | 'descartada';
  motivo: string | null;
  decididoPor: string | null;
  fecha: string;
  metricaAntes: { medianaDias: number | null; casos: number } | null;
}

export async function decisionesDelFlujo(idProcessCategory: number): Promise<Decision[]> {
  const filas = await prisma.$queryRaw<
    { clave: string; estado: string; motivo: string | null; metrica_antes: string | null; decided_by: string; decided_at: Date; name: string | null }[]
  >`
    SELECT d.clave, d.estado, d.motivo, d.metrica_antes, d.decided_by, d.decided_at, u.name
    FROM dbo.workflow_mejora_decision d
    LEFT JOIN dbo.[user] u ON u.id = d.decided_by
    WHERE d.id_process_category = ${idProcessCategory}`;
  return filas.map((f) => ({
    clave: f.clave,
    estado: f.estado as Decision['estado'],
    motivo: f.motivo,
    decididoPor: f.name,
    fecha: f.decided_at.toISOString(),
    metricaAntes: f.metrica_antes ? (JSON.parse(f.metrica_antes) as Decision['metricaAntes']) : null,
  }));
}

/** Registra (o cambia) la decisión de una persona sobre una sugerencia. */
export async function decidir(
  user: { id: string },
  idProcessCategory: number,
  entrada: Record<string, unknown>
) {
  const clave = typeof entrada.clave === 'string' ? entrada.clave.trim().slice(0, 80) : '';
  if (!/^[a-z_]+:(\d+|flujo)$/.test(clave)) throw new MejoraError('Sugerencia no válida.', 400);
  const estado = entrada.estado === 'aplicada' || entrada.estado === 'descartada' ? entrada.estado : null;
  if (!estado) throw new MejoraError('Indique si la aplicó o la descartó.', 400);
  const motivo = typeof entrada.motivo === 'string' ? entrada.motivo.trim().slice(0, 1000) || null : null;
  if (estado === 'descartada' && !motivo) throw new MejoraError('Cuente brevemente por qué la descarta: sirve para no volver a sugerir lo mismo.', 400);
  const titulo = typeof entrada.titulo === 'string' ? entrada.titulo.slice(0, 400) : null;
  const m = entrada.metricaAntes as { medianaDias?: unknown; casos?: unknown } | null | undefined;
  const metrica =
    m && typeof m === 'object'
      ? JSON.stringify({ medianaDias: typeof m.medianaDias === 'number' ? m.medianaDias : null, casos: typeof m.casos === 'number' ? m.casos : 0 })
      : null;
  await prisma.$executeRaw`
    MERGE dbo.workflow_mejora_decision WITH (HOLDLOCK) AS d
    USING (SELECT ${idProcessCategory} AS id_process_category, ${clave} AS clave) AS s
      ON d.id_process_category = s.id_process_category AND d.clave = s.clave
    WHEN MATCHED THEN UPDATE SET estado = ${estado}, motivo = ${motivo}, titulo = ${titulo}, metrica_antes = ${metrica},
                                 decided_by = ${user.id}, decided_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (id_process_category, clave, estado, motivo, titulo, metrica_antes, decided_by)
                          VALUES (${idProcessCategory}, ${clave}, ${estado}, ${motivo}, ${titulo}, ${metrica}, ${user.id});`;
  return { ok: true as const };
}

/* ───────────────────────────── Indicador del panel de flujos ───────────────────────────── */

type Indicador = {
  flujos: ResumenFlujo[];
  total: ReturnType<typeof totalizar>;
  /** Tendencia de TODA la empresa: cada flujo contra sí mismo, pesado por volumen (sin efecto mezcla). */
  tendencia: ReturnType<typeof calcularTendencia>;
};
const cacheResumen = new Map<number, { en: number; valor: Indicador }>();

/** Empresas habilitadas con su nombre (para el selector del indicador). */
export async function empresasDelIndicador(): Promise<{ idCompany: number; nombre: string }[]> {
  const ids = empresasHabilitadas();
  if (ids.length === 0) return [];
  const filas = await prisma.company.findMany({ where: { id_company: { in: ids } }, select: { id_company: true, company: true } });
  return filas.map((f) => ({ idCompany: f.id_company, nombre: f.company.trim() }));
}

/**
 * INDICADOR DE AUTOMEJORA de una empresa (2026-11-09): cada flujo activo con su semáforo,
 * sugerencias pendientes, decisiones y días ahorrados; más los totales. Usa el mismo
 * diagnóstico (con su caché) que el panel de cada flujo. Caché de 30 minutos.
 */
export async function indicadorDeEmpresa(idCompany: number, opciones: { refrescar?: boolean } = {}) {
  if (!empresasHabilitadas().includes(idCompany)) throw new MejoraError('La mejora continua no está habilitada para esta empresa.', 404);
  const hit = cacheResumen.get(idCompany);
  if (!opciones.refrescar && hit && Date.now() - hit.en < CACHE_MS) return { calculadoEn: new Date(hit.en).toISOString(), ...hit.valor };

  const flujos = await prisma.$queryRaw<{ id: number; process: string }[]>`
    SELECT pc.id, pc.process
    FROM dbo.process_category pc
    JOIN dbo.company_category_request ccr ON ccr.id_category_request = pc.id_category_request
    WHERE ccr.id_company = ${idCompany} AND pc.active = 1`;
  const ids = flujos.map((f) => f.id);
  const decisiones =
    ids.length > 0
      ? await prisma.workflowMejoraDecision.findMany({
          where: { id_process_category: { in: ids } },
          select: { id_process_category: true, clave: true, estado: true, metrica_antes: true },
        })
      : [];

  // De a 3 flujos a la vez: no cargar la base con decenas de consultas simultáneas.
  const resumenes: ResumenFlujo[] = [];
  const paraEmpresa: { tendencia: ReturnType<typeof calcularTendencia>; ciclos: [number, number][] }[] = [];
  for (let i = 0; i < flujos.length; i += 3) {
    const lote = await Promise.all(
      flujos.slice(i, i + 3).map(async (f) => {
        const r = await diagnosticoDelFlujo(f.id, opciones);
        if (!r.habilitado) return null;
        const dec: DecisionResumen[] = decisiones
          .filter((x) => x.id_process_category === f.id)
          .map((x) => ({
            clave: x.clave,
            estado: x.estado as DecisionResumen['estado'],
            medianaAntes: x.metrica_antes ? ((JSON.parse(x.metrica_antes) as { medianaDias?: number | null }).medianaDias ?? null) : null,
          }));
        paraEmpresa.push({ tendencia: r.diagnostico.tendencia, ciclos: r.diagnostico.ciclos });
        return resumirFlujo(f.id, f.process.trim(), r.diagnostico, dec);
      })
    );
    for (const x of lote) if (x) resumenes.push(x);
  }
  resumenes.sort((a, b) => b.prioridad - a.prioridad || b.solicitudes - a.solicitudes);
  const valor: Indicador = {
    flujos: resumenes,
    total: totalizar(resumenes),
    tendencia: tendenciaEmpresa(paraEmpresa, new Date(Date.now() - COT_MS)),
  };
  const en = Date.now();
  cacheResumen.set(idCompany, { en, valor });
  return { calculadoEn: new Date(en).toISOString(), ...valor };
}
