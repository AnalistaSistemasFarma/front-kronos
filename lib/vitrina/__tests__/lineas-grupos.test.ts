import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agrupacionDesdeParams,
  agruparCatalogo,
  armarCatalogo,
  catalogoMultiempresaPorGrupo,
  conteoPor,
  descripcionFiltros,
  facetasCatalogo,
  filtrarCatalogo,
  filtroDeGrupo,
  filtrosDesdeParams,
  itemDeCatalogo,
  ordenDeCatalogos,
  paramsDesdeFiltros,
  SIN_DATO_AGRUPACION,
  SUBNIVEL,
  type CatalogoFila,
} from '../catalogo';
import { REGISTRO_LABEL, VITRINA_ENTIDADES, VITRINA_MULTIEMPRESA_HABILITADA } from '../constants';
import { etiquetaGrupoSap, fuenteDeEmpresa, mapaGruposSap } from '../rules';
import { planSincronizacion, type CodigoExistente } from '../sync';

// Vitrina (2026-10-23): línea comercial (por empresa), grupo terapéutico (común), servicio,
// nombre del grupo de SAP y «Registro sin vencimiento».
const HOY = '2026-10-23';
let seq = 0;
const area = (nombre: string, orden: number, activa = true) => ({ area: { nombre, orden, activa } });
const grupo = (nombre: string, orden: number, activo = true) => ({ grupo: { nombre, orden, activo } });
const linea = (nombre: string, orden: number, activa = true) => ({ nombre, orden, activa });

function fila(p: Partial<CatalogoFila> = {}): CatalogoFila {
  seq += 1;
  return {
    id_presentacion: seq,
    molecula: 'Meropenem',
    concentracion: '1 g',
    forma_farmaceutica: 'Vial',
    unidades_caja: 10,
    nombre_comercial: null,
    tall_man: null,
    familia: 'Carbapenémicos',
    estado: 'VALIDADA',
    visibilidad: 'CLIENTE',
    es_para_terceros: false,
    destacada: false,
    codigos: [
      {
        item_code: `PTMP${seq}`,
        pais: 'Colombia',
        canal: 'SIN_DATO',
        visibilidad_canal: 'INTERNA',
        activado_vitrina: true,
        activo_en_sap: true,
        registro_estado: 'VIGENTE',
        registro_sanitario: 'INVIMA X',
        registro_vence_en: new Date('2029-01-01T00:00:00Z'),
      },
    ],
    areas: [],
    linea: null,
    grupos: [],
    imagenes: [],
    exclusividades: [],
    ...p,
  };
}

const ANTIB = linea('Antibióticos inyectables', 10);
const CRIT = linea('Cuidado crítico', 5);
const filas = [
  fila({ molecula: 'Meropenem', linea: ANTIB, grupos: [grupo('Antibióticos', 10)], areas: [area('UCI', 10), area('Urgencias', 20)] }),
  fila({ molecula: 'Cefepime', linea: ANTIB, grupos: [grupo('Antibióticos', 10)], areas: [area('Hospitalización', 30)] }),
  fila({ molecula: 'Adrenalina', linea: CRIT, grupos: [grupo('Cardiovasculares', 40)], areas: [area('UCI', 10)] }),
  fila({ molecula: 'Midazolam', linea: CRIT, grupos: [grupo('Sedación y anestesia', 30), grupo('Retirado', 1, false)], areas: [area('UCI', 10), area('Neonatal', 50, false)] }),
  fila({ molecula: 'Vitamina C', linea: linea('Vieja', 1, false), grupos: [], areas: [] }),
];
const items = armarCatalogo(filas, 'interna', HOY);
const orden = ordenDeCatalogos(filas);

