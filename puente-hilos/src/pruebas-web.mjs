/**
 * TESTING DE SYNERLINK COMO USUARIO QA — conector «synerlink-testing-web»
 * (orden de Nicolás Rivera, 2026-10-22 10:09 COT). Para que TODO hilo pueda
 * revisar las pantallas de testing sin pedirle a nadie que entre por él.
 *
 *   - Solo contra la web de PRUEBAS (por defecto http://192.168.11.230:3030; el
 *     host debe ser uno de HOSTS_PRUEBAS). Nunca producción.
 *   - Sesión del usuario QA (qa.sgc@gsslatam.com, solo existe en PRUEBAS): login
 *     de NextAuth (csrf → callback/credentials) hecho por ESTE proceso con la
 *     clave del archivo de secretos. Ni la clave ni las cookies llegan al
 *     modelo: no se devuelven cabeceras Set-Cookie y el cuerpo se limpia de
 *     cualquier valor secreto. La sesión se guarda en un archivo 600 fuera de la
 *     carpeta del hilo (y negado al sandbox de los comandos) para no iniciar
 *     sesión en cada turno.
 *   - Rutas relativas («/process/…»), mismo origen, sin /api/auth/* salvo
 *     /api/auth/session (no se puede cerrar la sesión ni loguear otro usuario).
 *   - Capturas (testing_captura): Chrome sin ventana DENTRO de sandbox-exec (el
 *     mismo encierro del PDF: sin leer /Users, sin escribir fuera de su carpeta
 *     temporal) con la red cerrada SALVO un proxy local de un solo uso que solo
 *     reenvía a la web de pruebas y le pone la cookie del QA. Tiempo máximo y
 *     muerte del grupo de procesos.
 */
import { spawn } from 'node:child_process';
import { constants as FS, existsSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { mkdtemp, open, realpath, rm, writeFile, mkdir, lstat, rename } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HOSTS_PRUEBAS } from './config.mjs';

export const BASE_TESTING_DEFECTO = 'http://192.168.11.230:3030';
export const MAX_CUERPO = 12_000;
export const MAX_ENVIO = 200_000;
export const TIMEOUT_HTTP_MS = 30_000;
export const TIMEOUT_CAPTURA_MS = 60_000;
export const SESION_MAX_MS = 12 * 60 * 60 * 1000;
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const AUTH_PERMITIDAS = new Set(['/api/auth/session']);

export class ErrorWeb extends Error {}

/** Base de testing: http(s), host de PRUEBAS, sin credenciales ni ruta. */
export function validarBase(base = BASE_TESTING_DEFECTO) {
  let u;
  try {
    u = new URL(base);
  } catch {
    throw new ErrorWeb('la base de testing no es una URL válida');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new ErrorWeb('la base de testing debe ser http(s)');
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) throw new ErrorWeb('la base de testing no lleva usuario, ruta ni parámetros');
  if (!HOSTS_PRUEBAS.includes(u.hostname)) throw new ErrorWeb(`«${u.hostname}» no es un servidor de PRUEBAS: este conector nunca va a producción`);
  return u.origin;
}

/** Ruta pedida → URL absoluta del MISMO origen; rechaza lo demás. */
export function urlDeRuta(base, ruta) {
  const r = String(ruta ?? '').trim();
  if (!r.startsWith('/') || r.startsWith('//') || r.includes('\\') || /[\u0000-\u001f]/.test(r)) throw new ErrorWeb('la ruta debe ser relativa a testing y empezar por «/» (por ejemplo /process o /api/companies)');
  const u = new URL(r, base);
  if (u.origin !== base) throw new ErrorWeb('la ruta sale del servidor de testing');
  const p = decodeURIComponent(u.pathname).replace(/\/+$/, '').toLowerCase();
  if (p.startsWith('/api/auth') && !AUTH_PERMITIDAS.has(p)) throw new ErrorWeb('las rutas /api/auth/* (iniciar o cerrar sesión) las maneja el conector; solo se permite /api/auth/session');
  return u;
}

/** Quita de un texto cualquier secreto conocido (clave, cookies). */
export function limpiar(texto, secretos) {
  let t = String(texto ?? '');
  for (const s of secretos) if (s && s.length >= 6) t = t.split(s).join('[oculto]');
  return t;
}

function leerCookies(resp, jar) {
  const lista = typeof resp.headers.getSetCookie === 'function' ? resp.headers.getSetCookie() : [];
  for (const c of lista) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    if (i <= 0) continue;
    const k = kv.slice(0, i).trim();
    const v = kv.slice(i + 1).trim();
    if (!v || /max-age=0|expires=thu, 01 jan 1970/i.test(c)) jar.delete(k);
    else jar.set(k, v);
  }
}

const cabeceraCookie = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

