import 'server-only';
import type { Prisma } from '../../app/generated/prisma';
import type { VitrinaDb } from './access';
import {
  VITRINA_ALCANCES,
  VITRINA_CANALES,
  VITRINA_ESTADOS,
  VITRINA_LIMITS,
  type VitrinaAccion,
  type VitrinaEntidad,
  type VitrinaEstado,
} from './constants';
import {
  accionDeEstado,
  agruparPorProductoRyan,
  canalDeSemilla,
  datosFaltantes,
  enteroOpcional,
  esCanal,
  etiquetaGrupoSap,
  esVisibilidad,
  estadoExclusividad,
  fuenteDeEmpresa,
  hoyColombia,
  motivosNoCliente,
  parseCodigoRyan,
  parseSemilla,
  semillaDeEmpresa,
  textoObligatorio,
  textoOpcional,
  validarVigencia,
  visibilidadEfectiva,
  visibilidadPermitida,
  VitrinaError,
} from './rules';

/**
 * Operaciones de «Vitrina Comercial · Gestión». Toda acción queda en
 * vitrina_historial (quién, cuándo, qué, valor anterior y nuevo). Ninguna
 * escribe en SAP: los códigos SAP solo se LEEN (lib/vitrina/sap.ts).
 */
export interface VitrinaActor {
  idCompany: number;
  idUser: string;
}

type Tx = Prisma.TransactionClient | VitrinaDb;

const fecha = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
const aFecha = (s: string | null): Date | null => (s ? new Date(`${s}T00:00:00Z`) : null);

function json(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return JSON.stringify(v).slice(0, 100_000);
}

export async function registrarHistorial(
  db: Tx,
  e: { idCompany: number; entidad: VitrinaEntidad; idEntidad: number; accion: VitrinaAccion; anterior?: unknown; nuevo?: unknown; idUser: string | null }
): Promise<void> {
  await db.vitrinaHistorial.create({
    data: {
      id_company: e.idCompany,
      entidad: e.entidad,
      id_entidad: e.idEntidad,
      accion: e.accion,
      valor_anterior: json(e.anterior),
      valor_nuevo: json(e.nuevo),
      id_user: e.idUser,
    },
  });
}

/** Solo los campos que cambiaron (para el historial). */
function diff<T extends Record<string, unknown>>(antes: T, despues: Partial<T>): { anterior: Partial<T>; nuevo: Partial<T> } | null {
  const anterior: Partial<T> = {};
  const nuevo: Partial<T> = {};
  for (const k of Object.keys(despues) as (keyof T)[]) {
    const a = antes[k] instanceof Date ? fecha(antes[k] as Date) : antes[k];
    const b = despues[k] instanceof Date ? fecha(despues[k] as Date) : despues[k];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      anterior[k] = a as T[keyof T];
      nuevo[k] = b as T[keyof T];
    }
  }
  return Object.keys(nuevo).length ? { anterior, nuevo } : null;
}

// ---------------------------------------------------------------------------
// Bandeja
// ---------------------------------------------------------------------------

export interface BandejaFiltros {
  grupo?: number | null;
  pais?: string | null;
  q?: string | null;
}

export async function listarBandeja(db: VitrinaDb, idCompany: number, f: BandejaFiltros) {
  const fuente = fuenteDeEmpresa(idCompany);
  const where: Prisma.VitrinaCodigoSapWhereInput = { id_company: idCompany, id_presentacion: null };
  const filtros: Prisma.VitrinaCodigoSapWhereInput[] = [];
  if (f.grupo != null) filtros.push({ items_group_code: f.grupo });
  if (f.pais) filtros.push(f.pais === '__sin__' ? { pais: null } : { pais: f.pais });
  if (f.q?.trim()) {
    const q = f.q.trim().slice(0, 100);
    filtros.push({ OR: [{ item_code: { contains: q } }, { item_name: { contains: q } }, { sug_presentacion: { contains: q } }] });
  }
  const [codigos, facetas] = await Promise.all([
    db.vitrinaCodigoSap.findMany({ where: { ...where, AND: filtros }, orderBy: { item_code: 'asc' }, take: 2000 }),
    db.vitrinaCodigoSap.findMany({ where, select: { items_group_code: true, items_group_name: true, pais: true } }),
  ]);
  // Grupos de SAP con su nombre (ItemGroups.GroupName); si no se ha leído, «Grupo 137».
  const nombresGrupo = new Map<number, string | null>();
  for (const x of facetas) if (x.items_group_code != null && !nombresGrupo.get(x.items_group_code)) nombresGrupo.set(x.items_group_code, x.items_group_name);
  const grupos = [...nombresGrupo.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([codigo, nombre]) => ({ codigo, nombre: etiquetaGrupoSap(codigo, nombre) as string }));
  const paises = [...new Set(facetas.map((x) => x.pais).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'es'));
  const items = codigos.map((c) => ({
    id: c.id_codigo_sap,
    itemCode: c.item_code,
    itemName: c.item_name,
    grupo: c.items_group_code,
    grupoNombre: etiquetaGrupoSap(c.items_group_code, c.items_group_name),
    pais: c.pais,
    canal: c.canal,
    clienteMarca: c.cliente_marca,
    activoEnSap: c.activo_en_sap,
    leidoEnSap: c.ultima_lectura !== null,
    ultimaLectura: c.ultima_lectura?.toISOString() ?? null,
    registroEstado: c.registro_estado,
    registroSanitario: c.registro_sanitario,
    registroVenceEn: fecha(c.registro_vence_en),
    sugerencia: {
      presentacion: c.sug_presentacion,
      familia: c.sug_familia,
      tipo: c.sug_tipo,
      esParaTerceros: c.sug_es_terceros,
      unidades: c.sug_unidades,
      observacion: c.sug_observacion,
    },
    productoRyan: fuente?.codigoRyan ? (parseCodigoRyan(c.item_code)?.producto ?? null) : null,
  }));
  const gruposRyan = fuente?.codigoRyan
    ? agruparPorProductoRyan(items.map((i) => ({ item_code: i.itemCode, id: i.id }))).map((g) => ({ producto: g.producto, ids: g.codigos.map((c) => c.id), avisos: g.avisos }))
    : [];
  return { items, grupos, paises, gruposRyan, totalBandeja: facetas.length };
}

// ---------------------------------------------------------------------------
// Presentaciones
// ---------------------------------------------------------------------------

