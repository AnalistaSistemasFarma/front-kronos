import { describe, expect, it } from 'vitest';
import { formatSubject, subjectKindOf, API_CLIENT_TYPES } from './constants';
import {
  clampSubjectLabel,
  mergeSapPartners,
  normalizeSapNit,
  parseExternalSystemCreate,
  parseExternalSystemPatch,
  parseNitList,
  parsePortalAccess,
  parseSearchQuery,
  resolvePortalAccessConfig,
  resolveSapApiConfig,
  SAP_API_COMPANIES,
  sapSupplierQuery,
} from './subject-rules';

describe('tipo → sujeto', () => {
  it('cada tipo tiene su sujeto (agente sin sujeto; México = persona)', () => {
    expect(API_CLIENT_TYPES.map((t) => [t, subjectKindOf(t)])).toEqual([
      ['agente', null],
      ['mexico', 'persona'],
      ['portal_terceros', 'tercero'],
      ['synerlink', 'usuario'],
      ['otro', 'sistema'],
    ]);
  });

  it('formatSubject arma el texto de la fila del panel', () => {
    expect(formatSubject('portal_terceros', '901724736', 'ABAMIA LABS')).toBe('Tercero: ABAMIA LABS · NIT 901724736');
    expect(formatSubject('portal_terceros', '901724736', '901724736')).toBe('Tercero: NIT 901724736');
    expect(formatSubject('portal_terceros', '901724736', null)).toBe('Tercero: NIT 901724736');
    expect(formatSubject('synerlink', 'clx1', 'Ana Gómez')).toBe('Usuario: Ana Gómez');
    expect(formatSubject('otro', '3', 'n8n')).toBe('Sistema: n8n');
    expect(formatSubject('mexico', 'ana@gss.mx', 'Ana López')).toBe('Correo: ana@gss.mx');
    expect(formatSubject('otro', null, null)).toBeNull();
    expect(formatSubject('agente', 'x', 'y')).toBeNull();
  });

  it('clampSubjectLabel limpia espacios y recorta a 200', () => {
    expect(clampSubjectLabel('  ABAMIA   LABS ')).toBe('ABAMIA LABS');
    expect(clampSubjectLabel('x'.repeat(300))).toHaveLength(200);
  });
});

describe('conexión con la API SAP', () => {
  const PEM = '-----BEGIN PRIVATE KEY-----\\nMC4CAQAwBQYDK2VwBCIEIA\\n-----END PRIVATE KEY-----';
  const env = (url?: string, key?: string, extra: Record<string, string> = {}) => ({
    SAP_API_URL: url,
    SAP_API_SYNERLINK_PRIVATE_KEY: key,
    ...extra,
  });
  const ok = (baseUrl: string, extra: Partial<{ issuer: string; audience: string }> = {}) => ({
    ok: true,
    baseUrl,
    privateKeyPem: PEM.replace(/\\n/g, '\n'),
    issuer: 'synerlink',
    audience: 'gss-sap-api',
    ...extra,
  });

  it('exige URL y llave privada PEM', () => {
    expect(resolveSapApiConfig({})).toEqual({ ok: false });
    expect(resolveSapApiConfig(env('https://sap-api.gss.com.co'))).toEqual({ ok: false });
    expect(resolveSapApiConfig(env(undefined, PEM))).toEqual({ ok: false });
    expect(resolveSapApiConfig(env('https://sap-api.gss.com.co', 'no es pem'))).toEqual({ ok: false });
  });

  it('HTTPS fuera de localhost; HTTP solo en localhost / 127.0.0.1; acepta comillas y \\n', () => {
    expect(resolveSapApiConfig(env('https://sap-api.gss.com.co/', PEM))).toEqual(ok('https://sap-api.gss.com.co'));
    expect(resolveSapApiConfig(env('http://127.0.0.1:4100', `"${PEM}"`))).toEqual(ok('http://127.0.0.1:4100'));
    expect(resolveSapApiConfig(env('http://localhost:4100/base/', PEM))).toEqual(ok('http://localhost:4100/base'));
    expect(resolveSapApiConfig(env('http://sap-api.gss.com.co', PEM))).toEqual({ ok: false });
    expect(resolveSapApiConfig(env('http://localhost.evil.com', PEM))).toEqual({ ok: false });
    expect(resolveSapApiConfig(env('no es url', PEM))).toEqual({ ok: false });
    expect(resolveSapApiConfig(env('https://u:p@sap-api.gss.com.co', PEM))).toEqual({ ok: false });
    expect(resolveSapApiConfig(env('https://sap-api.gss.com.co?x=1', PEM))).toEqual({ ok: false });
  });

  it('emisor y audiencia configurables', () => {
    expect(
      resolveSapApiConfig(env('https://sap-api.gss.com.co', PEM, { SAP_API_SYNERLINK_ISSUER: 'kronos', SAP_API_AUDIENCE: 'otra' }))
    ).toEqual(ok('https://sap-api.gss.com.co', { issuer: 'kronos', audience: 'otra' }));
  });
});