/**
 * Cliente de testing con la sesión del QA. `qa` = { email, password }.
 * `rutaSesion`: archivo 600 donde se guarda la sesión entre turnos (opcional).
 */
export function crearClienteTesting({ base = BASE_TESTING_DEFECTO, qa, rutaSesion = null, fetchImpl = globalThis.fetch, ahora = () => Date.now() }) {
  const origen = validarBase(base);
  if (!qa?.email || !qa?.password) throw new ErrorWeb('faltan las credenciales del usuario QA en el archivo de secretos');
  let jar = null;

  const secretos = () => [qa.password, ...(jar ? [...jar.values()] : [])];
  const pedir = (url, opts = {}) => fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_HTTP_MS), ...opts });

  function cargarGuardada() {
    if (!rutaSesion || !existsSync(rutaSesion)) return null;
    try {
      const j = JSON.parse(readFileSync(rutaSesion, 'utf8'));
      if (j?.origen !== origen || j?.email !== qa.email || !j?.cookies || ahora() - Number(j.ts) > SESION_MAX_MS) return null;
      return new Map(Object.entries(j.cookies));
    } catch {
      return null;
    }
  }
  function guardar() {
    if (!rutaSesion || !jar) return;
    try {
      const tmp = `${rutaSesion}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ origen, email: qa.email, ts: ahora(), cookies: Object.fromEntries(jar) }), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, rutaSesion);
    } catch {}
  }

  async function sesionValida(j) {
    const r = await pedir(`${origen}/api/auth/session`, { headers: { cookie: cabeceraCookie(j) } });
    if (r.status !== 200) return false;
    const s = await r.json().catch(() => null);
    return String(s?.user?.email ?? '').toLowerCase() === qa.email.toLowerCase();
  }

  async function iniciarSesion() {
    const j = new Map();
    let r = await pedir(`${origen}/api/auth/csrf`);
    leerCookies(r, j);
    const csrf = (await r.json().catch(() => null))?.csrfToken;
    if (!csrf) throw new ErrorWeb(`testing no entregó el token CSRF (HTTP ${r.status})`);
    r = await pedir(`${origen}/api/auth/callback/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cabeceraCookie(j) },
      body: new URLSearchParams({ csrfToken: csrf, email: qa.email, password: qa.password, json: 'true', callbackUrl: `${origen}/` }),
    });
    leerCookies(r, j);
    if (!(await sesionValida(j))) throw new ErrorWeb('no se pudo iniciar sesión en testing con el usuario QA (¿cambió su clave o está inactivo?)');
    jar = j;
    guardar();
    return jar;
  }

  async function sesion({ forzar = false } = {}) {
    if (jar && !forzar) return jar;
    if (!forzar) {
      const g = cargarGuardada();
      if (g && (await sesionValida(g).catch(() => false))) {
        jar = g;
        return jar;
      }
    }
    return iniciarSesion();
  }

  /** GET/POST a testing como QA. Devuelve { estado, tipo, redireccion, cuerpo, truncado, ms }. */
  async function http_({ metodo = 'GET', ruta, json = undefined, form = undefined, sinSesion = false }) {
    const m = String(metodo).toUpperCase();
    if (!['GET', 'POST'].includes(m)) throw new ErrorWeb('solo GET o POST');
    const url = urlDeRuta(origen, ruta);
    let cuerpo;
    const cab = { accept: 'application/json, text/html;q=0.9, */*;q=0.5' };
    if (m === 'POST') {
      if (json !== undefined && form !== undefined) throw new ErrorWeb('envíe json o form, no los dos');
      if (json !== undefined) {
        cuerpo = JSON.stringify(json);
        cab['content-type'] = 'application/json';
      } else if (form !== undefined) {
        if (typeof form !== 'object' || form === null) throw new ErrorWeb('form debe ser un objeto { campo: valor }');
        cuerpo = new URLSearchParams(Object.entries(form).map(([k, v]) => [k, String(v)])).toString();
        cab['content-type'] = 'application/x-www-form-urlencoded';
      }
      if (cuerpo && cuerpo.length > MAX_ENVIO) throw new ErrorWeb('el cuerpo supera 200 KB');
      cab.origin = origen;
    }
    const t0 = ahora();
    const una = async (j) => pedir(url, { method: m, headers: { ...cab, ...(j ? { cookie: cabeceraCookie(j) } : {}) }, body: cuerpo });
    let j = sinSesion ? null : await sesion();
    let r = await una(j);
    // Sesión vencida: una sola vez se vuelve a iniciar.
    const aLogin = (x) => x.status === 401 || ((x.status === 302 || x.status === 307) && /\/login\b/.test(x.headers.get('location') ?? ''));
    if (!sinSesion && aLogin(r)) {
      j = await sesion({ forzar: true });
      r = await una(j);
    }
    const tipo = r.headers.get('content-type') ?? '';
    let texto = await r.text().catch(() => '');
    if (/json/i.test(tipo)) {
      try {
        texto = JSON.stringify(JSON.parse(texto), null, 1);
      } catch {}
    }
    texto = limpiar(texto, secretos());
    const truncado = texto.length > MAX_CUERPO;
    let redireccion = r.headers.get('location');
    if (redireccion) {
      try {
        const u = new URL(redireccion, origen);
        redireccion = u.origin === origen ? `${u.pathname}${u.search}` : `(otro sitio: ${u.host})`;
      } catch {}
    }
    return { estado: r.status, tipo, redireccion: redireccion ?? null, cuerpo: truncado ? `${texto.slice(0, MAX_CUERPO)}\n… (recortado: ${texto.length} caracteres)` : texto, truncado, ms: ahora() - t0 };
  }

  return { origen, sesion, http: http_, secretos, cookies: () => (jar ? cabeceraCookie(jar) : '') };
}