export interface PresentacionInput {
  molecula?: unknown;
  concentracion?: unknown;
  forma_farmaceutica?: unknown;
  unidades_caja?: unknown;
  nombre_comercial?: unknown;
  tall_man?: unknown;
  familia?: unknown;
  visibilidad?: unknown;
  es_para_terceros?: unknown;
  destacada?: unknown;
  estado?: unknown;
  areas?: unknown;
  /** Id de la línea comercial de la empresa, o null para quitarla. */
  linea?: unknown;
  /** Ids de los grupos terapéuticos. */
  grupos?: unknown;
  codigos?: unknown;
}

function idsDe(v: unknown, campo: string): number[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 500) throw new VitrinaError(`«${campo}» debe ser una lista.`, 400);
  const out = v.map((x) => Number(x));
  if (out.some((n) => !Number.isInteger(n) || n <= 0)) throw new VitrinaError(`«${campo}» tiene valores no válidos.`, 400);
  return [...new Set(out)];
}

function camposPresentacion(b: PresentacionInput, parcial: boolean) {
  const out: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => {
    if (!parcial || v !== undefined) out[k] = v;
  };
  if (!parcial || b.molecula !== undefined) out.molecula = textoObligatorio(b.molecula, VITRINA_LIMITS.molecula, 'Molécula');
  set('concentracion', b.concentracion === undefined ? undefined : textoOpcional(b.concentracion, VITRINA_LIMITS.concentracion, 'Concentración'));
  set('forma_farmaceutica', b.forma_farmaceutica === undefined ? undefined : textoOpcional(b.forma_farmaceutica, VITRINA_LIMITS.forma, 'Forma farmacéutica'));
  set('unidades_caja', b.unidades_caja === undefined ? undefined : enteroOpcional(b.unidades_caja, 'Unidades por caja', 1, 10_000));
  set('nombre_comercial', b.nombre_comercial === undefined ? undefined : textoOpcional(b.nombre_comercial, VITRINA_LIMITS.nombreComercial, 'Nombre comercial'));
  set('tall_man', b.tall_man === undefined ? undefined : textoOpcional(b.tall_man, VITRINA_LIMITS.tallMan, 'Nombre en Tall Man'));
  set('familia', b.familia === undefined ? undefined : textoOpcional(b.familia, VITRINA_LIMITS.familia, 'Familia'));
  if (b.destacada !== undefined) out.destacada = Boolean(b.destacada);
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

async function presentacionDeEmpresa(db: Tx, idCompany: number, id: number) {
  const p = await db.vitrinaPresentacion.findFirst({ where: { id_presentacion: id, id_company: idCompany }, include: { areas: true, grupos: true } });
  if (!p) throw new VitrinaError('La presentación no existe en esta empresa.', 404);
  return p;
}

async function validarAreas(db: Tx, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const n = await db.vitrinaArea.count({ where: { id_area: { in: ids } } });
  if (n !== ids.length) throw new VitrinaError('Alguna de las áreas asistenciales no existe.', 400);
}

async function validarGrupos(db: Tx, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const n = await db.vitrinaGrupoTerapeutico.count({ where: { id_grupo: { in: ids } } });
  if (n !== ids.length) throw new VitrinaError('Alguno de los grupos terapéuticos no existe.', 400);
}

/**
 * Línea comercial pedida (id o null). Debe ser de la MISMA empresa de la presentación; una línea
 * inactiva solo se acepta si la presentación ya la tenía. undefined = no se cambia.
 */
async function lineaPedida(db: Tx, idCompany: number, v: unknown, actual: number | null = null): Promise<number | null | undefined> {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const id = enteroOpcional(v, 'Línea comercial', 1, 2_000_000_000);
  if (!id) return null;
  const l = await db.vitrinaLineaComercial.findFirst({ where: { id_linea: id, id_company: idCompany } });
  if (!l) throw new VitrinaError('La línea comercial no existe en esta empresa.', 400);
  if (!l.activa && id !== actual) throw new VitrinaError(`La línea «${l.nombre}» está inactiva.`, 400);
  return id;
}

/** Toma códigos de la bandeja de la empresa; 409 si alguno ya está en otra presentación. */
async function codigosDeBandeja(db: Tx, idCompany: number, ids: number[]) {
  if (!ids.length) return [];
  const rows = await db.vitrinaCodigoSap.findMany({ where: { id_codigo_sap: { in: ids }, id_company: idCompany } });
  if (rows.length !== ids.length) throw new VitrinaError('Alguno de los códigos SAP no es de esta empresa.', 400);
  const ocupados = rows.filter((r) => r.id_presentacion !== null);
  if (ocupados.length) throw new VitrinaError(`Ya están en otra presentación: ${ocupados.map((r) => r.item_code).join(', ')}.`, 409);
  return rows;
}

export async function crearPresentacion(db: VitrinaDb, actor: VitrinaActor, body: PresentacionInput) {
  const datos = camposPresentacion(body, false);
  const esTerceros = Boolean(body.es_para_terceros);
  const visibilidad = visibilidadPermitida(body.visibilidad ?? 'INTERNA', esTerceros);
  const codigos = idsDe(body.codigos, 'Códigos SAP');
  const areas = idsDe(body.areas, 'Áreas asistenciales');
  const grupos = idsDe(body.grupos, 'Grupos terapéuticos');
  return db.$transaction(async (tx) => {
    const rows = await codigosDeBandeja(tx, actor.idCompany, codigos);
    await validarAreas(tx, areas);
    await validarGrupos(tx, grupos);
    const idLinea = (await lineaPedida(tx, actor.idCompany, body.linea)) ?? null;
    const p = await tx.vitrinaPresentacion.create({
      data: {
        ...(datos as { molecula: string }),
        id_company: actor.idCompany,
        id_linea: idLinea,
        visibilidad,
        es_para_terceros: esTerceros,
        estado: 'PENDIENTE',
        creado_por: actor.idUser,
      },
    });
    if (areas.length) await tx.vitrinaPresentacionArea.createMany({ data: areas.map((id_area) => ({ id_presentacion: p.id_presentacion, id_area })) });
    if (grupos.length) await tx.vitrinaPresentacionGrupo.createMany({ data: grupos.map((id_grupo) => ({ id_presentacion: p.id_presentacion, id_grupo })) });
    if (rows.length) {
      await tx.vitrinaCodigoSap.updateMany({ where: { id_codigo_sap: { in: codigos } }, data: { id_presentacion: p.id_presentacion } });
    }
    await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'presentacion', idEntidad: p.id_presentacion, accion: 'CREAR', nuevo: { ...datos, visibilidad, es_para_terceros: esTerceros, areas, id_linea: idLinea, grupos }, idUser: actor.idUser });
    for (const r of rows) {
      await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'codigo_sap', idEntidad: r.id_codigo_sap, accion: 'AGRUPAR', anterior: { id_presentacion: null }, nuevo: { id_presentacion: p.id_presentacion, item_code: r.item_code }, idUser: actor.idUser });
    }
    return { id: p.id_presentacion, codigos: rows.length };
  });
}

