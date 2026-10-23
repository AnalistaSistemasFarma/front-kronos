import { describe, expect, it } from 'vitest';
import {
  agruparPorFamilia,
  armarCatalogo,
  destacadasDe,
  facetasCatalogo,
  filtrarCatalogo,
  filtrosDesdeParams,
  hayFiltros,
  imagenesVigentes,
  indiceInicial,
  indiceVecino,
  itemDeCatalogo,
  nombreEmpresaVitrina,
  paramsDesdeFiltros,
  presentacionesPorPais,
  registrosDe,
  SIN_FAMILIA,
  tituloPresentacion,
  visibilidadEnModo,
  type CatalogoFila,
  type CatalogoFilaCodigo,
} from '../catalogo';

const HOY = '2026-10-22';

function codigo(p: Partial<CatalogoFilaCodigo> = {}): CatalogoFilaCodigo {
  return {
    item_code: 'PTMP0111',
    pais: 'Colombia',
    canal: 'SIN_DATO',
    visibilidad_canal: 'INTERNA',
    activado_vitrina: true,
    activo_en_sap: true,
    registro_estado: 'VIGENTE',
    registro_sanitario: 'INVIMA 2020M-0001',
    registro_vence_en: new Date('2029-05-01T00:00:00Z'),
    ...p,
  };
}

let seq = 0;
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
    codigos: [codigo()],
    areas: [{ area: { nombre: 'UCI', activa: true, orden: 1 } }],
    imagenes: [],
    exclusividades: [],
    ...p,
  };
}

describe('Vitrina · visibilidad por modo (reutiliza visibilidadEfectiva)', () => {
  it('vista interna: muestra INTERNA, CLIENTE y OFERTABLE de presentaciones validadas', () => {
    expect(visibilidadEnModo('interna', fila({ visibilidad: 'INTERNA' }), codigo())).toBe('INTERNA');
    expect(visibilidadEnModo('interna', fila({ visibilidad: 'CLIENTE' }), codigo())).toBe('CLIENTE');
    expect(visibilidadEnModo('interna', fila({ visibilidad: 'OFERTABLE' }), codigo())).toBe('OFERTABLE');
  });

  it('pendiente o retirada no salen; código sin activar o inactivo en SAP tampoco', () => {
    expect(visibilidadEnModo('interna', fila({ estado: 'PENDIENTE' }), codigo())).toBeNull();
    expect(visibilidadEnModo('interna', fila({ estado: 'RETIRADA' }), codigo())).toBeNull();
    expect(visibilidadEnModo('interna', fila(), codigo({ activado_vitrina: false }))).toBeNull();
    expect(visibilidadEnModo('interna', fila(), codigo({ activo_en_sap: false }))).toBeNull();
  });

  it('modo presentación: solo CLIENTE u OFERTABLE', () => {
    expect(visibilidadEnModo('presentacion', fila({ visibilidad: 'INTERNA' }), codigo())).toBeNull();
    expect(visibilidadEnModo('presentacion', fila({ visibilidad: 'CLIENTE' }), codigo())).toBe('CLIENTE');
    expect(visibilidadEnModo('presentacion', fila({ visibilidad: 'OFERTABLE' }), codigo())).toBe('OFERTABLE');
  });

  it('modo presentación: registro VIGENTE, POR_VENCER o SIN_FECHA; nunca VENCIDO ni SIN_REGISTRO', () => {
    for (const r of ['VIGENTE', 'POR_VENCER', 'SIN_FECHA']) expect(visibilidadEnModo('presentacion', fila(), codigo({ registro_estado: r }))).toBe('CLIENTE');
    for (const r of ['VENCIDO', 'SIN_REGISTRO']) {
      expect(visibilidadEnModo('presentacion', fila(), codigo({ registro_estado: r }))).toBeNull();
      // En la vista interna sí se ve (como interna), para que el comercial sepa que existe.
      expect(visibilidadEnModo('interna', fila(), codigo({ registro_estado: r }))).toBe('INTERNA');
    }
  });

  it('terceros: siempre interna y nunca en el modo presentación, aunque la base diga otra cosa', () => {
    const t = fila({ es_para_terceros: true, visibilidad: 'OFERTABLE' });
    expect(visibilidadEnModo('interna', t, codigo())).toBe('INTERNA');
    expect(visibilidadEnModo('presentacion', t, codigo())).toBeNull();
  });

  it('canal en interna limita el código en el modo presentación', () => {
    const p = fila({ visibilidad: 'OFERTABLE' });
    expect(visibilidadEnModo('presentacion', p, codigo({ canal: 'INSTITUCIONAL', visibilidad_canal: 'INTERNA' }))).toBeNull();
    expect(visibilidadEnModo('presentacion', p, codigo({ canal: 'INSTITUCIONAL', visibilidad_canal: 'CLIENTE' }))).toBe('CLIENTE');
  });

  it('datos faltantes dejan la presentación en interna', () => {
    expect(visibilidadEnModo('presentacion', fila({ familia: null }), codigo())).toBeNull();
    expect(visibilidadEnModo('interna', fila({ familia: null }), codigo())).toBe('INTERNA');
  });
});

