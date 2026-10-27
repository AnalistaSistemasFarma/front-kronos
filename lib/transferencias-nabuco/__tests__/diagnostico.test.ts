import { describe, expect, it } from 'vitest';
import {
  NabucoDiagnosticoError,
  clasificarHttp,
  clasificarRed,
  diagnosticoSap,
  enmascararCabeceras,
  enmascararToken,
  errorDeRed,
  leerDiagnostico,
  resumenDiagnostico,
  respuestaErrorApi,
  serializarDiagnostico,
} from '../diagnostico';
import { enviarSolicitudCruda, pedirTokenDetalle, type NabucoConexion } from '../nabucoClient';
import { resolverConexionPrueba, type ConfigConexion } from '../conexionPrueba';

const PWD = 'Sup3rS3creta!';
const TOKEN = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: 'x', exp: 9999999999 })).toString('base64url')}.firmaSecretaLarga123`;
const c: NabucoConexion = { url: 'https://nabuco.test', usuario: 'u', password: PWD, org: '1', rutaToken: '/AuthBI', rutaSolicitudes: '/api/Sol', timeoutMs: 5000 };

function redError(code: string): Error {
  return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`connect ${code}`), { code }) });
}

describe('clasificador de red', () => {
  it.each([
    ['ENOTFOUND', /DNS/, /host/],
    ['ECONNREFUSED', /rechazó/, /puerto/],
    ['ETIMEDOUT', /no respondió a tiempo/, /timeout/],
    ['UND_ERR_CONNECT_TIMEOUT', /no respondió a tiempo/, /dormido/],
    ['TimeoutError', /no respondió a tiempo/, /timeout/],
    ['AbortError', /no respondió a tiempo/, /timeout/],
    ['ECONNRESET', /se cortó/, /firewall/],
    ['CERT_HAS_EXPIRED', /TLS/, /certificado/],
  ])('%s', (codigo, msg, sug) => {
    const r = clasificarRed(codigo, 'nabuco.test', 30000);
    expect(r.mensaje).toMatch(msg);
    expect(r.sugerencia).toMatch(sug);
  });

  it('saca el código de err.cause.code y de TimeoutError', () => {
    expect(errorDeRed(redError('ECONNREFUSED')).codigo).toBe('ECONNREFUSED');
    expect(errorDeRed(Object.assign(new Error('timeout'), { name: 'TimeoutError' })).codigo).toBe('TimeoutError');
  });
});

describe('clasificador HTTP', () => {
  it('401 en AuthBI → credenciales (sugiere org 0 vs 1); 401 en solicitudes → token vencido', () => {
    expect(clasificarHttp(401, 'autenticacion').sugerencia).toMatch(/org.*0 o 1/);
    expect(clasificarHttp(401, 'envio').sugerencia).toMatch(/token nuevo/);
  });
  it('400 muestra el mensaje de Nabuco tal cual; 404 ruta; 405 método; 5xx Nabuco', () => {
    expect(clasificarHttp(400, 'envio', 'codigoProducto es obligatorio').mensaje).toContain('«codigoProducto es obligatorio»');
    expect(clasificarHttp(404, 'envio').sugerencia).toMatch(/Ruta mal configurada/);
    expect(clasificarHttp(405, 'autenticacion').sugerencia).toMatch(/POST/);
    expect(clasificarHttp(503, 'envio').mensaje).toMatch(/Error interno de Nabuco/);
  });
});

describe('pedirTokenDetalle / enviarSolicitudCruda → diagnóstico', () => {
  it('401: etapa autenticación, pwd SIEMPRE •••, cabeceras relevantes', async () => {
    const f = (async () => new Response('{"message":"Usuario o clave inválidos ' + PWD + '"}', { status: 401, statusText: 'Unauthorized', headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer', 'x-request-id': 'abc' } })) as typeof fetch;
    const e = await pedirTokenDetalle(c, f).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NabucoDiagnosticoError);
    const d = (e as NabucoDiagnosticoError).diagnostico;
    expect(d).toMatchObject({ ok: false, etapa: 'autenticacion', respuesta: { http_status: 401, cabeceras: { 'www-authenticate': 'Bearer', 'x-request-id': 'abc' } } });
    expect(d.peticion?.cuerpo).toContain('"pwd":"•••"');
    expect(serializarDiagnostico(d)).not.toContain(PWD);
    expect(resumenDiagnostico(d)).not.toContain(PWD);
  });

  it('OK: el token nunca aparece completo', async () => {
    const f = (async () => new Response(JSON.stringify(TOKEN), { status: 200 })) as typeof fetch;
    const r = await pedirTokenDetalle(c, f);
    expect(r.token).toBe(TOKEN);
    const s = serializarDiagnostico(r.diagnostico);
    expect(r.diagnostico.ok).toBe(true);
    expect(s).not.toContain(TOKEN);
    expect(s).not.toContain(PWD);
    expect(s).toContain('oculto');
  });

  it('200 sin token reconocible → etapa respuesta con lo que llegó', async () => {
    const f = (async () => new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
    const d = ((await pedirTokenDetalle(c, f).catch((x: unknown) => x)) as NabucoDiagnosticoError).diagnostico;
    expect(d.etapa).toBe('respuesta');
    expect(d.detalle).toContain('<html>login</html>');
  });

  it('ENOTFOUND → etapa red con código', async () => {
    const f = (async () => {
      throw redError('ENOTFOUND');
    }) as typeof fetch;
    const d = ((await pedirTokenDetalle(c, f).catch((x: unknown) => x)) as NabucoDiagnosticoError).diagnostico;
    expect(d).toMatchObject({ ok: false, etapa: 'red', red: { codigo: 'ENOTFOUND' } });
    expect(d.sugerencia).toMatch(/host/);
    expect(serializarDiagnostico(d)).not.toContain(PWD);
  });

  it('envío: Authorization enmascarada; 400 no JSON muestra cuerpo crudo', async () => {
    const f = (async () => new Response('Bad payload', { status: 400, headers: { 'content-type': 'text/plain' } })) as typeof fetch;
    const r = await enviarSolicitudCruda(c, TOKEN, '{"a":1}', f);
    expect(r.ok).toBe(false);
    expect(r.diagnostico).toMatchObject({ etapa: 'envio', respuesta: { http_status: 400, cuerpo_crudo: 'Bad payload' } });
    expect(r.diagnostico.peticion?.cabeceras.Authorization).toMatch(/^Bearer .*oculto, \d+ caracteres\)$/);
    expect(r.diagnostico.detalle).toMatch(/no es JSON/);
    expect(serializarDiagnostico(r.diagnostico)).not.toContain(TOKEN);
  });

  it('enmascarado y lectura del diagnóstico serializado', () => {
    expect(enmascararToken(TOKEN)).not.toContain(TOKEN.slice(10));
    expect(enmascararCabeceras({ Authorization: `Bearer ${TOKEN}`, Accept: 'x' }).Accept).toBe('x');
    const d = diagnosticoSap({ name: 'SapError', message: 'SAP GET StockTransfers(5) fallo (404)', status: 404, detail: '{"error":{"code":-2028,"message":{"value":"No matching records found"}}}' } as never, { entidad: 'StockTransfers', docEntry: 5 });
    expect(d.mensaje).toContain('-2028');
    expect(d.mensaje).toContain('No matching records found');
    expect(leerDiagnostico(serializarDiagnostico(d))?.etapa).toBe('sap');
    expect(leerDiagnostico('{"x":1}')).toBeNull();
  });
});

describe('respuestaErrorApi: upstream → 200 ok:false; lo nuestro con su código', () => {
  it('Nabuco/red → 200', () => {
    const d = clasificarRed('ECONNREFUSED', 'h');
    const r = respuestaErrorApi(new NabucoDiagnosticoError({ ok: false, etapa: 'red', mensaje: d.mensaje, duracion_ms: 1, cuando: '' }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, diagnostico: { etapa: 'red' } });
  });
  it('SAP → 200 etapa sap; validación → 400; NabucoError 409; desconocido → 500 interno', () => {
    expect(respuestaErrorApi(Object.assign(new Error('SAP Login fallido (401)'), { name: 'SapError', status: 401, detail: '' }))).toMatchObject({ status: 200, body: { diagnostico: { etapa: 'sap' } } });
    expect(respuestaErrorApi(new NabucoDiagnosticoError({ ok: false, etapa: 'validacion', mensaje: 'x', duracion_ms: 0, cuando: '' })).status).toBe(400);
    expect(respuestaErrorApi(Object.assign(new Error('ocupada'), { name: 'NabucoError', status: 409 }))).toMatchObject({ status: 409, body: { diagnostico: { http_synerlink: 409 } } });
    expect(respuestaErrorApi(new Error('boom'))).toMatchObject({ status: 500, body: { diagnostico: { etapa: 'interno', mensaje: expect.stringContaining('boom') } } });
  });
});

describe('probar con datos de pantalla (resolverConexionPrueba)', () => {
  const cfg: ConfigConexion = { nabuco_url: 'https://guardada.test', nabuco_usuario: 'guardado', nabuco_password_enc: 'enc', nabuco_org: '1', ruta_token: '/AuthBI', ruta_solicitudes: '/api/Sol', timeout_ms: 30000 };
  const descifrar = (s: string) => `descifrada(${s})`;

  it('sin body usa lo guardado y no marca cambios', () => {
    const r = resolverConexionPrueba(cfg, null, descifrar);
    expect(r.usaCambiosSinGuardar).toBe(false);
    expect(r.conexion).toMatchObject({ url: 'https://guardada.test', usuario: 'guardado', password: 'descifrada(enc)' });
  });

  it('cada campo del body reemplaza solo para la prueba; contraseña vacía usa la guardada', () => {
    const r = resolverConexionPrueba(cfg, { nabuco_usuario: 'nuevo', nabuco_password: '', nabuco_org: '0', timeout_ms: 60000 }, descifrar);
    expect(r.usaCambiosSinGuardar).toBe(true);
    expect(r.cambios).toEqual(['nabuco_usuario', 'nabuco_org', 'timeout_ms']);
    expect(r.conexion).toMatchObject({ url: 'https://guardada.test', usuario: 'nuevo', password: 'descifrada(enc)', org: '0', timeoutMs: 60000 });
    expect(cfg.nabuco_usuario).toBe('guardado'); // no muta lo guardado
  });

  it('contraseña escrita reemplaza; mismos valores que lo guardado no cuentan como cambio', () => {
    const r = resolverConexionPrueba(cfg, { nabuco_url: 'https://guardada.test', nabuco_password: 'escrita' }, descifrar);
    expect(r.conexion.password).toBe('escrita');
    expect(r.cambios).toEqual(['nabuco_password']);
  });

  it('el caso de Nicolás: config sin credenciales + datos en pantalla → prueba con lo de pantalla', () => {
    const vacia = { ...cfg, nabuco_usuario: null, nabuco_password_enc: null };
    const r = resolverConexionPrueba(vacia, { nabuco_usuario: 'nico', nabuco_password: 'pwd' }, descifrar);
    expect(r).toMatchObject({ usaCambiosSinGuardar: true, conexion: { usuario: 'nico', password: 'pwd' } });
  });

  it('valida: dice qué falta, protocolo y rutas', () => {
    const vacia = { ...cfg, nabuco_usuario: null, nabuco_password_enc: null };
    expect(() => resolverConexionPrueba(vacia, {}, descifrar)).toThrow(/Falta el usuario, la contraseña/);
    expect(() => resolverConexionPrueba(cfg, { nabuco_url: 'ftp://x' }, descifrar, {})).toThrow(/https/);
    expect(() => resolverConexionPrueba(cfg, { nabuco_url: 'http://40.1.1.1:90' }, descifrar, {})).toThrow(/https/);
    expect(resolverConexionPrueba(cfg, { nabuco_url: 'http://40.1.1.1:90' }, descifrar, { NABUCO_PERMITIR_HTTP: '1' }).conexion.url).toBe('http://40.1.1.1:90');
    expect(() => resolverConexionPrueba(cfg, { ruta_token: 'AuthBI con espacio' }, descifrar)).toThrow(/ruta de token/);
    const e = (() => {
      try {
        resolverConexionPrueba(cfg, { nabuco_url: 'no-url' }, descifrar);
      } catch (x) {
        return x as NabucoDiagnosticoError;
      }
    })();
    expect(e?.diagnostico.etapa).toBe('validacion');
  });
});