export async function editarPresentacion(db: VitrinaDb, actor: VitrinaActor, id: number, body: PresentacionInput) {
  return db.$transaction(async (tx) => {
    const actual = await presentacionDeEmpresa(tx, actor.idCompany, id);
    const datos = camposPresentacion(body, true);
    const esTerceros = body.es_para_terceros === undefined ? actual.es_para_terceros : Boolean(body.es_para_terceros);
    // Si se marca «para terceros» sin decir la visibilidad, queda INTERNA (regla fija).
    const visPedida = body.visibilidad !== undefined ? body.visibilidad : esTerceros ? 'INTERNA' : actual.visibilidad;
    const visibilidad = visibilidadPermitida(visPedida, esTerceros);
    let estado = actual.estado as VitrinaEstado;
    if (body.estado !== undefined) {
      if (typeof body.estado !== 'string' || !(VITRINA_ESTADOS as readonly string[]).includes(body.estado)) throw new VitrinaError('Estado no válido.', 400);
      estado = body.estado as VitrinaEstado;
    }
    const final = { ...actual, ...datos };
    if (estado === 'VALIDADA') {
      const faltan = datosFaltantes(final as { molecula: string });
      if (faltan.length) throw new VitrinaError(`No se puede validar: faltan ${faltan.join(', ')}.`, 400);
    }
    const idLinea = await lineaPedida(tx, actor.idCompany, body.linea, actual.id_linea);
    const cambios = { ...datos, visibilidad, es_para_terceros: esTerceros, estado, ...(idLinea !== undefined ? { id_linea: idLinea } : {}) };
    const d = diff(actual as unknown as Record<string, unknown>, cambios);
    let areasCambio: { antes: number[]; despues: number[] } | null = null;
    if (body.areas !== undefined) {
      const areas = idsDe(body.areas, 'Áreas asistenciales');
      await validarAreas(tx, areas);
      const antes = actual.areas.map((a) => a.id_area).sort((a, b) => a - b);
      const despues = [...areas].sort((a, b) => a - b);
      if (JSON.stringify(antes) !== JSON.stringify(despues)) {
        await tx.vitrinaPresentacionArea.deleteMany({ where: { id_presentacion: id } });
        if (despues.length) await tx.vitrinaPresentacionArea.createMany({ data: despues.map((id_area) => ({ id_presentacion: id, id_area })) });
        areasCambio = { antes, despues };
      }
    }
    let gruposCambio: { antes: number[]; despues: number[] } | null = null;
    if (body.grupos !== undefined) {
      const grupos = idsDe(body.grupos, 'Grupos terapéuticos');
      await validarGrupos(tx, grupos);
      const antes = actual.grupos.map((g) => g.id_grupo).sort((a, b) => a - b);
      const despues = [...grupos].sort((a, b) => a - b);
      if (JSON.stringify(antes) !== JSON.stringify(despues)) {
        await tx.vitrinaPresentacionGrupo.deleteMany({ where: { id_presentacion: id } });
        if (despues.length) await tx.vitrinaPresentacionGrupo.createMany({ data: despues.map((id_grupo) => ({ id_presentacion: id, id_grupo })) });
        gruposCambio = { antes, despues };
      }
    }
    if (!d && !areasCambio && !gruposCambio) return { id, cambios: 0 };
    await tx.vitrinaPresentacion.update({ where: { id_presentacion: id }, data: { ...cambios, actualizado_por: actor.idUser, actualizado_en: new Date() } });
    if (estado === 'RETIRADA' && actual.estado !== 'RETIRADA') {
      // Retirar la presentación desactiva sus códigos (nada queda visible).
      await tx.vitrinaCodigoSap.updateMany({ where: { id_presentacion: id, activado_vitrina: true }, data: { activado_vitrina: false } });
    }
    const accion: VitrinaAccion = d && 'estado' in d.nuevo ? accionDeEstado(estado) : 'EDITAR';
    await registrarHistorial(tx, {
      idCompany: actor.idCompany,
      entidad: 'presentacion',
      idEntidad: id,
      accion,
      anterior: { ...(d?.anterior ?? {}), ...(areasCambio ? { areas: areasCambio.antes } : {}), ...(gruposCambio ? { grupos: gruposCambio.antes } : {}) },
      nuevo: { ...(d?.nuevo ?? {}), ...(areasCambio ? { areas: areasCambio.despues } : {}), ...(gruposCambio ? { grupos: gruposCambio.despues } : {}) },
      idUser: actor.idUser,
    });
    return { id, cambios: Object.keys(d?.nuevo ?? {}).length + (areasCambio ? 1 : 0) + (gruposCambio ? 1 : 0) };
  });
}

export async function asignarCodigos(db: VitrinaDb, actor: VitrinaActor, idPresentacion: number, body: { codigos?: unknown }) {
  const ids = idsDe(body.codigos, 'Códigos SAP');
  if (!ids.length) throw new VitrinaError('Elija al menos un código SAP.', 400);
  return db.$transaction(async (tx) => {
    const p = await presentacionDeEmpresa(tx, actor.idCompany, idPresentacion);
    if (p.estado === 'RETIRADA') throw new VitrinaError('La presentación está retirada: no admite códigos nuevos.', 409);
    const rows = await codigosDeBandeja(tx, actor.idCompany, ids);
    await tx.vitrinaCodigoSap.updateMany({ where: { id_codigo_sap: { in: ids } }, data: { id_presentacion: idPresentacion } });
    for (const r of rows) {
      await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'codigo_sap', idEntidad: r.id_codigo_sap, accion: 'AGRUPAR', anterior: { id_presentacion: null }, nuevo: { id_presentacion: idPresentacion, item_code: r.item_code }, idUser: actor.idUser });
    }
    return { id: idPresentacion, codigos: rows.length };
  });
}