describe('Vitrina · catálogo del comercial', () => {
  it('una presentación sin códigos visibles no aparece', () => {
    expect(itemDeCatalogo(fila({ codigos: [codigo({ activado_vitrina: false })] }), 'interna', HOY)).toBeNull();
    expect(itemDeCatalogo(fila({ codigos: [] }), 'interna', HOY)).toBeNull();
  });

  it('modo presentación oculta códigos SAP, estados del registro, exclusividades y la marca de terceros', () => {
    const p = fila({
      codigos: [codigo({ item_code: 'PTRY0082', registro_estado: 'POR_VENCER' }), codigo({ item_code: 'PTRY0083', registro_estado: 'VENCIDO' })],
      exclusividades: [{ cliente_beneficiario: 'OLP', pais: null, canal: null, alcance: 'OFERTAR', vigente_desde: null, vigente_hasta: new Date('2025-01-01T00:00:00Z') }],
    });
    const it = itemDeCatalogo(p, 'presentacion', HOY)!;
    expect(it.codigos).toHaveLength(1);
    expect(it.codigos[0].itemCode).toBeNull();
    expect(it.codigos[0].registroEstado).toBeNull();
    expect(it.codigos[0].registroSanitario).toBe('INVIMA 2020M-0001');
    expect(it.exclusividades).toEqual([]);
    expect(it.esParaTerceros).toBe(false);
    expect(JSON.stringify(it)).not.toContain('PTRY');
    expect(JSON.stringify(it)).not.toContain('OLP');
  });

  it('modo presentación nunca muestra una presentación con exclusividad activa (Vitamina C x10 de OLP)', () => {
    const conExclusividad = (desde: Date | null, hasta: Date | null) =>
      fila({ exclusividades: [{ cliente_beneficiario: 'OLP', pais: null, canal: null, alcance: 'EXHIBIR', vigente_desde: desde, vigente_hasta: hasta }] });
    expect(itemDeCatalogo(conExclusividad(null, null), 'presentacion', HOY)).toBeNull();
    expect(itemDeCatalogo(conExclusividad(new Date('2027-01-01T00:00:00Z'), null), 'presentacion', HOY)).toBeNull();
    expect(itemDeCatalogo(conExclusividad(null, new Date('2025-01-01T00:00:00Z')), 'presentacion', HOY)).not.toBeNull();
    expect(itemDeCatalogo(conExclusividad(null, null), 'interna', HOY)).not.toBeNull();
  });

  it('vista interna conserva códigos y exclusividades no vencidas', () => {
    const p = fila({
      exclusividades: [
        { cliente_beneficiario: 'OLP', pais: 'Colombia', canal: null, alcance: 'OFERTAR', vigente_desde: null, vigente_hasta: new Date('2027-12-31T00:00:00Z') },
        { cliente_beneficiario: 'Vieja', pais: null, canal: null, alcance: 'EXHIBIR', vigente_desde: null, vigente_hasta: new Date('2025-01-01T00:00:00Z') },
      ],
    });
    const it = itemDeCatalogo(p, 'interna', HOY)!;
    expect(it.codigos[0].itemCode).toBe('PTMP0111');
    expect(it.exclusividades.map((e) => e.clienteBeneficiario)).toEqual(['OLP']);
  });

  it('la visibilidad de la presentación es la mayor de sus códigos; países y canales sin repetir', () => {
    const p = fila({
      visibilidad: 'OFERTABLE',
      codigos: [
        codigo({ item_code: 'A', canal: 'INSTITUCIONAL', visibilidad_canal: 'CLIENTE', pais: 'México' }),
        codigo({ item_code: 'B', canal: 'COMERCIAL', visibilidad_canal: 'OFERTABLE', pais: 'México' }),
        codigo({ item_code: 'C', pais: null }),
      ],
    });
    const it = itemDeCatalogo(p, 'interna', HOY)!;
    expect(it.visibilidad).toBe('OFERTABLE');
    expect(it.paises).toEqual(['México']);
    expect(it.canales).toEqual(['COMERCIAL', 'INSTITUCIONAL']);
  });

  it('solo áreas activas, en su orden', () => {
    const it = itemDeCatalogo(
      fila({
        areas: [
          { area: { nombre: 'Urgencias', activa: true, orden: 2 } },
          { area: { nombre: 'UCI', activa: true, orden: 1 } },
          { area: { nombre: 'Vieja', activa: false, orden: 0 } },
        ],
      }),
      'interna',
      HOY
    )!;
    expect(it.areas).toEqual(['UCI', 'Urgencias']);
  });

  it('imágenes: la vigente más reciente por tipo; sin imagen queda null (estado «Imagen pendiente»)', () => {
    expect(
      imagenesVigentes([
        { id_imagen: 3, tipo: 'VIAL', vigente: true },
        { id_imagen: 7, tipo: 'VIAL', vigente: true },
        { id_imagen: 9, tipo: 'VIAL', vigente: false },
        { id_imagen: 4, tipo: 'ETIQUETA', vigente: true },
      ])
    ).toEqual({ VIAL: 7, ETIQUETA: 4, PLEGADIZA: null });
  });

  it('armarCatalogo ordena por familia, molécula, concentración y unidades (sin familia al final)', () => {
    const items = armarCatalogo(
      [
        fila({ molecula: 'Cefepima', familia: 'Cefalosporinas' }),
        fila({ molecula: 'Meropenem', unidades_caja: 10 }),
        fila({ molecula: 'Meropenem', unidades_caja: 1 }),
        fila({ molecula: 'Vitamina C', familia: null, visibilidad: 'INTERNA' }),
        fila({ molecula: 'Oculta', estado: 'PENDIENTE' }),
      ],
      'interna',
      HOY
    );
    expect(items.map((i) => `${i.molecula}${i.unidadesCaja}`)).toEqual(['Meropenem1', 'Meropenem10', 'Cefepima10', 'Vitamina C10']);
  });
});