describe('búsqueda en la API SAP', () => {
  it('dígitos → NIT (acepta puntos y guion); texto → nombre de 3 a 60', () => {
    expect(sapSupplierQuery('900.123.456')).toEqual({ nit: '900123456' });
    expect(sapSupplierQuery('90012')).toEqual({ nit: '90012' });
    expect(sapSupplierQuery('9001')).toBeNull();
    expect(sapSupplierQuery(' abamia  labs ')).toEqual({ nombre: 'abamia labs' });
    expect(sapSupplierQuery('ab')).toBeNull();
    expect(sapSupplierQuery("x' or 1 eq 1")).toBeNull();
    expect(sapSupplierQuery('')).toBeNull();
  });

  it('NIT de SAP sin dígito de verificación ni puntos', () => {
    expect(normalizeSapNit('900.123.456-7')).toBe('900123456');
    expect(normalizeSapNit('901724736')).toBe('901724736');
    expect(normalizeSapNit('ABC')).toBeNull();
    expect(normalizeSapNit(null)).toBeNull();
  });

  it('une por NIT entre empresas, con tipo y orden por nombre', () => {
    const [gss, farma] = [SAP_API_COMPANIES[2], SAP_API_COMPANIES[0]];
    expect(
      mergeSapPartners([
        {
          empresa: farma,
          body: {
            items: [
              { cardCode: 'P1', cardName: ' ZETA  SAS ', nit: '800100200-1', type: 'PROVEEDOR', active: true },
              { cardCode: 'C1', cardName: 'ABAMIA LABS', nit: '901724736', type: 'CLIENTE', active: true },
              { cardCode: 'X', cardName: 'sin nit', nit: 'N/A', type: 'CLIENTE' },
              null,
            ],
          },
        },
        { empresa: gss, body: { items: [{ cardCode: 'P9', cardName: 'Abamia', nit: '901.724.736-0', type: 'PROVEEDOR' }] } },
        { empresa: gss, body: { error: 'forma ajena' } },
      ])
    ).toEqual([
      { nit: '901724736', nombre: 'ABAMIA LABS', empresas: [farma, gss], tipo: 'Proveedor y cliente' },
      { nit: '800100200', nombre: 'ZETA SAS', empresas: [farma], tipo: 'Proveedor' },
    ]);
  });

  it('limita a 50', () => {
    const items = Array.from({ length: 80 }, (_, i) => ({ cardName: 'x', nit: String(10000 + i), type: 'CLIENTE' }));
    expect(mergeSapPartners([{ empresa: SAP_API_COMPANIES[0], body: { items } }])).toHaveLength(50);
  });
});