export interface CodigoPatch {
  canal?: unknown;
  visibilidad_canal?: unknown;
  pais?: unknown;
  cliente_marca?: unknown;
  activado_vitrina?: unknown;
  /** true = devolver a la bandeja (quita la presentación y lo desactiva). */
  quitar?: unknown;
}

export async function editarCodigo(db: VitrinaDb, actor: VitrinaActor, idCodigo: number, body: CodigoPatch) {
  return db.$transaction(async (tx) => {
    const c = await tx.vitrinaCodigoSap.findFirst({ where: { id_codigo_sap: idCodigo, id_company: actor.idCompany }, include: { presentacion: true } });
    if (!c) throw new VitrinaError('El código SAP no existe en esta empresa.', 404);

    if (body.quitar === true) {
      if (!c.id_presentacion) return { id: idCodigo, cambios: 0 };
      await tx.vitrinaCodigoSap.update({ where: { id_codigo_sap: idCodigo }, data: { id_presentacion: null, activado_vitrina: false } });
      await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'codigo_sap', idEntidad: idCodigo, accion: 'DESAGRUPAR', anterior: { id_presentacion: c.id_presentacion, activado_vitrina: c.activado_vitrina }, nuevo: { id_presentacion: null, activado_vitrina: false, item_code: c.item_code }, idUser: actor.idUser });
      return { id: idCodigo, cambios: 1 };
    }

    const data: { canal?: string; visibilidad_canal?: string; pais?: string | null; cliente_marca?: string | null; activado_vitrina?: boolean } = {};
    if (body.canal !== undefined) {
      if (!esCanal(body.canal)) throw new VitrinaError(`Canal no válido: use ${VITRINA_CANALES.join(', ')}.`, 400);
      data.canal = body.canal;
    }
    if (body.visibilidad_canal !== undefined) {
      if (!esVisibilidad(body.visibilidad_canal)) throw new VitrinaError('Visibilidad del canal no válida.', 400);
      data.visibilidad_canal = visibilidadPermitida(body.visibilidad_canal, Boolean(c.presentacion?.es_para_terceros));
    }
    if (body.pais !== undefined) data.pais = textoOpcional(body.pais, VITRINA_LIMITS.pais, 'País');
    if (body.cliente_marca !== undefined) data.cliente_marca = textoOpcional(body.cliente_marca, VITRINA_LIMITS.clienteMarca, 'Cliente o marca');
    if (body.activado_vitrina !== undefined) {
      const activar = Boolean(body.activado_vitrina);
      if (activar) {
        if (!c.id_presentacion || !c.presentacion) throw new VitrinaError('Primero asigne el código a una presentación.', 409);
        if (!c.activo_en_sap) throw new VitrinaError('El artículo está inactivo o congelado en SAP: no se puede activar.', 409);
        if (c.presentacion.estado === 'RETIRADA') throw new VitrinaError('La presentación está retirada.', 409);
      }
      data.activado_vitrina = activar;
    }
    const d = diff(c as unknown as Record<string, unknown>, data);
    if (!d) return { id: idCodigo, cambios: 0 };
    await tx.vitrinaCodigoSap.update({ where: { id_codigo_sap: idCodigo }, data });
    const soloActivacion = Object.keys(d.nuevo).length === 1 && 'activado_vitrina' in d.nuevo;
    const accion: VitrinaAccion = soloActivacion ? (data.activado_vitrina ? 'ACTIVAR' : 'DESACTIVAR') : 'EDITAR';
    await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'codigo_sap', idEntidad: idCodigo, accion, anterior: d.anterior, nuevo: { ...d.nuevo, item_code: c.item_code }, idUser: actor.idUser });
    return { id: idCodigo, cambios: Object.keys(d.nuevo).length };
  });
}