describe('Vitrina · filtros combinables', () => {
  const items = armarCatalogo(
    [
      fila({ molecula: 'Meropenem', codigos: [codigo({ pais: 'Perú', canal: 'INSTITUCIONAL', visibilidad_canal: 'CLIENTE' }), codigo({ item_code: 'X', pais: 'Colombia', canal: 'COMERCIAL', visibilidad_canal: 'CLIENTE' })] }),
      fila({ molecula: 'Cefepima', familia: 'Cefalosporinas', forma_farmaceutica: 'Vial', areas: [{ area: { nombre: 'Urgencias', activa: true, orden: 2 } }], codigos: [codigo({ item_code: 'PTCP0111', pais: 'Colombia' })] }),
      fila({ molecula: 'Vitamina C', familia: 'Vitaminas', forma_farmaceutica: 'Ampolla', nombre_comercial: 'CITAFÉ', codigos: [codigo({ item_code: '301010036', pais: 'Colombia' })] }),
    ],
    'interna',
    HOY
  );

  it('sin filtros devuelve todo', () => {
    expect(filtrarCatalogo(items, {})).toHaveLength(3);
    expect(hayFiltros({})).toBe(false);
  });

  it('país y canal se evalúan sobre el mismo código', () => {
    expect(filtrarCatalogo(items, { pais: 'Perú' }).map((i) => i.molecula)).toEqual(['Meropenem']);
    expect(filtrarCatalogo(items, { pais: 'Perú', canal: 'INSTITUCIONAL' }).map((i) => i.molecula)).toEqual(['Meropenem']);
    expect(filtrarCatalogo(items, { pais: 'Perú', canal: 'COMERCIAL' })).toEqual([]);
    expect(filtrarCatalogo(items, { canal: 'COMERCIAL' }).map((i) => i.molecula)).toEqual(['Meropenem']);
  });

  it('área y forma se combinan con Y', () => {
    expect(filtrarCatalogo(items, { area: 'UCI' }).map((i) => i.molecula).sort()).toEqual(['Meropenem', 'Vitamina C']);
    expect(filtrarCatalogo(items, { area: 'UCI', forma: 'ampolla' }).map((i) => i.molecula)).toEqual(['Vitamina C']);
    expect(filtrarCatalogo(items, { area: 'Urgencias', forma: 'Ampolla' })).toEqual([]);
  });

  it('el buscador ignora tildes y mayúsculas, busca cada palabra y también por código SAP', () => {
    expect(filtrarCatalogo(items, { q: 'citafe' }).map((i) => i.molecula)).toEqual(['Vitamina C']);
    expect(filtrarCatalogo(items, { q: 'CARBAPENEMICOS 1 g' }).map((i) => i.molecula)).toEqual(['Meropenem']);
    expect(filtrarCatalogo(items, { q: 'ptcp0111' }).map((i) => i.molecula)).toEqual(['Cefepima']);
    expect(filtrarCatalogo(items, { q: 'meropenem ampolla' })).toEqual([]);
  });

  it('facetas: valores únicos y ordenados', () => {
    const f = facetasCatalogo(items);
    expect(f.paises).toEqual(['Colombia', 'Perú']);
    expect(f.canales).toEqual(['COMERCIAL', 'INSTITUCIONAL']);
    expect(f.areas).toEqual(['UCI', 'Urgencias']);
    expect(f.formas).toEqual(['Ampolla', 'Vial']);
  });

  it('filtros desde y hacia la URL (canal desconocido se ignora)', () => {
    const f = filtrosDesdeParams(new URLSearchParams('pais=Per%C3%BA&canal=OTRO&q=%20mero%20&empresa=1'));
    expect(f).toEqual({ pais: 'Perú', q: 'mero' });
    expect(paramsDesdeFiltros({ pais: 'Perú', canal: '', area: null })).toEqual({ pais: 'Perú' });
    expect(hayFiltros(f)).toBe(true);
  });
});