/**
 * Proxy local de UN uso para Chrome: solo reenvía al origen de testing (http),
 * le pone la cookie del QA, no deja pasar /api/auth/* (salvo session) ni CONNECT
 * (https a terceros, p. ej. Sentry) y quita los Set-Cookie de las respuestas.
 */
export async function abrirProxy({ origen, cookie }) {
  const destino = new URL(origen);
  if (destino.protocol !== 'http:') throw new ErrorWeb('la captura solo funciona contra testing por http');
  const servidor = http.createServer((req, res) => {
    let u;
    try {
      u = new URL(req.url);
      if (u.origin !== origen) throw new Error('fuera');
      urlDeRuta(origen, `${u.pathname}${u.search}`);
    } catch {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('bloqueado por el conector de testing');
      return;
    }
    const cab = { ...req.headers, host: u.host };
    for (const k of Object.keys(cab)) if (/^proxy-/i.test(k)) delete cab[k];
    cab.cookie = [cookie, req.headers.cookie].filter(Boolean).join('; ');
    if (!cab.cookie) delete cab.cookie;
    const sal = http.request({ host: destino.hostname, port: destino.port || 80, method: req.method, path: `${u.pathname}${u.search}`, headers: cab, timeout: TIMEOUT_HTTP_MS }, (r) => {
      const h = { ...r.headers };
      delete h['set-cookie'];
      res.writeHead(r.statusCode ?? 502, h);
      r.pipe(res);
    });
    sal.on('timeout', () => sal.destroy(new Error('tiempo')));
    sal.on('error', () => {
      try {
        res.writeHead(502);
        res.end();
      } catch {}
    });
    req.pipe(sal);
  });
  servidor.on('connect', (_req, sock) => {
    try {
      sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    } catch {}
  });
  servidor.on('upgrade', (_req, sock) => sock.destroy());
  await new Promise((ok, mal) => {
    servidor.once('error', mal);
    servidor.listen(0, '127.0.0.1', ok);
  });
  return { puerto: servidor.address().port, cerrar: () => new Promise((ok) => servidor.close(() => ok())) };
}

/** Perfil SBPL de la captura: como el del PDF, pero con salida SOLO al proxy local. */
export function perfilCaptura(puerto) {
  if (!Number.isInteger(puerto) || puerto <= 0 || puerto > 65535) throw new ErrorWeb('puerto inválido');
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    `(allow network-outbound (remote ip "localhost:${puerto}"))`,
    '(deny file-read-data (subpath "/Users") (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/Volumes") (subpath "/Library/Keychains"))',
    '(allow file-read-data (subpath (param "CHROME")) (subpath (param "TMP")))',
    '(deny file-write* (subpath "/"))',
    '(allow file-write* (subpath (param "TMP")) (literal "/dev/null") (regex #"^/dev/fd/"))',
    '',
  ].join('\n');
}

export function argumentosCaptura({ tmp, salida, url, puerto, ancho, alto, esperaMs }) {
  return [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    `--user-data-dir=${path.join(tmp, 'perfil')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-extensions',
    '--disable-default-apps',
    '--mute-audio',
    '--block-new-web-contents',
    `--proxy-server=http://127.0.0.1:${puerto}`,
    '--proxy-bypass-list=<-loopback>',
    `--window-size=${ancho},${alto}`,
    `--virtual-time-budget=${esperaMs}`,
    `--screenshot=${salida}`,
    url,
  ];
}