export async function listarPresentaciones(db: VitrinaDb, idCompany: number) {
  const hoy = hoyColombia();
  const rows = await db.vitrinaPresentacion.findMany({
    where: { id_company: idCompany },
    include: {
      codigos: { orderBy: { item_code: 'asc' } },
      areas: { include: { area: true } },
      grupos: { include: { grupo: true } },
      linea: true,
      exclusividades: true,
    },
    orderBy: [{ molecula: 'asc' }, { concentracion: 'asc' }, { id_presentacion: 'asc' }],
  });
  return rows.map((p) => {
    const codigos = p.codigos.map((c) => {
      const input = { presentacion: p, codigo: c };
      return {
        id: c.id_codigo_sap,
        itemCode: c.item_code,
        itemName: c.item_name,
        grupoSap: etiquetaGrupoSap(c.items_group_code, c.items_group_name),
        pais: c.pais,
        canal: c.canal,
        visibilidadCanal: c.visibilidad_canal,
        clienteMarca: c.cliente_marca,
        activoEnSap: c.activo_en_sap,
        activado: c.activado_vitrina,
        registroEstado: c.registro_estado,
        registroSanitario: c.registro_sanitario,
        registroVenceEn: fecha(c.registro_vence_en),
        ultimaLectura: c.ultima_lectura?.toISOString() ?? null,
        visibilidadEfectiva: visibilidadEfectiva(input),
        motivos: motivosNoCliente(input),
      };
    });
    return {
      id: p.id_presentacion,
      molecula: p.molecula,
      concentracion: p.concentracion,
      formaFarmaceutica: p.forma_farmaceutica,
      unidadesCaja: p.unidades_caja,
      nombreComercial: p.nombre_comercial,
      tallMan: p.tall_man,
      familia: p.familia,
      estado: p.estado,
      visibilidad: p.visibilidad,
      esParaTerceros: p.es_para_terceros,
      destacada: p.destacada,
      areas: p.areas.map((a) => ({ id: a.id_area, nombre: a.area.nombre })),
      linea: p.linea ? { id: p.linea.id_linea, nombre: p.linea.nombre, activa: p.linea.activa } : null,
      grupos: [...p.grupos]
        .sort((a, b) => a.grupo.orden - b.grupo.orden || a.grupo.nombre.localeCompare(b.grupo.nombre, 'es'))
        .map((g) => ({ id: g.id_grupo, nombre: g.grupo.nombre })),
      codigos,
      faltantes: datosFaltantes(p),
      activos: codigos.filter((c) => c.activado).length,
      exclusividades: p.exclusividades.map((e) => estadoExclusividad(fecha(e.vigente_desde), fecha(e.vigente_hasta), hoy)).filter((e) => e !== 'VENCIDA').length,
      actualizadoEn: (p.actualizado_en ?? p.creado_en).toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// Exclusividades
// ---------------------------------------------------------------------------

export interface ExclusividadInput {
  id_presentacion?: unknown;
  cliente_beneficiario?: unknown;
  pais?: unknown;
  canal?: unknown;
  alcance?: unknown;
  vigente_desde?: unknown;
  vigente_hasta?: unknown;
  observacion?: unknown;
}

function camposExclusividad(b: ExclusividadInput) {
  const alcance = b.alcance;
  if (typeof alcance !== 'string' || !(VITRINA_ALCANCES as readonly string[]).includes(alcance)) throw new VitrinaError('Alcance no válido: use Exhibir u Ofertar.', 400);
  const canal = b.canal === undefined || b.canal === null || b.canal === '' ? null : b.canal;
  if (canal !== null && !esCanal(canal)) throw new VitrinaError('Canal no válido.', 400);
  const v = validarVigencia(b.vigente_desde, b.vigente_hasta);
  return {
    cliente_beneficiario: textoObligatorio(b.cliente_beneficiario, VITRINA_LIMITS.cliente, 'Cliente beneficiario'),
    pais: textoOpcional(b.pais, VITRINA_LIMITS.pais, 'País'),
    canal: canal as string | null,
    alcance,
    vigente_desde: aFecha(v.desde),
    vigente_hasta: aFecha(v.hasta),
    observacion: textoOpcional(b.observacion, VITRINA_LIMITS.observacion, 'Observación'),
  };
}

export async function listarExclusividades(db: VitrinaDb, idCompany: number) {
  const hoy = hoyColombia();
  const rows = await db.vitrinaExclusividad.findMany({
    where: { presentacion: { id_company: idCompany } },
    include: { presentacion: { select: { id_presentacion: true, molecula: true, concentracion: true, unidades_caja: true, nombre_comercial: true } } },
    orderBy: [{ vigente_hasta: 'asc' }, { id_exclusividad: 'asc' }],
  });
  return rows.map((e) => ({
    id: e.id_exclusividad,
    idPresentacion: e.id_presentacion,
    presentacion: [e.presentacion.molecula, e.presentacion.concentracion, e.presentacion.unidades_caja ? `x${e.presentacion.unidades_caja}` : null, e.presentacion.nombre_comercial].filter(Boolean).join(' '),
    clienteBeneficiario: e.cliente_beneficiario,
    pais: e.pais,
    canal: e.canal,
    alcance: e.alcance,
    vigenteDesde: fecha(e.vigente_desde),
    vigenteHasta: fecha(e.vigente_hasta),
    observacion: e.observacion,
    estado: estadoExclusividad(fecha(e.vigente_desde), fecha(e.vigente_hasta), hoy),
  }));
}

export async function crearExclusividad(db: VitrinaDb, actor: VitrinaActor, body: ExclusividadInput) {
  const idPresentacion = enteroOpcional(body.id_presentacion, 'Presentación', 1, 2_000_000_000);
  if (!idPresentacion) throw new VitrinaError('Elija la presentación.', 400);
  const datos = camposExclusividad(body);
  return db.$transaction(async (tx) => {
    await presentacionDeEmpresa(tx, actor.idCompany, idPresentacion);
    const e = await tx.vitrinaExclusividad.create({ data: { ...datos, id_presentacion: idPresentacion, creado_por: actor.idUser } });
    await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'exclusividad', idEntidad: e.id_exclusividad, accion: 'CREAR', nuevo: { ...datos, id_presentacion: idPresentacion, vigente_desde: fecha(datos.vigente_desde), vigente_hasta: fecha(datos.vigente_hasta) }, idUser: actor.idUser });
    return { id: e.id_exclusividad };
  });
}

async function exclusividadDeEmpresa(db: Tx, idCompany: number, id: number) {
  const e = await db.vitrinaExclusividad.findFirst({ where: { id_exclusividad: id, presentacion: { id_company: idCompany } } });
  if (!e) throw new VitrinaError('La exclusividad no existe en esta empresa.', 404);
  return e;
}

export async function editarExclusividad(db: VitrinaDb, actor: VitrinaActor, id: number, body: ExclusividadInput) {
  const datos = camposExclusividad(body);
  return db.$transaction(async (tx) => {
    const actual = await exclusividadDeEmpresa(tx, actor.idCompany, id);
    const d = diff(actual as unknown as Record<string, unknown>, datos);
    if (!d) return { id, cambios: 0 };
    await tx.vitrinaExclusividad.update({ where: { id_exclusividad: id }, data: { ...datos, actualizado_por: actor.idUser, actualizado_en: new Date() } });
    await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'exclusividad', idEntidad: id, accion: 'EDITAR', anterior: d.anterior, nuevo: d.nuevo, idUser: actor.idUser });
    return { id, cambios: Object.keys(d.nuevo).length };
  });
}

export async function eliminarExclusividad(db: VitrinaDb, actor: VitrinaActor, id: number) {
  return db.$transaction(async (tx) => {
    const actual = await exclusividadDeEmpresa(tx, actor.idCompany, id);
    await tx.vitrinaExclusividad.delete({ where: { id_exclusividad: id } });
    await registrarHistorial(tx, {
      idCompany: actor.idCompany,
      entidad: 'exclusividad',
      idEntidad: id,
      accion: 'ELIMINAR',
      anterior: { ...actual, vigente_desde: fecha(actual.vigente_desde), vigente_hasta: fecha(actual.vigente_hasta), creado_en: actual.creado_en.toISOString(), actualizado_en: actual.actualizado_en?.toISOString() ?? null },
      idUser: actor.idUser,
    });
    return { id };
  });
}

// ---------------------------------------------------------------------------
// Áreas asistenciales (lista cerrada, común a las empresas)
// ---------------------------------------------------------------------------

export async function listarAreas(db: VitrinaDb) {
  const rows = await db.vitrinaArea.findMany({ orderBy: [{ orden: 'asc' }, { nombre: 'asc' }], include: { _count: { select: { presentaciones: true } } } });
  return rows.map((a) => ({ id: a.id_area, nombre: a.nombre, activa: a.activa, orden: a.orden, presentaciones: a._count.presentaciones }));
}