describe('Vitrina · línea comercial y grupos terapéuticos en el catálogo', () => {
  it('cada presentación trae su línea y sus grupos ACTIVOS en orden (lo inactivo no se muestra)', () => {
    const mida = items.find((p) => p.molecula === 'Midazolam')!;
    expect(mida.linea).toBe('Cuidado crítico');
    expect(mida.grupos).toEqual(['Sedación y anestesia']);
    expect(mida.areas).toEqual(['UCI']);
    expect(items.find((p) => p.molecula === 'Vitamina C')!.linea).toBeNull();
    const multi = itemDeCatalogo(fila({ grupos: [grupo('Vitaminas', 70), grupo('Antibióticos', 10)] }), 'presentacion', HOY)!;
    expect(multi.grupos).toEqual(['Antibióticos', 'Vitaminas']);
  });

  it('las filas viejas sin línea ni grupos (antes de la migración) no fallan', () => {
    const vieja = fila();
    delete vieja.linea;
    delete vieja.grupos;
    expect(itemDeCatalogo(vieja, 'interna', HOY)).toMatchObject({ linea: null, grupos: [] });
  });

  it('orden de los administradores: solo nombres activos, por «orden» y luego por nombre', () => {
    expect(orden).toEqual({
      lineas: ['Cuidado crítico', 'Antibióticos inyectables'],
      grupos: ['Antibióticos', 'Sedación y anestesia', 'Cardiovasculares'],
      areas: ['UCI', 'Urgencias', 'Hospitalización'],
    });
  });

  it('filtros combinables por línea → grupo → servicio (con Y)', () => {
    expect(filtrarCatalogo(items, { linea: 'Antibióticos inyectables' }).map((p) => p.molecula)).toEqual(['Cefepime', 'Meropenem']);
    expect(filtrarCatalogo(items, { grupo: 'Antibióticos', area: 'UCI' }).map((p) => p.molecula)).toEqual(['Meropenem']);
    expect(filtrarCatalogo(items, { linea: 'Cuidado crítico', area: 'UCI' }).map((p) => p.molecula).sort()).toEqual(['Adrenalina', 'Midazolam']);
    expect(filtrarCatalogo(items, { linea: 'Cuidado crítico', grupo: 'Antibióticos' })).toEqual([]);
    // El buscador también encuentra por línea y por grupo.
    expect(filtrarCatalogo(items, { q: 'sedacion' }).map((p) => p.molecula)).toEqual(['Midazolam']);
    expect(filtrarCatalogo(items, { q: 'inyectables' })).toHaveLength(2);
  });

  it('los filtros nuevos viajan en la URL', () => {
    const f = filtrosDesdeParams(new URLSearchParams('linea=Cuidado%20cr%C3%ADtico&grupo=Antibi%C3%B3ticos&area=UCI&agrupar=grupo'));
    expect(f).toEqual({ linea: 'Cuidado crítico', grupo: 'Antibióticos', area: 'UCI' });
    expect(paramsDesdeFiltros(f)).toEqual({ area: 'UCI', linea: 'Cuidado crítico', grupo: 'Antibióticos' });
  });

  it('facetas de línea, grupo y servicio en el orden de los administradores', () => {
    const f = facetasCatalogo(items, orden);
    expect(f.lineas).toEqual(['Cuidado crítico', 'Antibióticos inyectables']);
    expect(f.grupos).toEqual(['Antibióticos', 'Sedación y anestesia', 'Cardiovasculares']);
    expect(f.areas).toEqual(['UCI', 'Urgencias', 'Hospitalización']);
    // Sin orden, alfabético (compatibilidad).
    expect(facetasCatalogo(items).lineas).toEqual(['Antibióticos inyectables', 'Cuidado crítico']);
  });
});

