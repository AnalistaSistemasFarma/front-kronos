import { describe, expect, it, vi } from 'vitest';
import { VITRINA_MODELO3D_MAX_BYTES } from '../constants';
import { itemDeCatalogo, modelo3dVigente, type CatalogoFila } from '../catalogo';
import { cabeceraGlb, dimensionCm, dimensionesCm, nombreArchivoModelo3d, nombreOriginalModelo3d, puedeVerModelo3d, tamanoLegible, urlModelo3d, validarModelo3d } from '../medios';
import { cargarModelo3d, editarDimensionesModelo3d, resumenModelos3d, retirarModelo3d } from '../mediosDb';
import type { VitrinaDb } from '../access';
import type { VitrinaImageStorage } from '../storage';

// ---------------------------------------------------------------------------
// GLB de prueba: cabecera de 12 bytes + chunk JSON (+ chunk BIN opcional).
// ---------------------------------------------------------------------------
function glb({ magic = 'glTF', version = 2, longitud, chunk = 0x4e4f534a }: { magic?: string; version?: number; longitud?: number; chunk?: number } = {}): Uint8Array {
  const json = new TextEncoder().encode('{"asset":{"version":"2.0"}}  '); // 28 bytes, múltiplo de 4
  const total = 12 + 8 + json.length;
  const b = new Uint8Array(total);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < 4; i += 1) b[i] = magic.charCodeAt(i);
  dv.setUint32(4, version, true);
  dv.setUint32(8, longitud ?? total, true);
  dv.setUint32(12, json.length, true);
  dv.setUint32(16, chunk, true);
  b.set(json, 20);
  return b;
}

describe('Vitrina · modelo 3D: validación del GLB por contenido', () => {
  it('acepta un GLB glTF 2.0 completo y lee su cabecera', () => {
    const b = glb();
    expect(cabeceraGlb(b)).toEqual({ version: 2, longitud: b.length });
    expect(validarModelo3d(b)).toEqual({ version: 2, longitud: b.length });
  });

  it('rechaza lo que no empieza por «glTF» (aunque se llame .glb): PNG, glTF de texto, ZIP de Dimension', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]);
    const gltfTexto = new TextEncoder().encode('{"asset":{"version":"2.0"}}');
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    for (const b of [png, gltfTexto, zip, glb({ magic: 'GLTF' })]) {
      expect(cabeceraGlb(b)).toBeNull();
      expect(() => validarModelo3d(b)).toThrow(/no es un modelo GLB/);
    }
  });

  it('exige glTF versión 2', () => {
    expect(() => validarModelo3d(glb({ version: 1 }))).toThrow(/versión 1: se requiere glTF 2.0/);
  });

  it('rechaza un GLB truncado o con longitud que no coincide', () => {
    const b = glb();
    expect(() => validarModelo3d(b.slice(0, b.length - 4))).toThrow(/incompleto o dañado/);
    expect(() => validarModelo3d(glb({ longitud: 9999 }))).toThrow(/incompleto o dañado/);
  });

  it('exige que el primer chunk sea JSON', () => {
    expect(() => validarModelo3d(glb({ chunk: 0x004e4942 }))).toThrow(/sección JSON/);
  });

  it('vacío y más de 25 MB se rechazan', () => {
    expect(() => validarModelo3d(new Uint8Array())).toThrow(/Adjunte/);
    const grande = new Uint8Array(VITRINA_MODELO3D_MAX_BYTES + 1);
    grande.set(glb());
    expect(() => validarModelo3d(grande)).toThrow(/supera 25 MB/);
    expect(cabeceraGlb(new Uint8Array([0x67, 0x6c, 0x54]))).toBeNull();
  });
});

describe('Vitrina · modelo 3D: nombres, medidas y URL', () => {
  it('nombre del archivo con versión y token; nombre original saneado', () => {
    expect(nombreArchivoModelo3d(3, 'a1b2-c3d4-e5f6')).toBe('MODELO3D-v3-a1b2c3d4.glb');
    expect(nombreOriginalModelo3d('C:\\Diseño\\Atropina x100.glb')).toBe('Atropina x100.glb');
    expect(nombreOriginalModelo3d('../../x\u0000.glb')).toBe('x.glb');
    expect(nombreOriginalModelo3d(null)).toBe('modelo.glb');
    expect(nombreOriginalModelo3d('a'.repeat(400))).toHaveLength(255);
  });

  it('medidas opcionales en cm: vacío = null, coma decimal, (0, 1000], 2 decimales', () => {
    expect(dimensionCm('', 'Ancho')).toBeNull();
    expect(dimensionCm(null, 'Ancho')).toBeNull();
    expect(dimensionCm('7,5', 'Ancho')).toBe(7.5);
    expect(dimensionCm(3.456, 'Alto')).toBe(3.46);
    expect(() => dimensionCm('0', 'Alto')).toThrow(/Alto/);
    expect(() => dimensionCm(-2, 'Alto')).toThrow();
    expect(() => dimensionCm('1001', 'Profundo')).toThrow(/1000/);
    expect(() => dimensionCm('abc', 'Ancho')).toThrow();
    expect(dimensionesCm({ ancho_cm: '7,5', alto_cm: '', profundo_cm: 15 })).toEqual({ ancho: 7.5, alto: null, profundo: 15 });
  });

  it('el modelo se sirve por la Vitrina (nunca el enlace de OneDrive)', () => {
    expect(urlModelo3d(7)).toBe('/api/vitrina/modelos-3d/7');
    expect(tamanoLegible(426032)).toBe('416 KB');
    expect(tamanoLegible(13 * 1024 * 1024)).toBe('13,0 MB');
  });
});