export async function crearArea(db: VitrinaDb, actor: VitrinaActor, body: { nombre?: unknown; orden?: unknown }) {
  const nombre = textoObligatorio(body.nombre, VITRINA_LIMITS.areaNombre, 'Nombre del área');
  const orden = enteroOpcional(body.orden, 'Orden', 0, 10_000) ?? 0;
  return db.$transaction(async (tx) => {
    if (await tx.vitrinaArea.findFirst({ where: { nombre } })) throw new VitrinaError(`Ya existe el área «${nombre}».`, 409);
    const a = await tx.vitrinaArea.create({ data: { nombre, orden, activa: true } });
    await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'area', idEntidad: a.id_area, accion: 'CREAR', nuevo: { nombre, orden }, idUser: actor.idUser });
    return { id: a.id_area };
  });
}

export async function editarArea(db: VitrinaDb, actor: VitrinaActor, id: number, body: { nombre?: unknown; orden?: unknown; activa?: unknown }) {
  return db.$transaction(async (tx) => {
    const a = await tx.vitrinaArea.findUnique({ where: { id_area: id } });
    if (!a) throw new VitrinaError('El área no existe.', 404);
    const data: { nombre?: string; orden?: number; activa?: boolean } = {};
    if (body.nombre !== undefined) data.nombre = textoObligatorio(body.nombre, VITRINA_LIMITS.areaNombre, 'Nombre del área');
    if (body.orden !== undefined) data.orden = enteroOpcional(body.orden, 'Orden', 0, 10_000) ?? 0;
    if (body.activa !== undefined) data.activa = Boolean(body.activa);
    if (data.nombre && data.nombre !== a.nombre && (await tx.vitrinaArea.findFirst({ where: { nombre: data.nombre } }))) throw new VitrinaError(`Ya existe el área «${data.nombre}».`, 409);
    const d = diff(a as unknown as Record<string, unknown>, data);
    if (!d) return { id, cambios: 0 };
    await tx.vitrinaArea.update({ where: { id_area: id }, data });
    const accion: VitrinaAccion = Object.keys(d.nuevo).length === 1 && 'activa' in d.nuevo ? (data.activa ? 'ACTIVAR' : 'DESACTIVAR') : 'EDITAR';
    await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'area', idEntidad: id, accion, anterior: d.anterior, nuevo: d.nuevo, idUser: actor.idUser });
    return { id, cambios: Object.keys(d.nuevo).length };
  });
}

// ---------------------------------------------------------------------------
// Líneas comerciales (POR EMPRESA) y grupos terapéuticos (COMUNES). No se borran: se desactivan.
// ---------------------------------------------------------------------------

export interface ClasificacionInput {
  nombre?: unknown;
  orden?: unknown;
  activa?: unknown;
}

function camposClasificacion(body: ClasificacionInput, max: number, etiqueta: string, parcial: boolean) {
  const out: { nombre?: string; orden?: number; activa?: boolean } = {};
  if (!parcial || body.nombre !== undefined) out.nombre = textoObligatorio(body.nombre, max, `Nombre de ${etiqueta}`);
  if (!parcial || body.orden !== undefined) out.orden = enteroOpcional(body.orden, 'Orden', 0, 10_000) ?? 0;
  if (body.activa !== undefined) out.activa = Boolean(body.activa);
  return out;
}

function accionClasificacion(nuevo: Record<string, unknown>, activa: boolean | undefined): VitrinaAccion {
  const claves = Object.keys(nuevo);
  return claves.length === 1 && (claves[0] === 'activa' || claves[0] === 'activo') ? (activa ? 'ACTIVAR' : 'DESACTIVAR') : 'EDITAR';
}

export async function listarLineas(db: VitrinaDb, idCompany: number) {
  const rows = await db.vitrinaLineaComercial.findMany({
    where: { id_company: idCompany },
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    include: { _count: { select: { presentaciones: true } } },
  });
  return rows.map((l) => ({ id: l.id_linea, nombre: l.nombre, activa: l.activa, orden: l.orden, presentaciones: l._count.presentaciones }));
}

export async function crearLinea(db: VitrinaDb, actor: VitrinaActor, body: ClasificacionInput) {
  const { nombre, orden } = camposClasificacion(body, VITRINA_LIMITS.lineaNombre, 'la línea', false) as { nombre: string; orden: number };
  return db.$transaction(async (tx) => {
    if (await tx.vitrinaLineaComercial.findFirst({ where: { id_company: actor.idCompany, nombre } })) throw new VitrinaError(`Ya existe la línea «${nombre}» en esta empresa.`, 409);
    const l = await tx.vitrinaLineaComercial.create({ data: { id_company: actor.idCompany, nombre, orden, activa: true } });
    await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'linea_comercial', idEntidad: l.id_linea, accion: 'CREAR', nuevo: { nombre, orden }, idUser: actor.idUser });
    return { id: l.id_linea };
  });
}

export async function editarLinea(db: VitrinaDb, actor: VitrinaActor, id: number, body: ClasificacionInput) {
  return db.$transaction(async (tx) => {
    const l = await tx.vitrinaLineaComercial.findFirst({ where: { id_linea: id, id_company: actor.idCompany } });
    if (!l) throw new VitrinaError('La línea comercial no existe en esta empresa.', 404);
    const data = camposClasificacion(body, VITRINA_LIMITS.lineaNombre, 'la línea', true);
    if (data.nombre && data.nombre !== l.nombre && (await tx.vitrinaLineaComercial.findFirst({ where: { id_company: actor.idCompany, nombre: data.nombre } }))) {
      throw new VitrinaError(`Ya existe la línea «${data.nombre}» en esta empresa.`, 409);
    }
    const d = diff(l as unknown as Record<string, unknown>, data);
    if (!d) return { id, cambios: 0 };
    await tx.vitrinaLineaComercial.update({ where: { id_linea: id }, data });
    await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'linea_comercial', idEntidad: id, accion: accionClasificacion(d.nuevo, data.activa), anterior: d.anterior, nuevo: { ...d.nuevo, nombre: data.nombre ?? l.nombre }, idUser: actor.idUser });
    return { id, cambios: Object.keys(d.nuevo).length };
  });
}

export async function listarGrupos(db: VitrinaDb, idCompany: number) {
  const rows = await db.vitrinaGrupoTerapeutico.findMany({ orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] });
  // El catálogo es común; el conteo es solo de las presentaciones de ESTA empresa (no se ve el de las demás).
  const conteo = await db.vitrinaPresentacionGrupo.groupBy({ by: ['id_grupo'], where: { presentacion: { id_company: idCompany } }, _count: { _all: true } });
  const porGrupo = new Map(conteo.map((c) => [c.id_grupo, c._count._all]));
  return rows.map((g) => ({ id: g.id_grupo, nombre: g.nombre, activa: g.activo, orden: g.orden, presentaciones: porGrupo.get(g.id_grupo) ?? 0 }));
}

