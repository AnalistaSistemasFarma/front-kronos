import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Dependencias simuladas: BD, SAP, token/envío a Nabuco, acceso, cifrado y alertas. */
const m = vi.hoisted(() => ({
  tomarLock: vi.fn(),
  soltarLock: vi.fn(),
  enviosPrevios: vi.fn(),
  registrarResultado: vi.fn(),
  sapGet: vi.fn(),
  obtenerToken: vi.fn(),
  enviarConToken: vi.fn(),
}));

vi.mock('../db', () => ({
  NabucoError: class NabucoError extends Error {
    status: number;
    constructor(msg: string, status = 400) {
      super(msg);
      this.status = status;
    }
  },
  tomarLock: m.tomarLock,
  soltarLock: m.soltarLock,
  enviosPrevios: m.enviosPrevios,
  registrarResultado: m.registrarResultado,
  marcarAlertaEnviada: vi.fn(),
  obtenerConfig: vi.fn(),
  pendientesDeConfig: vi.fn(),
  registrarPruebaManual: vi.fn(),
}));
vi.mock('../../sap/serviceLayer', () => ({
  sapLogin: vi.fn(async () => ({ baseUrl: 'x', sessionId: 's' })),
  sapLogout: vi.fn(async () => undefined),
  sapGet: m.sapGet,
  sapGetAll: vi.fn(),
  sapPatch: vi.fn(),
}));
vi.mock('../access', () => ({ getEndpointSap: vi.fn(async () => ({ id: 1 })) }));
vi.mock('../cifrado', () => ({ descifrarSecreto: () => 'clave' }));
vi.mock('../alertas', () => ({ enviarAlerta: vi.fn(async () => 0) }));
vi.mock('../tokenCache', () => ({ obtenerToken: m.obtenerToken, enviarConToken: m.enviarConToken, renovarToken: vi.fn() }));

import { crearDocumentos, ordenarPendientes, simularDocumentos, validarDocEntries, validarLimite, buscarPendientes } from '../asistida';
import { problemasArmado, MAPEO_ENCABEZADO_DEFECTO, MAPEO_LINEAS_DEFECTO } from '../mapeo';
import type { NabucoConfig } from '../db';

const cfg = {
  id_config: 7,
  id_company: 1,
  nombre: 'Prueba',
  modo_simulacion: true,
  id_sap_endpoint: 1,
  nabuco_url: 'http://pruebas.nabuco.local',
  nabuco_usuario: 'u',
  nabuco_password_enc: 'enc',
  nabuco_org: '1',
  ruta_token: '/AuthBI',
  ruta_solicitudes: '/api/NabucoWmsSolicitudesAlistamiento',
  timeout_ms: 30000,
  entidad_sap: 'Invoices',
  filtro_odata: null,
  desde_fecha: '2026-10-01',
  marcar_udf: false,
  udf_campo: null,
  udf_valor: null,
  clave_lineas: 'items',
  mapeo_encabezado: [{ campo: 'observaciones', origen: 'campo_sap', valor: 'DocNum' }],
  mapeo_lineas: [{ campo: 'codigoProducto', origen: 'campo_sap', valor: 'ItemCode' }],
  max_reintentos: 3,
  espera_reintento_min: 30,
  alertas_correos: [],
  alertar_fallo: false,
} as unknown as NabucoConfig;

const doc = (n: number) => ({ DocEntry: n, DocNum: 1000 + n, DocumentLines: [{ ItemCode: 'A1' }] });

beforeEach(() => {
  vi.clearAllMocks();
  m.tomarLock.mockResolvedValue(true);
  m.enviosPrevios.mockResolvedValue([]);
  m.registrarResultado.mockResolvedValue({ id_envio: 99, intentos: 1 });
  m.obtenerToken.mockResolvedValue('tok');
  m.enviarConToken.mockResolvedValue({ ok: true, status: 200, cuerpo: '{"id":1}', tokenRenovado: false });
  m.sapGet.mockImplementation(async (_s: unknown, ruta: string) => doc(Number(/\((\d+)\)/.exec(ruta)?.[1])));
});