describe('Vitrina · agrupaciones', () => {
  const items = armarCatalogo(
    [
      fila({ molecula: 'Cefepima', familia: 'Cefalosporinas', codigos: [codigo({ pais: 'Colombia' }), codigo({ item_code: 'B', pais: 'Perú' })] }),
      fila({ molecula: 'Ceftriaxona', familia: 'Cefalosporinas', destacada: true, codigos: [codigo({ pais: 'Colombia' })] }),
      fila({ molecula: 'Meropenem', destacada: true, codigos: [codigo({ pais: 'Perú' }), codigo({ item_code: 'C', pais: 'Perú' })] }),
      fila({ molecula: 'Sin fam', familia: null, visibilidad: 'INTERNA', destacada: true, codigos: [codigo({ pais: null })] }),
      fila({ molecula: 'Otra', familia: 'Vitaminas', destacada: true }),
    ],
    'interna',
    HOY
  );

  it('estanterías por familia en orden alfabético; «Sin familia» al final', () => {
    const g = agruparPorFamilia(items);
    expect(g.map((x) => x.familia)).toEqual(['Carbapenémicos', 'Cefalosporinas', 'Vitaminas', SIN_FAMILIA]);
    expect(g[1].items.map((i) => i.molecula)).toEqual(['Cefepima', 'Ceftriaxona']);
  });

  it('Presencia LATAM: presentaciones por país (una presentación cuenta una vez por país)', () => {
    expect(presentacionesPorPais(items)).toEqual([
      { pais: 'Colombia', presentaciones: 3 },
      { pais: 'Perú', presentaciones: 2 },
    ]);
  });

  it('destacadas: como máximo 3, en el orden de la biblioteca', () => {
    expect(destacadasDe(items).map((i) => i.molecula)).toEqual(['Meropenem', 'Ceftriaxona', 'Otra']);
  });

  it('registros sin repetir (institucional y comercial comparten registro)', () => {
    const it = itemDeCatalogo(
      fila({ codigos: [codigo({ item_code: 'PTRY0065', pais: 'Colombia' }), codigo({ item_code: 'PTRY0066', pais: 'Colombia' }), codigo({ item_code: 'X', registro_sanitario: null, registro_estado: 'SIN_REGISTRO', pais: 'Perú' })] }),
      'interna',
      HOY
    )!;
    const r = registrosDe(it);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ numero: 'INVIMA 2020M-0001', venceEn: '2029-05-01', paises: ['Colombia'] });
    expect(r[1]).toMatchObject({ numero: null, estado: 'SIN_REGISTRO', paises: ['Perú'] });
  });
});

describe('Vitrina · navegación y textos', () => {
  it('anterior / siguiente sin salirse de la lista', () => {
    expect(indiceVecino(5, 0, -1)).toBe(0);
    expect(indiceVecino(5, 0, 1)).toBe(1);
    expect(indiceVecino(5, 4, 1)).toBe(4);
    expect(indiceVecino(0, 0, 1)).toBe(0);
  });

  it('arranca en la presentación pedida o en la primera', () => {
    const l = [{ id: 4 }, { id: 9 }];
    expect(indiceInicial(l, 9)).toBe(1);
    expect(indiceInicial(l, 77)).toBe(0);
    expect(indiceInicial(l, null)).toBe(0);
  });

  it('la ficha de Ryan dice «Ryan»', () => {
    expect(nombreEmpresaVitrina(2, 'LABORATORIOS RYAN')).toBe('Ryan');
    expect(nombreEmpresaVitrina(1, 'FARMALOGICA S.A.')).toBe('Farmalógica');
    expect(nombreEmpresaVitrina(9, ' OTRA S.A. ')).toBe('OTRA S.A.');
  });

  it('título de la presentación', () => {
    expect(tituloPresentacion({ molecula: 'Meropenem', concentracion: '1 g', unidadesCaja: 10 })).toBe('Meropenem 1 g x10');
    expect(tituloPresentacion({ molecula: 'Vitamina C', concentracion: null, unidadesCaja: null })).toBe('Vitamina C');
  });
});