export async function crearGrupo(db: VitrinaDb, actor: VitrinaActor, body: ClasificacionInput) {
  const { nombre, orden } = camposClasificacion(body, VITRINA_LIMITS.grupoNombre, 'el grupo terapéutico', false) as { nombre: string; orden: number };
  return db.$transaction(async (tx) => {
    if (await tx.vitrinaGrupoTerapeutico.findFirst({ where: { nombre } })) throw new VitrinaError(`Ya existe el grupo terapéutico «${nombre}».`, 409);
    const g = await tx.vitrinaGrupoTerapeutico.create({ data: { nombre, orden, activo: true } });
    await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'grupo_terapeutico', idEntidad: g.id_grupo, accion: 'CREAR', nuevo: { nombre, orden }, idUser: actor.idUser });
    return { id: g.id_grupo };
  });
}

export async function editarGrupo(db: VitrinaDb, actor: VitrinaActor, id: number, body: ClasificacionInput) {
  return db.$transaction(async (tx) => {
    const g = await tx.vitrinaGrupoTerapeutico.findUnique({ where: { id_grupo: id } });
    if (!g) throw new VitrinaError('El grupo terapéutico no existe.', 404);
    const campos = camposClasificacion(body, VITRINA_LIMITS.grupoNombre, 'el grupo terapéutico', true);
    if (campos.nombre && campos.nombre !== g.nombre && (await tx.vitrinaGrupoTerapeutico.findFirst({ where: { nombre: campos.nombre } }))) {
      throw new VitrinaError(`Ya existe el grupo terapéutico «${campos.nombre}».`, 409);
    }
    const data: { nombre?: string; orden?: number; activo?: boolean } = { nombre: campos.nombre, orden: campos.orden, activo: campos.activa };
    for (const k of Object.keys(data) as (keyof typeof data)[]) if (data[k] === undefined) delete data[k];
    const d = diff(g as unknown as Record<string, unknown>, data);
    if (!d) return { id, cambios: 0 };
    await tx.vitrinaGrupoTerapeutico.update({ where: { id_grupo: id }, data });
    await registrarHistorial(tx, { idCompany: actor.idCompany, entidad: 'grupo_terapeutico', idEntidad: id, accion: accionClasificacion(d.nuevo, data.activo), anterior: d.anterior, nuevo: { ...d.nuevo, nombre: data.nombre ?? g.nombre }, idUser: actor.idUser });
    return { id, cambios: Object.keys(d.nuevo).length };
  });
}

// ---------------------------------------------------------------------------
// Historial y alertas
// ---------------------------------------------------------------------------

export async function listarHistorial(db: VitrinaDb, idCompany: number, f: { entidad?: string | null; idEntidad?: number | null; antesDe?: string | null; take?: number }) {
  const where: Prisma.VitrinaHistorialWhereInput = { id_company: idCompany };
  if (f.entidad) where.entidad = f.entidad;
  if (f.idEntidad) where.id_entidad = f.idEntidad;
  if (f.antesDe && /^\d+$/.test(f.antesDe)) where.id_historial = { lt: BigInt(f.antesDe) };
  const take = Math.min(Math.max(f.take ?? 100, 1), 200);
  const rows = await db.vitrinaHistorial.findMany({ where, orderBy: { id_historial: 'desc' }, take });
  const ids = [...new Set(rows.map((r) => r.id_user).filter((x): x is string => !!x))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const nombres = new Map(users.map((u) => [u.id, u.name?.trim() || u.email]));
  const parse = (s: string | null) => {
    if (!s) return null;
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return s;
    }
  };
  return {
    items: rows.map((r) => ({
      id: r.id_historial.toString(),
      entidad: r.entidad,
      idEntidad: r.id_entidad,
      accion: r.accion,
      anterior: parse(r.valor_anterior),
      nuevo: parse(r.valor_nuevo),
      usuario: r.id_user ? (nombres.get(r.id_user) ?? 'Usuario') : 'Lectura de SAP',
      registradoEn: r.registrado_en.toISOString(),
    })),
    siguiente: rows.length === take ? rows[rows.length - 1].id_historial.toString() : null,
  };
}

export interface VitrinaAlerta {
  tipo: 'REGISTRO_VENCIDO' | 'SIN_REGISTRO' | 'REGISTRO_POR_VENCER' | 'REGISTRO_SIN_FECHA' | 'INACTIVO_SAP' | 'EXCLUSIVIDAD_VENCIDA' | 'EXCLUSIVIDAD_POR_VENCER';
  /** alerta = impide mostrar; aviso = requiere atención; info = solo informativo (no cuenta como alerta). */
  nivel: 'alerta' | 'aviso' | 'info';
  titulo: string;
  detalle: string;
  idPresentacion: number | null;
}

