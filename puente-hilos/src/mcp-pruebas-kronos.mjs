#!/usr/bin/env node
/**
 * Servidor MCP (stdio) de PRUEBAS para TODOS los hilos de proyecto (orden de
 * Nicolás Rivera, 2026-10-22 10:09 COT). Un mismo archivo, dos conectores:
 *
 *   --modo sql  → «kronos-pruebas-sql»: lectura y escritura SOLO en KRONOSDB_PRUEBAS
 *                 (pruebas_sql_consultar, pruebas_sql_ejecutar, pruebas_sql_correr_script).
 *   --modo web  → «synerlink-testing-web»: testing como usuario QA
 *                 (testing_http, testing_captura).
 *
 * Lo lanza Claude Code (el proceso del turno), NO el sandbox de los comandos:
 * así puede leer el archivo de secretos, que el sandbox niega. Las credenciales
 * (SQL de pruebas y clave del QA) salen de HILOS_CONECTORES_SECRETOS, clave
 * «kronos-pruebas» (archivo 600 fuera de la carpeta del hilo); nunca pasan por
 * el mcp.json, los argumentos, el entorno ni las respuestas.
 *
 * Toda llamada queda en un registro de auditoría local (JSONL 600): fecha,
 * conversación, autores del turno, herramienta, motivo, SQL (recortado),
 * huella y resultado.
 *
 * Uso: node mcp-pruebas-kronos.mjs --modo sql|web --secretos <archivo> --hilo <carpeta del hilo>
 *        --auditoria <archivo.jsonl> [--sesion <archivo 600>] [--conversacion <id>]
 *        [--autores a@x,b@y] [--chrome <ruta>] [--base http://192.168.11.230:3030]
 */
import { appendFileSync, constants as FS, readFileSync, statSync } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { ErrorGuarda, FILAS_DEFECTO, MAX_FILAS, huella, partirPorGo, validarMotivo, validarRutaScript, validarSql } from './pruebas-sql.mjs';
import { basesDelServidor, consultar, ejecutarLotes, mensajeError } from './pruebas-sql-servidor.mjs';
import { BASE_TESTING_DEFECTO, capturar, crearClienteTesting, ErrorWeb, limpiar } from './pruebas-web.mjs';

export const LLAVE_SECRETOS = 'kronos-pruebas';
export const NOMBRE_SQL = 'kronos-pruebas-sql';
export const NOMBRE_WEB = 'synerlink-testing-web';
const MAX_SALIDA = 60_000;
const MAX_SCRIPT = 2 * 1024 * 1024;

export const HERRAMIENTAS_SQL = [
  {
    name: 'pruebas_sql_consultar',
    description:
      'Consulta (solo SELECT) la base de PRUEBAS de SynerLink, KRONOSDB_PRUEBAS. Nunca toca producción. Devuelve las filas en JSON con un tope (por defecto 200, máximo 2000). Tiempo máximo: 60 s. Use filtros y TOP para no traer tablas enteras.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Consulta SELECT (o WITH … SELECT) sobre KRONOSDB_PRUEBAS. Sin USE ni nombres de otras bases.' },
        limite_filas: { type: 'integer', minimum: 1, maximum: MAX_FILAS, description: `Máximo de filas a devolver (por defecto ${FILAS_DEFECTO}).` },
      },
      required: ['sql'],
      additionalProperties: false,
    },
  },
  {
    name: 'pruebas_sql_ejecutar',
    description:
      'Ejecuta DML o DDL (INSERT, UPDATE, DELETE, CREATE/ALTER TABLE, índices, vistas, procedimientos…) en la base de PRUEBAS KRONOSDB_PRUEBAS. Exige un motivo, que queda en el registro de auditoría. Admite varios lotes separados por líneas GO. Prohibido: USE, otras bases, KRONOSDB (producción), DROP DATABASE, BACKUP, RESTORE, xp_cmdshell, sp_configure, logins, usuarios y permisos. Tiempo máximo: 120 s por lote.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL a ejecutar en KRONOSDB_PRUEBAS (puede llevar lotes separados por GO).' },
        motivo: { type: 'string', description: 'Para qué es este cambio en PRUEBAS (mínimo 10 caracteres). Queda en la auditoría.' },
      },
      required: ['sql', 'motivo'],
      additionalProperties: false,
    },
  },
  {
    name: 'pruebas_sql_correr_script',
    description:
      'Corre en KRONOSDB_PRUEBAS un archivo .sql del hilo, partido por GO: solo codigo/<repo>/prisma/manual/*-PRUEBAS.sql o trabajo/*.sql. Revisa TODOS los lotes con las guardas antes de correr el primero y se detiene en el primer error. Exige un motivo (auditoría). Devuelve los mensajes PRINT y las filas afectadas de cada lote.',
    inputSchema: {
      type: 'object',
      properties: {
        ruta: { type: 'string', description: 'Ruta relativa a la carpeta del hilo, por ejemplo codigo/front-kronos/prisma/manual/2026-10-22-algo-PRUEBAS.sql o trabajo/ajuste.sql.' },
        motivo: { type: 'string', description: 'Para qué se corre este script en PRUEBAS (mínimo 10 caracteres).' },
      },
      required: ['ruta', 'motivo'],
      additionalProperties: false,
    },
  },
];

