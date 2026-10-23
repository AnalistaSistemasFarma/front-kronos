import 'server-only';
import type { Prisma } from '../../app/generated/prisma';
import { getCompanySapEndpoint, type VitrinaDb } from './access';
import { fuenteDeEmpresa, hoyColombia, VitrinaError } from './rules';
import { leerSapEmpresa } from './sap';
import { registrarHistorial } from './service';
import { planSincronizacion, textoResumen, type ResumenSync } from './sync';

/**
 * Aplica la lectura de SAP de UNA empresa en las tablas vitrina_* (nunca en SAP).
 * La usan el botón «Actualizar ahora» (id_user = quien la pidió) y la tarea
 * nocturna del programador central (id_user = NULL). Una sola a la vez por
 * empresa en este proceso.
 */
const enCurso = new Set<number>();

const aFecha = (s: string | null | undefined): Date | null | undefined => (s === undefined ? undefined : s ? new Date(`${s}T00:00:00Z`) : null);

export interface ResultadoSync {
  idCompany: number;
  empresa: string;
  resumen: ResumenSync;
  texto: string;
}

export async function sincronizarEmpresa(db: VitrinaDb, idCompany: number, idUser: string | null): Promise<ResultadoSync> {
  const fuente = fuenteDeEmpresa(idCompany);
  if (!fuente) throw new VitrinaError('Esta empresa no hace parte del piloto de la Vitrina (Farmalógica y Ryan).', 409);
  const endpoint = await getCompanySapEndpoint(db, idCompany);
  if (!endpoint) throw new VitrinaError(`${fuente.nombre} no tiene un Service Layer de SAP activo en sap_endpoints.`, 409);
  if (enCurso.has(idCompany)) throw new VitrinaError(`Ya hay una lectura de SAP en curso para ${fuente.nombre}. Espere un momento.`, 409);
  enCurso.add(idCompany);
  try {
    const lectura = await leerSapEmpresa(endpoint, fuente);
    const existentes = await db.vitrinaCodigoSap.findMany({
      where: { id_company: idCompany },
      select: {
        id_codigo_sap: true,
        item_code: true,
        item_name: true,
        items_group_code: true,
        activo_en_sap: true,
        activado_vitrina: true,
        registro_estado: true,
        registro_sanitario: true,
        registro_vence_en: true,
        pais: true,
        ultima_lectura: true,
      },
    });
    const plan = planSincronizacion({
      fuente,
      existentes: existentes.map((e) => ({ ...e, registro_vence_en: e.registro_vence_en?.toISOString().slice(0, 10) ?? null, leido: e.ultima_lectura !== null })),
      items: lectura.items,
      registros: lectura.registros,
      hoy: hoyColombia(),
    });
    const ahora = new Date();

    if (plan.crear.length) {
      for (let i = 0; i < plan.crear.length; i += 200) {
        await db.vitrinaCodigoSap.createMany({
          data: plan.crear.slice(i, i + 200).map((c) => ({
            id_company: idCompany,
            item_code: c.item_code,
            item_name: c.item_name,
            items_group_code: c.items_group_code,
            canal: c.canal,
            sug_familia: c.sug_familia,
            registro_estado: c.registro_estado,
            registro_sanitario: c.registro_sanitario,
            registro_vence_en: aFecha(c.registro_vence_en) ?? null,
            pais: c.pais,
            activo_en_sap: true,
            activado_vitrina: false,
            ultima_lectura: ahora,
          })),
        });
      }
    }

    const ops: Prisma.PrismaPromise<unknown>[] = plan.actualizar.map((u) =>
      db.vitrinaCodigoSap.update({
        where: { id_codigo_sap: u.id_codigo_sap },
        data: { ...u.data, registro_vence_en: aFecha(u.data.registro_vence_en) },
      })
    );
    for (let i = 0; i < ops.length; i += 100) await db.$transaction(ops.slice(i, i + 100));

    // Marca de lectura de todo lo que SAP devolvió (en bloques: límite de parámetros de SQL Server).
    for (let i = 0; i < plan.leidos.length; i += 500) {
      await db.vitrinaCodigoSap.updateMany({ where: { id_company: idCompany, item_code: { in: plan.leidos.slice(i, i + 500) } }, data: { ultima_lectura: ahora } });
    }

    // Historial: eventos por código (los nuevos se resuelven por item_code) y un resumen de la corrida.
    const nuevos = plan.crear.length
      ? new Map(
          (await db.vitrinaCodigoSap.findMany({ where: { id_company: idCompany, item_code: { in: plan.crear.map((c) => c.item_code) } }, select: { id_codigo_sap: true, item_code: true } })).map((r) => [r.item_code, r.id_codigo_sap])
        )
      : new Map<string, number>();
    const eventos = plan.eventos
      .map((e) => ({
        id_company: idCompany,
        entidad: 'codigo_sap',
        id_entidad: e.id_codigo_sap ?? nuevos.get(e.item_code) ?? 0,
        accion: e.accion,
        valor_anterior: e.anterior ? JSON.stringify(e.anterior) : null,
        valor_nuevo: JSON.stringify({ ...e.nuevo, item_code: e.item_code }),
        id_user: idUser,
      }))
      .filter((e) => e.id_entidad > 0);
    for (let i = 0; i < eventos.length; i += 200) await db.vitrinaHistorial.createMany({ data: eventos.slice(i, i + 200) });

    const texto = textoResumen(fuente.nombre, plan.resumen);
    await registrarHistorial(db, { idCompany, entidad: 'empresa', idEntidad: idCompany, accion: 'SINCRONIZAR', nuevo: { ...plan.resumen, texto, origen: idUser ? 'manual' : 'programador' }, idUser });
    return { idCompany, empresa: fuente.nombre, resumen: plan.resumen, texto };
  } finally {
    enCurso.delete(idCompany);
  }
}

/**
 * Handler del job `vitrina_sincronizar_sap` del programador central
 * (lib/scheduler/handlers.js). Payload opcional: { companies: [1, 2] }.
 * Si una empresa falla, las demás siguen; el job queda en error si alguna falló.
 */
export async function runVitrinaScheduledJob(db: VitrinaDb, payload: { companies?: unknown } | null): Promise<{ ref: string; detail: string }> {
  const ids = Array.isArray(payload?.companies) ? payload!.companies.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [1, 2];
  const partes: string[] = [];
  const fallos: string[] = [];
  for (const id of ids) {
    try {
      partes.push((await sincronizarEmpresa(db, id, null)).texto);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      fallos.push(`Empresa ${id}: ${msg}`);
      console.error(`[vitrina/sync] empresa ${id}:`, e);
    }
  }
  const detail = [...partes, ...fallos].join(' | ').slice(0, 1000);
  if (fallos.length) throw new Error(detail || 'La lectura de SAP de la Vitrina falló.');
  return { ref: hoyColombia(), detail };
}