describe('ordenarPendientes', () => {
  it('ordena del más reciente al más antiguo (DocDate desc, DocEntry desc)', () => {
    const r = ordenarPendientes(
      [
        { DocEntry: 1, DocDate: '2026-10-01T00:00:00Z' },
        { DocEntry: 3, DocDate: '2026-10-20T00:00:00Z' },
        { DocEntry: 2, DocDate: '2026-10-20T00:00:00Z' },
        { DocEntry: 5, DocDate: '2026-09-01T00:00:00Z' },
      ],
      []
    );
    expect(r.map((d) => d.DocEntry)).toEqual([3, 2, 1, 5]);
    expect(r[0].estado_log).toBe('nuevo');
  });

  it('excluye enviados y descartados y marca el estado del log', () => {
    const ahora = new Date();
    const r = ordenarPendientes(
      [1, 2, 3, 4, 5].map((n) => ({ DocEntry: n, DocDate: '2026-10-10' })),
      [
        { doc_entry: 1, estado: 'enviado', intentos: 1, proximo_intento: null },
        { doc_entry: 2, estado: 'descartado', intentos: 0, proximo_intento: null },
        { doc_entry: 3, estado: 'error', intentos: 2, proximo_intento: ahora },
        { doc_entry: 4, estado: 'simulado', intentos: 0, proximo_intento: null },
      ]
    );
    expect(r.map((d) => [d.DocEntry, d.estado_log, d.intentos])).toEqual([
      [5, 'nuevo', 0],
      [4, 'simulado', 0],
      [3, 'error', 2],
    ]);
  });
});

describe('límites', () => {
  it('limite por defecto 50 y máximo 200', () => {
    expect(validarLimite(undefined)).toBe(50);
    expect(validarLimite('abc')).toBe(50);
    expect(validarLimite('10')).toBe(10);
    expect(validarLimite(5000)).toBe(200);
  });
  it('docEntries: 1..200, enteros positivos, sin repetidos', () => {
    expect(() => validarDocEntries([])).toThrow(/al menos/);
    expect(() => validarDocEntries('1,2')).toThrow();
    expect(() => validarDocEntries(Array.from({ length: 201 }, (_, i) => i + 1))).toThrow(/Máximo 200/);
    expect(() => validarDocEntries([1, -2])).toThrow(/no válido/);
    expect(validarDocEntries([3, 3, '4'])).toEqual([3, 4]);
    expect(validarDocEntries(Array.from({ length: 200 }, (_, i) => i + 1))).toHaveLength(200);
  });
});

describe('problemasArmado', () => {
  it('detecta campo SAP inexistente y documento sin líneas', () => {
    expect(problemasArmado({ DocNum: 1, Comments: null, DocDate: 'x', CardName: 'c', ShipToCode: null, DocumentLines: [{ ItemCode: 'A', Quantity: 1, MeasureUnit: 'UND' }] }, 'Invoices', MAPEO_ENCABEZADO_DEFECTO, MAPEO_LINEAS_DEFECTO)).toEqual([]);
    const p = problemasArmado({ DocNum: 1 }, 'Invoices', [{ campo: 'x', origen: 'campo_sap', valor: 'NoExiste' }], MAPEO_LINEAS_DEFECTO);
    expect(p.join(' ')).toMatch(/NoExiste/);
    expect(p.join(' ')).toMatch(/no tiene líneas/);
  });
});

describe('buscarPendientes', () => {
  it('consulta SAP con $select acotado, más recientes primero, excluye enviados y avisa si hay más', async () => {
    m.sapGet.mockResolvedValueOnce({
      value: [
        { DocEntry: 9, DocNum: 109, DocDate: '2026-10-25' },
        { DocEntry: 8, DocNum: 108, DocDate: '2026-10-24' },
        { DocEntry: 7, DocNum: 107, DocDate: '2026-10-23' },
      ],
    });
    m.enviosPrevios.mockResolvedValueOnce([{ doc_entry: 8, estado: 'enviado', intentos: 1, proximo_intento: null }]);
    const r = await buscarPendientes(cfg, 1);
    const ruta = decodeURIComponent(m.sapGet.mock.calls[0][1] as string);
    expect(ruta).toContain('$select=DocEntry,DocNum,DocDate,CardName,DocTotal');
    expect(ruta).toContain('$orderby=DocDate desc,DocEntry desc');
    expect(ruta).toContain("$filter=DocDate ge '2026-10-01'");
    expect(r.documentos.map((d) => d.DocEntry)).toEqual([9]);
    expect(r.hayMas).toBe(true);
  });
});