describe('Vitrina · agrupación Línea → Grupo terapéutico → Servicio', () => {
  it('por línea, en su orden, con «Sin línea comercial» al final', () => {
    const g = agruparCatalogo(items, 'linea', orden);
    expect(g.map((x) => x.clave)).toEqual(['Cuidado crítico', 'Antibióticos inyectables', SIN_DATO_AGRUPACION.linea]);
    expect(g[2]).toMatchObject({ sinDato: true });
    expect(g[1].items.map((p) => p.molecula)).toEqual(['Cefepime', 'Meropenem']);
  });

  it('por servicio: una presentación en varios servicios aparece en cada uno', () => {
    const g = agruparCatalogo(items, 'area', orden);
    expect(g.map((x) => x.clave)).toEqual(['UCI', 'Urgencias', 'Hospitalización', 'Sin servicio asignado']);
    expect(g[0].items.map((p) => p.molecula)).toEqual(['Adrenalina', 'Meropenem', 'Midazolam']);
    expect(g[1].items.map((p) => p.molecula)).toEqual(['Meropenem']);
  });

  it('niveles de navegación y filtro de cada estantería', () => {
    expect(SUBNIVEL).toEqual({ familia: null, linea: 'grupo', grupo: 'area', area: null });
    const antib = agruparCatalogo(items, 'linea', orden)[1];
    expect(agruparCatalogo(antib.items, 'grupo', orden).map((x) => x.clave)).toEqual(['Antibióticos']);
    expect(filtroDeGrupo('area', 'UCI')).toEqual({ area: 'UCI' });
    expect(filtroDeGrupo('grupo', 'Antibióticos')).toEqual({ grupo: 'Antibióticos' });
    expect(filtroDeGrupo('familia', 'Carbapenémicos')).toBeNull();
  });

  it('accesos rápidos del Inicio: conteo por servicio y por grupo, sin «Sin …»', () => {
    expect(conteoPor(items, 'area', orden)).toEqual([
      { nombre: 'UCI', presentaciones: 3 },
      { nombre: 'Urgencias', presentaciones: 1 },
      { nombre: 'Hospitalización', presentaciones: 1 },
    ]);
    expect(conteoPor(items, 'grupo', orden).map((c) => c.nombre)).toEqual(['Antibióticos', 'Sedación y anestesia', 'Cardiovasculares']);
  });

  it('agrupación desde la URL (familia por defecto; valores desconocidos se ignoran)', () => {
    expect(agrupacionDesdeParams(new URLSearchParams('agrupar=linea'))).toBe('linea');
    expect(agrupacionDesdeParams(new URLSearchParams('agrupar=empresa'))).toBe('familia');
    expect(agrupacionDesdeParams(new URLSearchParams(''))).toBe('familia');
  });

  it('el modo presentación filtrado dice qué se presenta («UCI», «Antibióticos · UCI»)', () => {
    expect(descripcionFiltros({ area: 'UCI' })).toBe('UCI');
    expect(descripcionFiltros({ grupo: 'Antibióticos', area: 'UCI' })).toBe('Antibióticos · UCI');
    expect(descripcionFiltros({})).toBe('');
    // Lo filtrado en el modo presentación sigue siendo solo lo presentable al cliente.
    const pres = armarCatalogo([...filas, fila({ molecula: 'Interno', visibilidad: 'INTERNA', areas: [area('UCI', 10)] })], 'presentacion', HOY);
    expect(filtrarCatalogo(pres, { area: 'UCI' }).map((p) => p.molecula)).toEqual(['Adrenalina', 'Meropenem', 'Midazolam']);
  });
});

describe('Vitrina · vista multiempresa por grupo terapéutico (preparada, NO activa)', () => {
  it('la bandera está apagada y ninguna ruta ni pantalla usa la consulta', () => {
    expect(VITRINA_MULTIEMPRESA_HABILITADA).toBe(false);
    const raiz = join(__dirname, '..', '..', '..');
    const archivos = (dir: string): string[] =>
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
      readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? archivos(join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [join(dir, d.name)] : []));
    for (const f of [join(raiz, 'app', 'api', 'vitrina'), join(raiz, 'app', '(hub)', 'process', 'vitrina'), join(raiz, 'components', 'vitrina')].flatMap(archivos)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/listarCatalogoMultiempresa|catalogoMultiempresaPorGrupo/);
    }
  });

  it('cuando se active, junta las empresas por grupo y marca la empresa de cada presentación', () => {
    const otra = armarCatalogo([fila({ molecula: 'Ceftriaxona', grupos: [grupo('Antibióticos', 10)] })], 'presentacion', HOY);
    const r = catalogoMultiempresaPorGrupo(
      [
        { idCompany: 2, empresa: 'Ryan', items: otra },
        { idCompany: 1, empresa: 'Farmalógica', items: armarCatalogo(filas, 'presentacion', HOY) },
      ],
      'Antibióticos'
    );
    expect(r.map((p) => `${p.empresa}:${p.molecula}`)).toEqual(['Farmalógica:Cefepime', 'Farmalógica:Meropenem', 'Ryan:Ceftriaxona']);
  });
});