export const HERRAMIENTAS_WEB = [
  {
    name: 'testing_http',
    description:
      'Hace una petición GET o POST a la web de TESTING de SynerLink (servidor de pruebas 192.168.11.230:3030) con la sesión del usuario QA de pruebas (qa.sgc@gsslatam.com). El conector inicia la sesión solo; usted nunca ve ni necesita la clave. Devuelve el estado HTTP, el tipo, la redirección y el cuerpo recortado. Nunca va a producción.',
    inputSchema: {
      type: 'object',
      properties: {
        metodo: { type: 'string', enum: ['GET', 'POST'], description: 'GET (por defecto) o POST.' },
        ruta: { type: 'string', description: 'Ruta relativa que empieza por «/», por ejemplo /api/companies o /process.' },
        json: { description: 'Cuerpo JSON para un POST (opcional).' },
        form: { type: 'object', description: 'Cuerpo de formulario { campo: valor } para un POST (opcional).' },
        sin_sesion: { type: 'boolean', description: 'true para pedir la ruta como visitante sin sesión.' },
      },
      required: ['ruta'],
      additionalProperties: false,
    },
  },
  {
    name: 'testing_captura',
    description:
      'Toma una captura de pantalla (PNG) de una ruta de la web de TESTING de SynerLink, como el usuario QA de pruebas, con Chrome sin ventana. La guarda en ./trabajo/capturas/<nombre>.png: mírela con Read y, si la quiere entregar, escriba en su respuesta final la línea MEDIA:trabajo/capturas/<nombre>.png. Tiempo máximo: 60 s.',
    inputSchema: {
      type: 'object',
      properties: {
        ruta: { type: 'string', description: 'Ruta relativa que empieza por «/», por ejemplo /login o /process.' },
        nombre: { type: 'string', description: 'Nombre del archivo (sin extensión). Opcional.' },
        ancho: { type: 'integer', minimum: 320, maximum: 2560, description: 'Ancho de la ventana en píxeles (por defecto 1440; 390 para celular).' },
        alto: { type: 'integer', minimum: 320, maximum: 4000, description: 'Alto de la ventana en píxeles (por defecto 900).' },
        espera_ms: { type: 'integer', minimum: 1000, maximum: 20000, description: 'Tiempo para que la página cargue sus datos (por defecto 8000).' },
        sin_sesion: { type: 'boolean', description: 'true para capturar como visitante sin sesión (por ejemplo la pantalla de login).' },
      },
      required: ['ruta'],
      additionalProperties: false,
    },
  },
];

export function leerArgumentos(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    o[a.slice(2)] = argv[i + 1] ?? '';
    i += 1;
  }
  if (!['sql', 'web'].includes(o.modo)) throw new Error('--modo debe ser sql o web');
  for (const k of ['secretos', 'hilo', 'auditoria']) if (!o[k] || !path.isAbsolute(o[k])) throw new Error(`falta --${k} (ruta absoluta)`);
  return o;
}

/** Lee la clave «kronos-pruebas» del archivo de secretos (600). Nunca devuelve el archivo entero. */
export function leerSecretos(ruta, { leer = (r) => readFileSync(r, 'utf8'), modo = (r) => statSync(r).mode & 0o777 } = {}) {
  if (modo(ruta) !== 0o600) throw new Error('el archivo de secretos debe tener permisos 600');
  const j = JSON.parse(leer(ruta));
  const s = j?.[LLAVE_SECRETOS];
  if (!s || typeof s !== 'object') throw new Error(`el archivo de secretos no trae «${LLAVE_SECRETOS}»`);
  return s;
}

function recortar(texto) {
  return texto.length > MAX_SALIDA ? `${texto.slice(0, MAX_SALIDA)}\n… (salida recortada: ${texto.length} caracteres)` : texto;
}

/**
 * Crea el despachador de herramientas. Inyectable para las pruebas: driver
 * (mssql), cliente web, captura, lectura de archivos y auditoría.
 */
