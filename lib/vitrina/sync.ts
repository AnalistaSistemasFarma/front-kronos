/**
 * Sincronización con SAP (lectura nocturna y botón «Actualizar ahora»).
 *
 * planSincronizacion() es PURA: recibe lo que hay en la base y lo leído de SAP y
 * devuelve qué crear, qué actualizar y qué registrar en el historial. Así la
 * regla se prueba sin SAP ni SQL Server. aplicarSincronizacion() (en
 * lib/vitrina/syncDb.ts) la escribe en las tablas vitrina_* — nunca en SAP.
 *
 * Reglas:
 *   - solo los artículos VENDIBLES (SalesItem tYES, Valid tYES, Frozen tNO) entran a la bandeja;
 *   - un código que SAP inactiva, congela o ya no devuelve queda activo_en_sap = 0 y, si
 *     estaba activado, se RETIRA de la Vitrina (activado_vitrina = 0) con alerta en el historial;
 *   - si vuelve a ser vendible, NO se reactiva solo: queda para activación manual;
 *   - el registro sanitario se recalcula en cada lectura (si la empresa tiene UDO mapeado);
 *   - el nombre del grupo de SAP (ItemGroups.GroupName) se guarda en items_group_name; si SAP no
 *     devolvió los grupos, se deja el que había.
 */
import type { VitrinaAccion, VitrinaCanal, VitrinaRegistroEstado } from './constants';
import {
  canalSugerido,
  elegirRegistro,
  esVendible,
  estadoRegistro,
  familiaSugerida,
  registrosPorCodigo,
  type SapItemRow,
  type SapRegistroRow,
  type VitrinaFuenteSap,
} from './rules';

export interface CodigoExistente {
  id_codigo_sap: number;
  item_code: string;
  item_name: string;
  items_group_code: number | null;
  /** Nombre del grupo de SAP guardado (undefined = no se conoce; se trata como null). */
  items_group_name?: string | null;
  activo_en_sap: boolean;
  activado_vitrina: boolean;
  registro_estado: string;
  registro_sanitario: string | null;
  /** YYYY-MM-DD o null. */
  registro_vence_en: string | null;
  /** País guardado; la lectura solo lo llena si está vacío (no pisa lo que edite un administrador). */
  pais?: string | null;
  /** false = el código vino de la semilla y SAP todavía no lo ha confirmado (sin ultima_lectura). */
  leido: boolean;
}

export interface NuevoCodigo {
  item_code: string;
  item_name: string;
  items_group_code: number | null;
  items_group_name: string | null;
  canal: VitrinaCanal;
  sug_familia: string | null;
  registro_estado: VitrinaRegistroEstado;
  registro_sanitario: string | null;
  registro_vence_en: string | null;
  pais: string | null;
}

export interface CambioCodigo {
  id_codigo_sap: number;
  item_code: string;
  data: Partial<{
    item_name: string;
    items_group_code: number | null;
    items_group_name: string | null;
    activo_en_sap: boolean;
    activado_vitrina: boolean;
    registro_estado: VitrinaRegistroEstado;
    registro_sanitario: string | null;
    registro_vence_en: string | null;
    pais: string | null;
  }>;
}

export interface EventoSync {
  /** id del código existente; null para los nuevos (se resuelve al insertar, por item_code). */
  id_codigo_sap: number | null;
  item_code: string;
  accion: Extract<VitrinaAccion, 'ALERTA_SAP' | 'REGISTRO' | 'CREAR'>;
  anterior: Record<string, unknown> | null;
  nuevo: Record<string, unknown>;
}

export interface ResumenSync {
  leidosSap: number;
  vendibles: number;
  nuevos: number;
  actualizados: number;
  retirados: number;
  reactivablesEnSap: number;
  registrosLeidos: number | null;
  sinUdoRegistros: boolean;
  porEstadoRegistro: Record<string, number>;
}

export interface PlanSync {
  crear: NuevoCodigo[];
  actualizar: CambioCodigo[];
  eventos: EventoSync[];
  /** item_code de todo lo que SAP devolvió con el prefijo (para marcar ultima_lectura). */
  leidos: string[];
  resumen: ResumenSync;
}

