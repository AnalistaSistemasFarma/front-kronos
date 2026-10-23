import 'server-only';
import { sapGetAll, sapLogin, sapLogout } from '../sap/serviceLayer';
import type { VitrinaSapEndpoint } from './access';
import { filtroItemsSap, ITEMS_SELECT, type SapGrupoRow, type SapItemRow, type SapRegistroRow, type VitrinaFuenteSap } from './rules';

/**
 * Lectura del SAP de UNA empresa para la Vitrina — SOLO LECTURA.
 * Únicamente Login, GET (Items, ItemGroups y el UDO de registros sanitarios configurado en
 * sap_endpoints.health_records_entity) y Logout, con el cliente común
 * lib/sap/serviceLayer. Este módulo NO importa las funciones de escritura (POST, PATCH, DELETE)
 * (lo verifica lib/vitrina/__tests__/vitrina-sap-solo-lectura.test.ts).
 */
export interface LecturaSap {
  items: SapItemRow[];
  /** null si la empresa no tiene UDO de registros sanitarios mapeado. */
  registros: SapRegistroRow[] | null;
  /** Grupos de artículos (ItemGroups: Number, GroupName); null si SAP no los devolvió (no detiene la lectura). */
  grupos: SapGrupoRow[] | null;
}

const REGISTRO_SELECT = 'U_Referencia,U_Registro_Sanitario,U_Fecha_Vencimiento,U_Obsoleto,U_Pais';

function q(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

export async function leerSapEmpresa(endpoint: VitrinaSapEndpoint, fuente: VitrinaFuenteSap): Promise<LecturaSap> {
  const session = await sapLogin({
    baseUrl: endpoint.baseUrl,
    username: endpoint.username,
    password: endpoint.password,
    companyDB: endpoint.companyDB,
  });
  try {
    const items = await sapGetAll<SapItemRow>(session, `Items?${q({ $filter: filtroItemsSap(fuente), $select: ITEMS_SELECT })}`, { cap: 20000 });
    let registros: SapRegistroRow[] | null = null;
    if (endpoint.healthRecordsEntity) {
      const entity = endpoint.healthRecordsEntity.replace(/[^A-Za-z0-9_]/g, '');
      registros = await sapGetAll<SapRegistroRow>(session, `${entity}?${q({ $filter: "U_Obsoleto eq 'NO'", $select: REGISTRO_SELECT })}`, { cap: 50000 });
    }
    let grupos: SapGrupoRow[] | null = null;
    try {
      grupos = await sapGetAll<SapGrupoRow>(session, `ItemGroups?${q({ $select: 'Number,GroupName' })}`, { cap: 5000 });
    } catch (e) {
      // Sin nombres de grupo la Gestión muestra el número: no vale la pena tumbar la lectura.
      console.warn('[vitrina/sap] no se pudieron leer los grupos de artículos (ItemGroups):', e instanceof Error ? e.message : e);
    }
    return { items, registros, grupos };
  } finally {
    await sapLogout(session);
  }
}