describe('Vitrina · modelo 3D: permisos (igual que las imágenes)', () => {
  const comercial = [{ idCompany: 1, companyName: 'Farmalógica', canConsultar: true, canGestionar: false }];
  const gestor = [{ idCompany: 1, companyName: 'Farmalógica', canConsultar: true, canGestionar: true }];

  it('el vigente lo ve quien consulta en la empresa dueña de la presentación', () => {
    expect(puedeVerModelo3d(comercial, { idCompany: 1, vigente: true })).toBe(true);
    expect(puedeVerModelo3d(gestor, { idCompany: 1, vigente: true })).toBe(true);
  });

  it('otra empresa nunca lo ve (Farmalógica y Ryan no se mezclan)', () => {
    expect(puedeVerModelo3d(comercial, { idCompany: 2, vigente: true })).toBe(false);
    expect(puedeVerModelo3d([], { idCompany: 1, vigente: true })).toBe(false);
    expect(puedeVerModelo3d(gestor, null)).toBe(false);
  });

  it('uno reemplazado o retirado solo lo ve Gestión', () => {
    expect(puedeVerModelo3d(comercial, { idCompany: 1, vigente: false })).toBe(false);
    expect(puedeVerModelo3d(gestor, { idCompany: 1, vigente: false })).toBe(true);
  });
});