export function planSincronizacion(input: {
  fuente: VitrinaFuenteSap;
  existentes: readonly CodigoExistente[];
  items: readonly SapItemRow[];
  registros: readonly SapRegistroRow[] | null;
  /** Número → nombre de los grupos de SAP; null/undefined = SAP no los devolvió (no se tocan los nombres). */
  gruposSap?: ReadonlyMap<number, string> | null;
  hoy: string;
}): PlanSync {
  const { fuente, existentes, items, registros, hoy } = input;
  const gruposSap = input.gruposSap ?? null;
  const nombreGrupo = (grupo: number | null): string | null | undefined => (gruposSap ? (grupo === null ? null : (gruposSap.get(grupo) ?? null)) : undefined);
  const porCodigo = registros ? registrosPorCodigo(registros) : null;
  const existentesMap = new Map(existentes.map((e) => [e.item_code, e]));
  const vistos = new Set<string>();
  const crear: NuevoCodigo[] = [];
  const actualizar: CambioCodigo[] = [];
  const eventos: EventoSync[] = [];
  const porEstado: Record<string, number> = {};
  let retirados = 0;
  let reactivables = 0;
  let vendibles = 0;

  const registroDe = (code: string) => (porCodigo ? estadoRegistro(elegirRegistro(porCodigo.get(code) ?? []), hoy) : null);

  for (const it of items) {
    const code = (it.ItemCode ?? '').trim();
    if (!code || !code.startsWith(fuente.prefijo) || vistos.has(code)) continue;
    vistos.add(code);
    const vendible = esVendible({ ...it, ItemCode: code }, fuente);
    if (vendible) vendibles++;
    const nombre = (it.ItemName ?? '').trim().slice(0, 200) || code;
    const grupo = typeof it.ItemsGroupCode === 'number' ? it.ItemsGroupCode : null;
    const reg = registroDe(code);
    const prev = existentesMap.get(code);

    if (!prev) {
      if (!vendible) continue;
      const estado = reg?.estado ?? 'SIN_REGISTRO';
      porEstado[estado] = (porEstado[estado] ?? 0) + 1;
      crear.push({
        item_code: code,
        item_name: nombre,
        items_group_code: grupo,
        items_group_name: nombreGrupo(grupo) ?? null,
        canal: canalSugerido(code, nombre),
        sug_familia: familiaSugerida(fuente, grupo),
        registro_estado: estado,
        registro_sanitario: reg?.numero?.slice(0, 60) ?? null,
        registro_vence_en: reg?.venceEn ?? null,
        pais: reg?.pais ?? null,
      });
      eventos.push({ id_codigo_sap: null, item_code: code, accion: 'CREAR', anterior: null, nuevo: { item_code: code, item_name: nombre, registro_estado: estado } });
      continue;
    }

    const data: CambioCodigo['data'] = {};
    if (prev.item_name !== nombre) data.item_name = nombre;
    if (prev.items_group_code !== grupo) data.items_group_code = grupo;
    const nombreG = nombreGrupo(grupo);
    if (nombreG !== undefined && (prev.items_group_name ?? null) !== nombreG) data.items_group_name = nombreG;
    if (prev.activo_en_sap && !vendible) {
      data.activo_en_sap = false;
      if (prev.activado_vitrina) {
        data.activado_vitrina = false;
        retirados++;
      }
      eventos.push({
        id_codigo_sap: prev.id_codigo_sap,
        item_code: code,
        accion: 'ALERTA_SAP',
        anterior: { activo_en_sap: true, activado_vitrina: prev.activado_vitrina },
        nuevo: { activo_en_sap: false, activado_vitrina: false, motivo: 'Inactivo, congelado o no vendible en SAP: se retiró de la Vitrina' },
      });
    } else if (!prev.activo_en_sap && vendible) {
      data.activo_en_sap = true;
      if (prev.leido) reactivables++;
      if (prev.leido) eventos.push({
        id_codigo_sap: prev.id_codigo_sap,
        item_code: code,
        accion: 'ALERTA_SAP',
        anterior: { activo_en_sap: false },
        nuevo: { activo_en_sap: true, motivo: 'Volvió a estar vendible en SAP; requiere activación manual' },
      });
    }
    if (reg) {
      const numero = reg.numero?.slice(0, 60) ?? null;
      if (prev.registro_estado !== reg.estado || prev.registro_sanitario !== numero || prev.registro_vence_en !== reg.venceEn) {
        data.registro_estado = reg.estado;
        data.registro_sanitario = numero;
        data.registro_vence_en = reg.venceEn;
        eventos.push({
          id_codigo_sap: prev.id_codigo_sap,
          item_code: code,
          accion: 'REGISTRO',
          anterior: { registro_estado: prev.registro_estado, registro_sanitario: prev.registro_sanitario, registro_vence_en: prev.registro_vence_en },
          nuevo: { registro_estado: reg.estado, registro_sanitario: numero, registro_vence_en: reg.venceEn },
        });
      }
    }
    if (!prev.pais && reg?.pais) data.pais = reg.pais;
    const estadoFinal = data.registro_estado ?? prev.registro_estado;
    porEstado[estadoFinal] = (porEstado[estadoFinal] ?? 0) + 1;
    if (Object.keys(data).length > 0) actualizar.push({ id_codigo_sap: prev.id_codigo_sap, item_code: code, data });
  }

  // Lo que está en la base y SAP ya no devuelve con el prefijo: se trata como inactivo.
  for (const prev of existentes) {
    if (vistos.has(prev.item_code)) continue;
    if (!prev.activo_en_sap) {
      // Semilla que SAP no tiene con el prefijo de la empresa: queda inactiva en la bandeja.
      continue;
    }
    const data: CambioCodigo['data'] = { activo_en_sap: false };
    if (prev.activado_vitrina) {
      data.activado_vitrina = false;
      retirados++;
    }
    actualizar.push({ id_codigo_sap: prev.id_codigo_sap, item_code: prev.item_code, data });
    eventos.push({
      id_codigo_sap: prev.id_codigo_sap,
      item_code: prev.item_code,
      accion: 'ALERTA_SAP',
      anterior: { activo_en_sap: true, activado_vitrina: prev.activado_vitrina },
      nuevo: { activo_en_sap: false, activado_vitrina: false, motivo: 'SAP ya no devuelve el artículo: se retiró de la Vitrina' },
    });
  }

  return {
    crear,
    actualizar,
    eventos,
    leidos: [...vistos],
    resumen: {
      leidosSap: vistos.size,
      vendibles,
      nuevos: crear.length,
      actualizados: actualizar.length,
      retirados,
      reactivablesEnSap: reactivables,
      registrosLeidos: registros ? registros.length : null,
      sinUdoRegistros: registros === null,
      porEstadoRegistro: porEstado,
    },
  };
}

/** Texto corto del resumen (historial y scheduled_job_run.detail). */
export function textoResumen(nombre: string, r: ResumenSync): string {
  const reg = r.sinUdoRegistros ? 'sin UDO de registros sanitarios configurado' : `${r.registrosLeidos} registros sanitarios leídos`;
  return `${nombre}: ${r.leidosSap} artículos leídos de SAP (${r.vendibles} vendibles), ${r.nuevos} nuevos en la bandeja, ${r.actualizados} actualizados, ${r.retirados} retirados de la Vitrina; ${reg}.`;
}