export function crearServidor({ modo, args, secretos, driver = null, cliente = null, capturarImpl = capturar, auditar = null, basesImpl = basesDelServidor }) {
  const audit =
    auditar ??
    ((fila) => {
      try {
        appendFileSync(args.auditoria, `${JSON.stringify({ ts: new Date().toISOString(), conversacion: args.conversacion ?? null, autores: args.autores ?? null, ...fila })}\n`, { mode: 0o600 });
      } catch {}
    });
  let bases = null;
  const listaBases = async () => {
    if (bases === null) bases = (await basesImpl({ driver, sec: secretos.sql })) ?? undefined;
    return bases;
  };
  let web = cliente;
  const clienteWeb = () => {
    if (!web) web = crearClienteTesting({ base: args.base || secretos.web?.base || BASE_TESTING_DEFECTO, qa: secretos.qa, rutaSesion: args.sesion || null });
    return web;
  };
  const limpiarSalida = (t) => limpiar(t, [secretos?.sql?.password, secretos?.qa?.password, ...(web ? web.secretos() : [])]);

  async function leerScript(rel) {
    const raiz = await realpath(args.hilo);
    const abs = path.join(raiz, rel);
    let real;
    try {
      real = await realpath(abs);
    } catch {
      throw new ErrorGuarda(`no existe ${rel}`);
    }
    if (real !== abs) throw new ErrorGuarda('el script no puede ser un enlace simbólico ni salir de la carpeta del hilo');
    const fh = await open(real, FS.O_RDONLY | FS.O_NOFOLLOW);
    try {
      const st = await fh.stat();
      if (!st.isFile()) throw new ErrorGuarda('no es un archivo');
      if (st.size === 0 || st.size > MAX_SCRIPT) throw new ErrorGuarda('el script está vacío o supera 2 MB');
      return (await fh.readFile('utf8')).replace(/^﻿/, '');
    } finally {
      await fh.close();
    }
  }

  async function llamar(nombre, entrada = {}) {
    const t0 = Date.now();
    const fila = { herramienta: nombre };
    try {
      let salida;
      if (modo === 'sql' && nombre === 'pruebas_sql_consultar') {
        const sql = String(entrada.sql ?? '');
        Object.assign(fila, { sql: sql.slice(0, 4000), huella: huella(sql) });
        validarSql(sql, 'consultar', { bases: await listaBases() });
        const r = await consultar({ driver, sec: secretos.sql, sql, limite: entrada.limite_filas ?? FILAS_DEFECTO });
        fila.filas = r.filas;
        salida = { base: 'KRONOSDB_PRUEBAS', filas: r.filas, truncado: r.truncado ? `sí: se devolvieron las primeras ${r.tope}` : 'no', ms: r.ms, conjuntos: r.conjuntos };
      } else if (modo === 'sql' && (nombre === 'pruebas_sql_ejecutar' || nombre === 'pruebas_sql_correr_script')) {
        const motivo = validarMotivo(entrada.motivo);
        fila.motivo = motivo;
        let sql;
        if (nombre === 'pruebas_sql_correr_script') {
          const rel = validarRutaScript(entrada.ruta);
          fila.ruta = rel;
          sql = await leerScript(rel);
        } else sql = String(entrada.sql ?? '');
        Object.assign(fila, { sql: sql.slice(0, 4000), huella: huella(sql) });
        const lotes = partirPorGo(sql);
        if (lotes.length === 0) throw new ErrorGuarda('el SQL está vacío');
        if (lotes.length > 500) throw new ErrorGuarda('más de 500 lotes: parta el script');
        const b = await listaBases();
        // TODOS los lotes pasan las guardas antes de correr el primero.
        lotes.forEach((l, i) => {
          try {
            validarSql(l, 'ejecutar', { bases: b });
          } catch (e) {
            throw new ErrorGuarda(`lote ${i + 1}: ${e.message}`);
          }
        });
        const r = await ejecutarLotes({ driver, sec: secretos.sql, lotes });
        fila.lotes = lotes.length;
        fila.lotesOk = r.resultados.filter((x) => x.ok).length;
        fila.filasAfectadas = r.resultados.flatMap((x) => x.filasAfectadas ?? []).reduce((a, n) => a + (Number(n) || 0), 0);
        if (!r.ok) fila.error = r.resultados.find((x) => !x.ok)?.error ?? 'error';
        salida = { base: 'KRONOSDB_PRUEBAS', ok: r.ok, lotes: lotes.length, ms: r.ms, resultados: r.resultados };
        fila.ok = r.ok;
        audit({ ...fila, ms: Date.now() - t0 });
        return { isError: !r.ok, texto: recortar(limpiarSalida(JSON.stringify(salida, null, 1))) };
      } else if (modo === 'web' && nombre === 'testing_http') {
        Object.assign(fila, { metodo: entrada.metodo ?? 'GET', ruta: String(entrada.ruta ?? '').slice(0, 500) });
        const r = await clienteWeb().http({ metodo: entrada.metodo ?? 'GET', ruta: entrada.ruta, json: entrada.json, form: entrada.form, sinSesion: entrada.sin_sesion === true });
        fila.estado = r.estado;
        salida = { servidor: 'testing (PRUEBAS)', usuario: entrada.sin_sesion ? '(sin sesión)' : clienteWeb() && 'QA de pruebas', ...r };
      } else if (modo === 'web' && nombre === 'testing_captura') {
        Object.assign(fila, { ruta: String(entrada.ruta ?? '').slice(0, 500) });
        const r = await capturarImpl({ cliente: clienteWeb(), chrome: args.chrome || null, trabajo: path.join(args.hilo, 'trabajo'), ruta: entrada.ruta, nombre: entrada.nombre, ancho: entrada.ancho, alto: entrada.alto, esperaMs: entrada.espera_ms, sinSesion: entrada.sin_sesion === true });
        fila.archivo = r.archivo;
        salida = {
          archivo: r.archivo,
          bytes: r.bytes,
          tamano: `${r.ancho}x${r.alto}`,
          ruta: r.url,
          ms: r.ms,
          siguiente: `Mírela con Read (${r.archivo}). Para entregarla, escriba en su respuesta final la línea MEDIA:${r.archivo}`,
        };
      } else {
        throw new ErrorGuarda(`herramienta desconocida: ${nombre}`);
      }
      fila.ok = true;
      audit({ ...fila, ms: Date.now() - t0 });
      return { isError: false, texto: recortar(limpiarSalida(JSON.stringify(salida, null, 1))) };
    } catch (e) {
      const guarda = e instanceof ErrorGuarda || e?.guarda;
      const msj = guarda || e instanceof ErrorWeb ? e.message : mensajeError(e);
      audit({ ...fila, ok: false, rechazado: Boolean(guarda), error: limpiarSalida(msj).slice(0, 1000), ms: Date.now() - t0 });
      return { isError: true, texto: limpiarSalida(guarda ? `RECHAZADO por la guarda del conector: ${msj}.` : `Error: ${msj}`) };
    }
  }

  return { herramientas: modo === 'sql' ? HERRAMIENTAS_SQL : HERRAMIENTAS_WEB, llamar };
}