describe('simularDocumentos', () => {
  it('registra simulado los válidos y reporta errores de armado sin registrarlos', async () => {
    m.sapGet.mockImplementation(async (_s: unknown, ruta: string) => (ruta.includes('(2)') ? { DocEntry: 2, DocNum: 1002, DocumentLines: [] } : doc(1)));
    const r = await simularDocumentos(cfg, [1, 2], 'admin@x');
    expect(r[0]).toMatchObject({ docEntry: 1, docNum: 1001, ok: true, payload: { observaciones: 1001, items: [{ codigoProducto: 'A1' }] } });
    expect(r[1].ok).toBe(false);
    expect(r[1].error).toMatch(/no tiene líneas/);
    expect(m.registrarResultado).toHaveBeenCalledTimes(1);
    expect(m.registrarResultado.mock.calls[0][2]).toMatchObject({ estado: 'simulado', cuentaIntento: false });
    expect(m.registrarResultado.mock.calls[0][3]).toBe('admin@x');
    expect(m.enviarConToken).not.toHaveBeenCalled();
    expect(m.soltarLock).toHaveBeenCalledWith(7);
  });

  it('409 si la configuración está ocupada (lock del motor)', async () => {
    m.tomarLock.mockResolvedValue(false);
    await expect(simularDocumentos(cfg, [1], 'a')).rejects.toMatchObject({ status: 409 });
  });
});

describe('crearDocumentos', () => {
  it('envía aunque la config esté en simulación y registra enviado con el usuario', async () => {
    const r = await crearDocumentos(cfg, [1], 'admin@x', undefined);
    expect(r).toEqual([expect.objectContaining({ docEntry: 1, estado: 'enviado', http_status: 200, id_envio: 99 })]);
    expect(m.enviarConToken).toHaveBeenCalledTimes(1);
    expect(m.registrarResultado.mock.calls[0][2]).toMatchObject({ estado: 'enviado' });
    expect(m.registrarResultado.mock.calls[0][3]).toBe('admin@x');
  });

  it('no reenvía un documento ya enviado (carrera) y lo reporta como ya_enviado', async () => {
    m.enviosPrevios.mockImplementation(async (_c: number, _e: string, docs: number[]) => (docs[0] === 2 ? [{ doc_entry: 2, estado: 'enviado', intentos: 1, proximo_intento: null }] : []));
    const r = await crearDocumentos(cfg, [1, 2], 'a', undefined);
    expect(r.map((x) => x.estado)).toEqual(['enviado', 'ya_enviado']);
    expect(m.enviarConToken).toHaveBeenCalledTimes(1);
  });

  it('error HTTP de Nabuco queda como error con intento', async () => {
    m.enviarConToken.mockResolvedValue({ ok: false, status: 422, cuerpo: 'malo', tokenRenovado: false });
    const r = await crearDocumentos(cfg, [1], 'a', undefined);
    expect(r[0]).toMatchObject({ estado: 'error', http_status: 422 });
    expect(m.registrarResultado.mock.calls[0][2]).toMatchObject({ estado: 'error', cuentaIntento: true });
  });

  it('producción de Nabuco exige confirmoProduccion === true', async () => {
    const prod = { ...cfg, nabuco_url: 'https://nabucoapi.azurewebsites.net' } as NabucoConfig;
    await expect(crearDocumentos(prod, [1], 'a', undefined)).rejects.toMatchObject({ status: 409 });
    await expect(crearDocumentos(prod, [1], 'a', 'true')).rejects.toMatchObject({ status: 409 });
    expect(m.tomarLock).not.toHaveBeenCalled();
    expect(m.enviarConToken).not.toHaveBeenCalled();
    const r = await crearDocumentos(prod, [1], 'a', true);
    expect(r[0].estado).toBe('enviado');
  });

  it('409 si la configuración está ocupada', async () => {
    m.tomarLock.mockResolvedValue(false);
    await expect(crearDocumentos(cfg, [1], 'a', undefined)).rejects.toMatchObject({ status: 409 });
    expect(m.enviarConToken).not.toHaveBeenCalled();
  });
});

describe('crearDocumentos sin token', () => {
  it('si Nabuco no da token, 502 y no envía nada', async () => {
    m.obtenerToken.mockRejectedValue(new Error('HTTP 401'));
    await expect(crearDocumentos(cfg, [1], 'a', undefined)).rejects.toMatchObject({ status: 502 });
    expect(m.enviarConToken).not.toHaveBeenCalled();
    expect(m.soltarLock).toHaveBeenCalledWith(7);
  });
});