describe('Vitrina · nombre del grupo de SAP en Gestión', () => {
  it('ItemGroups → mapa número/nombre; etiqueta con el nombre o, si falta, el número', () => {
    const m = mapaGruposSap([{ Number: 130, GroupName: 'PT carbapenemas' }, { Number: 137, GroupName: ' PT Monobactamicos ' }, { Number: 140, GroupName: '' }, { GroupName: 'sin número' }]);
    expect([...m.entries()]).toEqual([
      [130, 'PT carbapenemas'],
      [137, 'PT Monobactamicos'],
    ]);
    expect(etiquetaGrupoSap(137, 'PT Monobactamicos')).toBe('PT Monobactamicos');
    expect(etiquetaGrupoSap(137, null)).toBe('Grupo 137');
    expect(etiquetaGrupoSap(137, '  ')).toBe('Grupo 137');
    expect(etiquetaGrupoSap(null, null)).toBeNull();
  });

  const FARMA = fuenteDeEmpresa(1)!;
  const vendible = (ItemCode: string, ItemsGroupCode: number) => ({ ItemCode, ItemName: `N ${ItemCode}`, ItemsGroupCode, SalesItem: 'tYES', Valid: 'tYES', Frozen: 'tNO' });
  const existente = (item_code: string, extra: Partial<CodigoExistente> = {}): CodigoExistente => ({
    id_codigo_sap: 7,
    item_code,
    item_name: `N ${item_code}`,
    items_group_code: 130,
    activo_en_sap: true,
    activado_vitrina: false,
    registro_estado: 'SIN_REGISTRO',
    registro_sanitario: null,
    registro_vence_en: null,
    leido: true,
    ...extra,
  });

  it('la lectura guarda el nombre del grupo al crear y lo actualiza si cambia', () => {
    const grupos = mapaGruposSap([{ Number: 130, GroupName: 'PT carbapenemas' }, { Number: 137, GroupName: 'PT Monobactamicos' }]);
    const plan = planSincronizacion({
      fuente: FARMA,
      existentes: [existente('PTMP0150'), existente('PTAZ0111', { id_codigo_sap: 8, items_group_code: 137, items_group_name: 'PT Monobactamicos' })],
      items: [vendible('PTMP0111', 130), vendible('PTMP0150', 130), vendible('PTAZ0111', 137), vendible('PTXX0001', 999)],
      registros: null,
      gruposSap: grupos,
      hoy: HOY,
    });
    expect(plan.crear.find((c) => c.item_code === 'PTMP0111')?.items_group_name).toBe('PT carbapenemas');
    expect(plan.crear.find((c) => c.item_code === 'PTXX0001')?.items_group_name).toBeNull();
    expect(plan.actualizar.find((u) => u.item_code === 'PTMP0150')?.data.items_group_name).toBe('PT carbapenemas');
    expect(plan.actualizar.find((u) => u.item_code === 'PTAZ0111')).toBeUndefined();
  });

  it('si SAP no devolvió los grupos, no se borra el nombre guardado', () => {
    const plan = planSincronizacion({
      fuente: FARMA,
      existentes: [existente('PTMP0150', { items_group_name: 'PT carbapenemas' })],
      items: [vendible('PTMP0150', 130), vendible('PTMP0111', 130)],
      registros: null,
      gruposSap: null,
      hoy: HOY,
    });
    expect(plan.actualizar).toEqual([]);
    expect(plan.crear[0].items_group_name).toBeNull();
  });
});

describe('Vitrina · registros 9999-01-01: «Registro sin vencimiento»', () => {
  it('la etiqueta cambia; el estado interno sigue siendo SIN_FECHA', () => {
    expect(REGISTRO_LABEL.SIN_FECHA).toBe('Registro sin vencimiento');
  });

  it('ninguna pantalla ni regla dice ya «Registro sin fecha», y no es una alerta sino información', () => {
    const raiz = join(__dirname, '..', '..', '..');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
    const comps = readdirSync(join(raiz, 'components', 'vitrina')).map((f) => readFileSync(join(raiz, 'components', 'vitrina', f), 'utf8'));
    for (const s of comps) expect(s).not.toMatch(/registro sin fecha/i);
    const service = readFileSync(join(raiz, 'lib', 'vitrina', 'service.ts'), 'utf8');
    expect(service).toMatch(/tipo: 'REGISTRO_SIN_FECHA', nivel: 'info', titulo: `\$\{c\.item_code\}: registro sin vencimiento`/);
    expect(service).not.toMatch(/Pida a Regulatorios diligenciar el vencimiento real/);
  });

  it('el historial conoce las entidades nuevas', () => {
    expect(VITRINA_ENTIDADES).toEqual(expect.arrayContaining(['linea_comercial', 'grupo_terapeutico']));
  });
});