/** Bucle JSON-RPC por stdio (una línea = un mensaje). */
export function servirStdio({ servidor, nombre, entrada = process.stdin, salida = process.stdout }) {
  const enviar = (m) => salida.write(`${JSON.stringify(m)}\n`);
  const rl = createInterface({ input: entrada });
  const instrucciones =
    nombre === NOMBRE_SQL
      ? 'Base de PRUEBAS de SynerLink (KRONOSDB_PRUEBAS) en lectura y escritura. Nunca producción. Las escrituras exigen motivo y quedan auditadas.'
      : 'Web de TESTING de SynerLink como usuario QA de pruebas. Nunca producción. Las capturas quedan en ./trabajo/capturas.';
  rl.on('line', async (linea) => {
    let m;
    try {
      m = JSON.parse(linea);
    } catch {
      return;
    }
    const { id, method, params } = m ?? {};
    if (id === undefined || id === null) return; // notificaciones
    try {
      if (method === 'initialize') {
        enviar({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: nombre, version: '1.0.0' }, instructions: instrucciones } });
      } else if (method === 'ping') {
        enviar({ jsonrpc: '2.0', id, result: {} });
      } else if (method === 'tools/list') {
        enviar({ jsonrpc: '2.0', id, result: { tools: servidor.herramientas } });
      } else if (method === 'tools/call') {
        const r = await servidor.llamar(params?.name, params?.arguments ?? {});
        enviar({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.texto }], isError: r.isError } });
      } else if (method === 'resources/list' || method === 'prompts/list') {
        enviar({ jsonrpc: '2.0', id, result: method === 'resources/list' ? { resources: [] } : { prompts: [] } });
      } else {
        enviar({ jsonrpc: '2.0', id, error: { code: -32601, message: `método no soportado: ${method}` } });
      }
    } catch (e) {
      enviar({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e?.message ?? e).slice(0, 500) } });
    }
  });
  return rl;
}

async function principal() {
  const args = leerArgumentos(process.argv.slice(2));
  const secretos = leerSecretos(args.secretos);
  let driver = null;
  if (args.modo === 'sql') driver = (await import('mssql')).default;
  const servidor = crearServidor({ modo: args.modo, args, secretos, driver });
  servirStdio({ servidor, nombre: args.modo === 'sql' ? NOMBRE_SQL : NOMBRE_WEB });
}

function esPuntoDeEntrada() {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
  } catch {
    return false;
  }
}

if (esPuntoDeEntrada()) {
  principal().catch((e) => {
    process.stderr.write(`mcp-pruebas-kronos: ${e?.message ?? e}\n`);
    process.exit(1);
  });
}