describe('Vitrina · modelo 3D en el catálogo y el modo presentación', () => {
  const HOY = '2026-11-04';
  const fila = (p: Partial<CatalogoFila> = {}): CatalogoFila => ({
    id_presentacion: 9,
    molecula: 'Atropina',
    concentracion: '1 mg',
    forma_farmaceutica: 'Ampolla',
    unidades_caja: 100,
    nombre_comercial: null,
    tall_man: null,
    familia: 'Anticolinérgicos',
    estado: 'VALIDADA',
    visibilidad: 'CLIENTE',
    es_para_terceros: false,
    destacada: false,
    codigos: [
      {
        item_code: 'PTRY0001',
        pais: 'Colombia',
        canal: 'INSTITUCIONAL',
        visibilidad_canal: 'CLIENTE',
        activado_vitrina: true,
        activo_en_sap: true,
        registro_estado: 'VIGENTE',
        registro_sanitario: 'INVIMA 2020M-1',
        registro_vence_en: new Date('2030-01-01T00:00:00Z'),
      },
    ],
    areas: [],
    imagenes: [],
    modelos3d: [
      { id_modelo: 4, vigente: false, ancho_cm: null, alto_cm: null, profundo_cm: null },
      { id_modelo: 7, vigente: true, ancho_cm: { toString: () => '7.50' }, alto_cm: '3.5', profundo_cm: null },
    ],
    exclusividades: [],
    ...p,
  });

  it('sale el vigente más reciente, con sus medidas; sin vigente (o sin tabla) no hay modelo', () => {
    expect(modelo3dVigente(fila().modelos3d)).toEqual({ id: 7, dimensionesCm: { ancho: 7.5, alto: 3.5, profundo: null } });
    expect(modelo3dVigente([{ id_modelo: 1, vigente: true }])).toEqual({ id: 1, dimensionesCm: null });
    expect(modelo3dVigente([{ id_modelo: 1, vigente: false }])).toBeNull();
    expect(modelo3dVigente(undefined)).toBeNull();
    expect(itemDeCatalogo(fila({ modelos3d: undefined }), 'interna', HOY)?.modelo3d).toBeNull();
  });

  it('vista interna y modo presentación muestran el modelo si la presentación se muestra', () => {
    expect(itemDeCatalogo(fila(), 'interna', HOY)?.modelo3d?.id).toBe(7);
    expect(itemDeCatalogo(fila(), 'presentacion', HOY)?.modelo3d?.id).toBe(7);
  });

  it('si la presentación no sale al cliente, su modelo tampoco (interna, terceros, exclusividad, registro vencido)', () => {
    const interna = fila({ visibilidad: 'INTERNA', codigos: [{ ...fila().codigos[0], visibilidad_canal: 'INTERNA' }] });
    expect(itemDeCatalogo(interna, 'presentacion', HOY)).toBeNull();
    expect(itemDeCatalogo(fila({ es_para_terceros: true, visibilidad: 'INTERNA' }), 'presentacion', HOY)).toBeNull();
    const excl = fila({ exclusividades: [{ cliente_beneficiario: 'Cliente X', pais: null, canal: null, alcance: 'OFERTAR', vigente_desde: null, vigente_hasta: null }] });
    expect(itemDeCatalogo(excl, 'presentacion', HOY)).toBeNull();
    expect(itemDeCatalogo(excl, 'interna', HOY)?.modelo3d?.id).toBe(7);
    expect(itemDeCatalogo(fila({ codigos: [{ ...fila().codigos[0], registro_estado: 'VENCIDO' }] }), 'presentacion', HOY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reemplazo y vigencia (base simulada en memoria; el almacenamiento, simulado).
// ---------------------------------------------------------------------------
interface FilaM {
  id_modelo: number;
  id_presentacion: number;
  ruta_archivo: string;
  nombre_original: string;
  tamano_bytes: number;
  version: number;
  vigente: boolean;
  ancho_cm: number | null;
  alto_cm: number | null;
  profundo_cm: number | null;
  cargado_por: string;
  cargado_en: Date;
}

function fakeDb(estado = 'VALIDADA') {
  const modelos: FilaM[] = [];
  const historial: { entidad: string; id_entidad: number; accion: string; valor_anterior: string | null; valor_nuevo: string | null }[] = [];
  const presentaciones = [
    { id_presentacion: 9, id_company: 1, estado, destacada: false },
    { id_presentacion: 20, id_company: 2, estado: 'VALIDADA', destacada: false },
  ];
  const coincide = (m: FilaM, w: Record<string, unknown>) =>
    (w.id_modelo === undefined || m.id_modelo === w.id_modelo) &&
    (w.id_presentacion === undefined || m.id_presentacion === w.id_presentacion) &&
    (w.vigente === undefined || m.vigente === w.vigente) &&
    (w.presentacion === undefined || presentaciones.find((p) => p.id_presentacion === m.id_presentacion)?.id_company === (w.presentacion as { id_company: number }).id_company);
  const db = {
    vitrinaPresentacion: {
      findFirst: async ({ where }: { where: { id_presentacion: number; id_company: number } }) =>
        presentaciones.find((p) => p.id_presentacion === where.id_presentacion && p.id_company === where.id_company) ?? null,
    },
    vitrinaModelo3d: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => modelos.filter((m) => coincide(m, where)),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => modelos.find((m) => coincide(m, where)) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<FilaM> }) => {
        const xs = modelos.filter((m) => coincide(m, where));
        xs.forEach((m) => Object.assign(m, data));
        return { count: xs.length };
      },
      update: async ({ where, data }: { where: { id_modelo: number }; data: Partial<FilaM> }) => Object.assign(modelos.find((m) => m.id_modelo === where.id_modelo)!, data),
      create: async ({ data }: { data: Omit<FilaM, 'id_modelo' | 'cargado_en'> }) => {
        const m = { ...data, id_modelo: modelos.length + 1, cargado_en: new Date() } as FilaM;
        modelos.push(m);
        return m;
      },
    },
    vitrinaHistorial: {
      create: async ({ data }: { data: (typeof historial)[number] }) => {
        historial.push(data);
        return data;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db: db as unknown as VitrinaDb, modelos, historial };
}

function fakeStorage() {
  const subir = vi.fn(async (_c: number, _p: number, nombre: string, _contenido: Uint8Array, _mime: string) => ({ id: `item-${nombre}` }));
  return { storage: { subir, bajar: vi.fn() } as unknown as VitrinaImageStorage, subir };
}

describe('Vitrina · modelo 3D: carga, reemplazo y vigencia', () => {
  const actor = { idCompany: 1, idUser: 'u-diseno' };

  it('la primera carga queda vigente (v1) con CARGAR en el historial y va al almacenamiento de la Vitrina', async () => {
    const { db, modelos, historial } = fakeDb();
    const { storage, subir } = fakeStorage();
    const r = await cargarModelo3d(db, storage, actor, { idPresentacion: 9, contenido: glb(), nombreOriginal: 'Atropina x100.glb', ancho_cm: '7,5' });
    expect(r).toEqual({ id: 1, version: 1, reemplazo: null });
    expect(subir).toHaveBeenCalledTimes(1);
    expect(subir.mock.calls[0][0]).toBe(1);
    expect(subir.mock.calls[0][1]).toBe(9);
    expect(subir.mock.calls[0][2]).toMatch(/^MODELO3D-v1-[A-Za-z0-9]{1,8}\.glb$/);
    expect(subir.mock.calls[0][4]).toBe('model/gltf-binary');
    expect(modelos).toHaveLength(1);
    expect(modelos[0]).toMatchObject({ vigente: true, version: 1, nombre_original: 'Atropina x100.glb', ancho_cm: 7.5, alto_cm: null, cargado_por: 'u-diseno' });
    expect(historial.map((h) => [h.entidad, h.accion])).toEqual([['modelo_3d', 'CARGAR']]);
  });

  it('reemplazar deja el anterior NO vigente (solo uno vigente), sube la versión y registra REEMPLAZAR', async () => {
    const { db, modelos, historial } = fakeDb();
    const { storage } = fakeStorage();
    await cargarModelo3d(db, storage, actor, { idPresentacion: 9, contenido: glb() });
    const r = await cargarModelo3d(db, storage, actor, { idPresentacion: 9, contenido: glb() });
    expect(r).toEqual({ id: 2, version: 2, reemplazo: 1 });
    expect(modelos.filter((m) => m.vigente).map((m) => m.id_modelo)).toEqual([2]);
    expect(historial.map((h) => h.accion)).toEqual(['CARGAR', 'REEMPLAZAR']);
    expect(JSON.parse(historial[1].valor_anterior ?? '{}')).toMatchObject({ id_modelo: 1, version: 1 });
    expect(resumenModelos3d(modelos)).toMatchObject({ vigente: { id: 2, version: 2 }, anteriores: 1 });
  });

  it('un archivo que no es GLB 2.0 no llega al almacenamiento ni a la base', async () => {
    const { db, modelos } = fakeDb();
    const { storage, subir } = fakeStorage();
    await expect(cargarModelo3d(db, storage, actor, { idPresentacion: 9, contenido: glb({ version: 1 }) })).rejects.toThrow(/glTF 2.0/);
    await expect(cargarModelo3d(db, storage, actor, { idPresentacion: 9, contenido: glb(), alto_cm: '0' })).rejects.toThrow(/Alto/);
    expect(subir).not.toHaveBeenCalled();
    expect(modelos).toHaveLength(0);
  });

  it('no carga en presentaciones de otra empresa ni retiradas', async () => {
    const { storage } = fakeStorage();
    await expect(cargarModelo3d(fakeDb().db, storage, actor, { idPresentacion: 20, contenido: glb() })).rejects.toMatchObject({ status: 404 });
    await expect(cargarModelo3d(fakeDb('RETIRADA').db, storage, actor, { idPresentacion: 9, contenido: glb() })).rejects.toMatchObject({ status: 409 });
  });

  it('retirar lo deja no vigente con RETIRAR en el historial; dos veces no cambia nada; otra empresa, 404', async () => {
    const { db, modelos, historial } = fakeDb();
    const { storage } = fakeStorage();
    await cargarModelo3d(db, storage, actor, { idPresentacion: 9, contenido: glb() });
    expect(await retirarModelo3d(db, actor, 1)).toEqual({ id: 1, cambios: 1 });
    expect(modelos[0].vigente).toBe(false);
    expect(await retirarModelo3d(db, actor, 1)).toEqual({ id: 1, cambios: 0 });
    expect(historial.map((h) => h.accion)).toEqual(['CARGAR', 'RETIRAR']);
    expect(resumenModelos3d(modelos)).toEqual({ vigente: null, anteriores: 1 });
    await expect(retirarModelo3d(db, { idCompany: 2, idUser: 'x' }, 1)).rejects.toMatchObject({ status: 404 });
  });

  it('las medidas del vigente se editan con historial; las de uno retirado no', async () => {
    const { db, modelos, historial } = fakeDb();
    const { storage } = fakeStorage();
    await cargarModelo3d(db, storage, actor, { idPresentacion: 9, contenido: glb() });
    expect(await editarDimensionesModelo3d(db, actor, 1, { ancho_cm: '7,5', alto_cm: '3,5', profundo_cm: '15' })).toEqual({ id: 1, cambios: 1 });
    expect(modelos[0]).toMatchObject({ ancho_cm: 7.5, alto_cm: 3.5, profundo_cm: 15 });
    expect(await editarDimensionesModelo3d(db, actor, 1, { ancho_cm: 7.5, alto_cm: 3.5, profundo_cm: 15 })).toEqual({ id: 1, cambios: 0 });
    expect(historial.map((h) => h.accion)).toEqual(['CARGAR', 'EDITAR']);
    await retirarModelo3d(db, actor, 1);
    await expect(editarDimensionesModelo3d(db, actor, 1, { ancho_cm: 8 })).rejects.toMatchObject({ status: 409 });
  });
});