/** Alertas vivas para los administradores (se calculan; no se guardan). */
export async function listarAlertas(db: VitrinaDb, idCompany: number): Promise<{ alertas: VitrinaAlerta[]; ultimaLectura: string | null }> {
  const hoy = hoyColombia();
  const [codigos, exclusividades, ultima] = await Promise.all([
    db.vitrinaCodigoSap.findMany({
      where: { id_company: idCompany, id_presentacion: { not: null } },
      select: { item_code: true, id_presentacion: true, activo_en_sap: true, activado_vitrina: true, registro_estado: true, registro_vence_en: true, registro_sanitario: true },
    }),
    db.vitrinaExclusividad.findMany({ where: { presentacion: { id_company: idCompany } }, include: { presentacion: { select: { molecula: true, concentracion: true } } } }),
    db.vitrinaHistorial.findFirst({ where: { id_company: idCompany, entidad: 'empresa', accion: 'SINCRONIZAR' }, orderBy: { id_historial: 'desc' }, select: { registrado_en: true } }),
  ]);
  const alertas: VitrinaAlerta[] = [];
  for (const c of codigos) {
    const vence = fecha(c.registro_vence_en);
    if (!c.activo_en_sap) alertas.push({ tipo: 'INACTIVO_SAP', nivel: 'alerta', titulo: `${c.item_code}: inactivo o congelado en SAP`, detalle: 'Se retiró de la Vitrina. Revise si debe devolverse a la bandeja.', idPresentacion: c.id_presentacion });
    if (c.registro_estado === 'VENCIDO') alertas.push({ tipo: 'REGISTRO_VENCIDO', nivel: 'alerta', titulo: `${c.item_code}: registro sanitario vencido`, detalle: `${c.registro_sanitario ?? ''} venció el ${vence}. No se muestra al cliente.`, idPresentacion: c.id_presentacion });
    if (c.registro_estado === 'SIN_REGISTRO') alertas.push({ tipo: 'SIN_REGISTRO', nivel: 'alerta', titulo: `${c.item_code}: sin registro sanitario en SAP`, detalle: 'No se muestra al cliente hasta que SAP tenga un registro no obsoleto.', idPresentacion: c.id_presentacion });
    if (c.registro_estado === 'POR_VENCER') alertas.push({ tipo: 'REGISTRO_POR_VENCER', nivel: 'aviso', titulo: `${c.item_code}: registro por vencer`, detalle: `${c.registro_sanitario ?? ''} vence el ${vence}.`, idPresentacion: c.id_presentacion });
    // 9999-01-01: el registro no vence (cambio normativo, confirmado por Comercial el 23-oct). Es información, no una falta de dato.
    if (c.registro_estado === 'SIN_FECHA' && c.activado_vitrina) alertas.push({ tipo: 'REGISTRO_SIN_FECHA', nivel: 'info', titulo: `${c.item_code}: registro sin vencimiento`, detalle: `${c.registro_sanitario ?? 'El registro'} no tiene fecha de vencimiento (SAP trae 9999-01-01). Se muestra al cliente con normalidad.`, idPresentacion: c.id_presentacion });
  }
  for (const e of exclusividades) {
    const est = estadoExclusividad(fecha(e.vigente_desde), fecha(e.vigente_hasta), hoy);
    const pres = [e.presentacion.molecula, e.presentacion.concentracion].filter(Boolean).join(' ');
    if (est === 'VENCIDA') alertas.push({ tipo: 'EXCLUSIVIDAD_VENCIDA', nivel: 'alerta', titulo: `Exclusividad vencida: ${pres}`, detalle: `${e.cliente_beneficiario}, venció el ${fecha(e.vigente_hasta)}.`, idPresentacion: e.id_presentacion });
    if (est === 'POR_VENCER') alertas.push({ tipo: 'EXCLUSIVIDAD_POR_VENCER', nivel: 'aviso', titulo: `Exclusividad por vencer: ${pres}`, detalle: `${e.cliente_beneficiario}, vence el ${fecha(e.vigente_hasta)}.`, idPresentacion: e.id_presentacion });
  }
  const peso = { alerta: 0, aviso: 1, info: 2 } as const;
  alertas.sort((a, b) => peso[a.nivel] - peso[b.nivel] || a.titulo.localeCompare(b.titulo, 'es'));
  return { alertas, ultimaLectura: ultima?.registrado_en.toISOString() ?? null };
}

// ---------------------------------------------------------------------------
// Semilla CSV → sugerencias de la bandeja (NO crea presentaciones ni activa nada)
// ---------------------------------------------------------------------------

export async function importarSemilla(db: VitrinaDb, actor: VitrinaActor, texto: string) {
  if (typeof texto !== 'string' || !texto.trim()) throw new VitrinaError('Adjunte el archivo CSV de la carga inicial.', 400);
  if (Buffer.byteLength(texto, 'utf8') > VITRINA_LIMITS.semillaBytes) throw new VitrinaError('El archivo es demasiado grande.', 400);
  const { formato, filas, errores } = parseSemilla(texto);
  if (!semillaDeEmpresa(formato, actor.idCompany)) {
    throw new VitrinaError(formato === 'RYAN' ? 'Este archivo es la carga inicial de Ryan: elija la empresa Ryan.' : 'Este archivo es la carga inicial de Farmalógica: elija la empresa Farmalógica.', 400);
  }
  const existentes = await db.vitrinaCodigoSap.findMany({
    where: { id_company: actor.idCompany, item_code: { in: filas.map((f) => f.itemCode) } },
    select: { id_codigo_sap: true, item_code: true, pais: true, cliente_marca: true, canal: true },
  });
  const porCodigo = new Map(existentes.map((e) => [e.item_code, e]));
  let creados = 0;
  let actualizados = 0;
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const f of filas) {
    const sug = {
      sug_presentacion: f.presentacion,
      sug_familia: f.familia,
      sug_tipo: f.tipo,
      sug_es_terceros: f.esParaTerceros,
      sug_unidades: f.unidades,
      sug_observacion: f.observacion,
    };
    const canal = canalDeSemilla(f);
    const prev = porCodigo.get(f.itemCode);
    if (prev) {
      actualizados++;
      ops.push(
        db.vitrinaCodigoSap.update({
          where: { id_codigo_sap: prev.id_codigo_sap },
          data: {
            ...sug,
            // Solo completa lo vacío: no pisa lo que el administrador ya definió.
            ...(prev.pais ? {} : { pais: f.pais }),
            ...(prev.cliente_marca ? {} : { cliente_marca: f.clienteMarca }),
            ...(prev.canal === 'SIN_DATO' && canal !== 'SIN_DATO' ? { canal } : {}),
          },
        })
      );
    } else {
      creados++;
      // Aún no leído de SAP: queda inactivo hasta que la sincronización lo confirme.
      ops.push(
        db.vitrinaCodigoSap.create({
          data: {
            ...sug,
            id_company: actor.idCompany,
            item_code: f.itemCode,
            item_name: (f.itemName ?? f.presentacion ?? f.itemCode).slice(0, 200),
            pais: f.pais,
            cliente_marca: f.clienteMarca,
            canal,
            activo_en_sap: false,
            activado_vitrina: false,
          },
        })
      );
    }
  }
  for (let i = 0; i < ops.length; i += 100) await db.$transaction(ops.slice(i, i + 100));
  await registrarHistorial(db, {
    idCompany: actor.idCompany,
    entidad: 'empresa',
    idEntidad: actor.idCompany,
    accion: 'SEMILLA',
    nuevo: { formato, filas: filas.length, creados, actualizados, errores: errores.slice(0, 50) },
    idUser: actor.idUser,
  });
  return { formato, filas: filas.length, creados, actualizados, errores };
}