describe('lo que ve en el portal (API de la landing)', () => {
  const KEY = 'k'.repeat(32);

  it('exige URL válida y llave de 32+ caracteres', () => {
    expect(resolvePortalAccessConfig({})).toEqual({ ok: false });
    expect(resolvePortalAccessConfig({ PORTAL_TERCEROS_URL: 'https://portal.gss.com.co', PORTAL_TERCEROS_KEY: 'corta' })).toEqual({ ok: false });
    expect(resolvePortalAccessConfig({ PORTAL_TERCEROS_URL: 'http://portal.gss.com.co', PORTAL_TERCEROS_KEY: KEY })).toEqual({ ok: false });
    expect(resolvePortalAccessConfig({ PORTAL_TERCEROS_URL: 'https://portal.gss.com.co/', PORTAL_TERCEROS_KEY: `"${KEY}"` })).toEqual({
      ok: true,
      baseUrl: 'https://portal.gss.com.co',
      key: KEY,
    });
    expect(resolvePortalAccessConfig({ PORTAL_TERCEROS_URL: 'http://localhost:3001', PORTAL_TERCEROS_KEY: KEY }).ok).toBe(true);
  });

  it('lista de NIT: únicos, 1 a 50, solo dígitos', () => {
    expect(parseNitList('830010792, 830010792,901724736')).toEqual(['830010792', '901724736']);
    expect(parseNitList('')).toBeNull();
    expect(parseNitList('830.010.792')).toBeNull();
    expect(parseNitList(Array.from({ length: 51 }, (_, i) => String(10000 + i)).join(','))).toBeNull();
  });

  it('cuenta módulos distintos y personas distintas; NIT sin vínculos queda en 0', () => {
    const r = parsePortalAccess(
      {
        items: [
          {
            nit: '830010792',
            empresas: [
              {
                clave: 'FARMALOGICA',
                nombre: 'Farmalógica',
                cardCode: 'P830010792',
                usuarios: [
                  { ref: 1, nombre: 'Ana', rol: 'Contable', modulos: [{ clave: 'facturas', nombre: 'Facturas de proveedor', area: 'Contabilidad' }, { clave: 'pagos', nombre: 'Pagos recibidos', area: 'Cartera' }] },
                  { ref: 2, nombre: '', rol: null, modulos: [] },
                ],
              },
              { clave: 'GSS', nombre: 'GSS', cardCode: 'P1', usuarios: [{ ref: 1, nombre: 'Ana', rol: 'Contable', modulos: [{ clave: 'facturas', nombre: 'Facturas de proveedor', area: 'Contabilidad' }, { clave: 'entradas', nombre: 'Entradas', area: 'Logística' }] }] },
              { nombre: 'sin clave' },
            ],
          },
          { nit: '999999', empresas: [] },
          'basura',
        ],
      },
      ['830010792', '901724736']
    );
    expect(r['830010792'].modulos).toBe(3);
    expect(r['830010792'].usuarios).toBe(2);
    expect(r['830010792'].empresas).toHaveLength(2);
    expect(r['830010792'].empresas[0].usuarios[1].nombre).toBe('Usuario sin nombre');
    expect(r['901724736']).toEqual({ nit: '901724736', empresas: [], modulos: 0, usuarios: 0 });
    expect(r['999999']).toBeUndefined();
  });

  it('respuesta ajena = todos en 0', () => {
    expect(parsePortalAccess({ error: 'x' }, ['830010792'])['830010792'].modulos).toBe(0);
    expect(parsePortalAccess(null, ['830010792'])['830010792'].usuarios).toBe(0);
  });
});

describe('búsqueda', () => {
  it('vacío = sin filtro; 2 a 60 caracteres; resto no válido', () => {
    expect(parseSearchQuery(null)).toBe('');
    expect(parseSearchQuery('   ')).toBe('');
    expect(parseSearchQuery(' ab  c ')).toBe('ab c');
    expect(parseSearchQuery('a')).toBeNull();
    expect(parseSearchQuery('x'.repeat(61))).toBeNull();
  });
});

describe('sistemas externos', () => {
  it('crear: nombre obligatorio, activo por defecto', () => {
    expect(parseExternalSystemCreate({ name: '  Power   Automate ' })).toEqual({
      ok: true,
      value: { name: 'Power Automate', description: null, active: true },
    });
    expect(parseExternalSystemCreate({ name: 'n8n', description: ' Flujos ', active: false })).toEqual({
      ok: true,
      value: { name: 'n8n', description: 'Flujos', active: false },
    });
  });

  it.each([
    ['sin nombre', {}],
    ['nombre corto', { name: 'x' }],
    ['nombre largo', { name: 'x'.repeat(121) }],
    ['descripción larga', { name: 'n8n', description: 'x'.repeat(501) }],
    ['activo no booleano', { name: 'n8n', active: 'si' }],
    ['campo desconocido', { name: 'n8n', id: 3 }],
    ['no objeto', null],
    ['arreglo', []],
  ])('crear rechaza: %s', (_name, body) => {
    expect(parseExternalSystemCreate(body).ok).toBe(false);
  });

  it('editar: solo los campos enviados', () => {
    expect(parseExternalSystemPatch({ active: false })).toEqual({ ok: true, value: { active: false } });
    expect(parseExternalSystemPatch({ name: ' Orion ', description: '' })).toEqual({
      ok: true,
      value: { name: 'Orion', description: null },
    });
  });

  it.each([
    ['vacío', {}],
    ['nombre corto', { name: 'a' }],
    ['activo no booleano', { active: 1 }],
    ['campo desconocido', { clientCount: 3 }],
    ['no objeto', 'x'],
  ])('editar rechaza: %s', (_name, body) => {
    expect(parseExternalSystemPatch(body).ok).toBe(false);
  });
});