/** Nombre de archivo seguro para la captura. */
export function nombreCaptura(nombre, ruta, fecha = new Date()) {
  const base = String(nombre ?? '').trim() || `captura-${String(ruta ?? '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'inicio'}-${fecha.toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
  const limpio = base.replace(/\.png$/i, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[.-]+/, '').slice(0, 80);
  return `${limpio || 'captura'}.png`;
}

/**
 * Toma la captura de una ruta de testing y la deja en <trabajo>/capturas/<nombre>.png.
 * Nunca escribe fuera de ./trabajo/capturas ni sigue enlaces simbólicos.
 */
export async function capturar({ cliente, chrome, trabajo, ruta, nombre, ancho = 1440, alto = 900, esperaMs = 8000, sinSesion = false, timeoutMs = TIMEOUT_CAPTURA_MS, spawnImpl = spawn }) {
  if (!chrome) throw new ErrorWeb('no hay Chrome sin ventana en este equipo');
  if (!existsSync(SANDBOX_EXEC)) throw new ErrorWeb('falta sandbox-exec');
  const url = urlDeRuta(cliente.origen, ruta);
  const w = Math.min(Math.max(Number.parseInt(ancho, 10) || 1440, 320), 2560);
  const h = Math.min(Math.max(Number.parseInt(alto, 10) || 900, 320), 4000);
  const espera = Math.min(Math.max(Number.parseInt(esperaMs, 10) || 8000, 1000), 20000);
  // Carpeta de destino: ./trabajo/capturas real, sin enlaces.
  const raiz = await realpath(trabajo);
  const dir = path.join(raiz, 'capturas');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const st = await lstat(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new ErrorWeb('./trabajo/capturas no es una carpeta normal');
  const archivo = nombreCaptura(nombre, ruta);
  const destino = path.join(dir, archivo);
  try {
    const d = await lstat(destino);
    if (d.isSymbolicLink() || !d.isFile()) throw new ErrorWeb('ya existe algo con ese nombre que no es un archivo');
  } catch (e) {
    if (e instanceof ErrorWeb) throw e;
  }
  const cookie = sinSesion ? '' : cabeceraDe(await cliente.sesion());
  const proxy = await abrirProxy({ origen: cliente.origen, cookie });
  let tmp = null;
  const t0 = Date.now();
  try {
    tmp = await realpath(await mkdtemp(path.join(tmpdir(), 'puente-captura-')));
    const perfil = path.join(tmp, 'perfil.sb');
    await writeFile(perfil, perfilCaptura(proxy.puerto), { mode: 0o600 });
    const salida = path.join(tmp, 'captura.png');
    const args = ['-f', perfil, '-D', `CHROME=${path.dirname(chrome)}`, '-D', `TMP=${tmp}`, chrome, ...argumentosCaptura({ tmp, salida, url: url.href, puerto: proxy.puerto, ancho: w, alto: h, esperaMs: espera })];
    const r = await new Promise((resolve) => {
      let hijo;
      try {
        hijo = spawnImpl(SANDBOX_EXEC, args, { env: { HOME: tmp, TMPDIR: `${tmp}/`, PATH: '/usr/bin:/bin', LANG: 'es_CO.UTF-8' }, cwd: tmp, stdio: ['ignore', 'ignore', 'ignore'], detached: true });
      } catch (e) {
        resolve({ codigo: -1, err: e.message });
        return;
      }
      let vencido = false;
      const matar = () => {
        try {
          process.kill(-hijo.pid, 'SIGKILL');
        } catch {
          try {
            hijo.kill('SIGKILL');
          } catch {}
        }
      };
      const t = setTimeout(() => {
        vencido = true;
        matar();
      }, timeoutMs);
      hijo.on('error', (e) => {
        clearTimeout(t);
        resolve({ codigo: -1, err: e.message });
      });
      hijo.on('close', (codigo) => {
        clearTimeout(t);
        matar();
        resolve({ codigo, vencido });
      });
    });
    if (r.vencido) throw new ErrorWeb(`la captura superó ${Math.round(timeoutMs / 1000)} s`);
    let datos;
    try {
      const fh = await open(salida, FS.O_RDONLY | FS.O_NOFOLLOW);
      try {
        datos = await fh.readFile();
      } finally {
        await fh.close();
      }
    } catch {
      throw new ErrorWeb(`Chrome no generó la captura${r.codigo ? ` (código ${r.codigo})` : ''}`);
    }
    if (datos.length < 8 || datos.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new ErrorWeb('la salida no es un PNG');
    if (datos.length > 20 * 1024 * 1024) throw new ErrorWeb('la captura supera 20 MB');
    const temporal = path.join(dir, `.${archivo}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temporal, datos, { flag: 'wx', mode: 0o600 });
    await rename(temporal, destino);
    return { archivo: path.posix.join('trabajo', 'capturas', archivo), absoluto: destino, bytes: datos.length, ancho: w, alto: h, ms: Date.now() - t0, url: `${url.pathname}${url.search}` };
  } finally {
    await proxy.cerrar().catch(() => {});
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

function cabeceraDe(jar) {
  return jar ? cabeceraCookie(jar) : '';
}
