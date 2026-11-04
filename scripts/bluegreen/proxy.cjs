// Proxy azul/verde de front-kronos (PRUEBAS en la .230 y PRODUCCION en serfarma05).
//
// Escucha fijo en el puerto publico del entorno y reenvia cada peticion al
// color activo:
//   - PRUEBAS: :3030 (tunel cf-kronos-test y sitio IIS rp-kronos-test) ->
//     GSS-Front-TEST-A / -B.
//   - PRODUCCION: :3003 (sitio IIS groupsharedservices :8445 por ARR, agentes
//     que publican directo a http://192.168.10.5:3003, uptime-kuma) ->
//     GSS-Front-A / -B.
// El color activo se lee de <estado>/active.json, que escribe
// scripts/bluegreen/switch.ps1. Cambiar ese archivo cambia el destino en menos
// de 0,5 s sin cortar las conexiones que ya estan en curso (las peticiones
// viejas terminan contra el color anterior).
//
// Sin dependencias: solo modulos de Node. No toca Host, cookies, cf-* ni una
// X-Forwarded-For que ya venga (la de IIS/ARR llega con el puerto pegado y la
// app ya la sabe leer). Unico agregado: si la peticion llega SIN
// X-Forwarded-For (un agente que llama directo al puerto), se pone la
// direccion del socket, que es lo que Next veia antes como cliente; asi la
// auditoria de IP no pasa a ver 127.0.0.1 (--no-add-xff lo desactiva).
// Soporta streaming (SSE) y WebSocket (upgrade).
//
// Uso (pm2): node proxy.cjs --listen 3003 --state C:\...\front-kronos-bluegreen --label produccion
'use strict';

const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const LISTEN_PORT = Number(arg('listen', process.env.BLUEGREEN_LISTEN_PORT || '3030'));
const STATE_DIR = arg('state', process.env.BLUEGREEN_STATE_DIR || __dirname);
const ACTIVE_FILE = path.join(STATE_DIR, 'active.json');
const LABEL = arg('label', process.env.BLUEGREEN_LABEL || 'pruebas');
const ADD_XFF = !process.argv.includes('--no-add-xff');
const UPSTREAM_HOST = '127.0.0.1';
const POLL_MS = 400;

let active = null; // { color, port, sha, since }

function readActive() {
  try {
    const raw = fs.readFileSync(ACTIVE_FILE, 'utf8').replace(/^\uFEFF/, '');
    const next = JSON.parse(raw);
    const port = Number(next.port);
    if (!Number.isInteger(port) || port <= 0) throw new Error(`puerto invalido: ${next.port}`);
    if (!active || active.port !== port || active.color !== next.color) {
      console.log(`[bluegreen-proxy] destino -> ${next.color} :${port} (${next.sha || 'sin sha'})`);
    }
    active = { ...next, port };
  } catch (err) {
    // Archivo a medio escribir o ausente: se conserva el ultimo destino bueno.
    if (!active) console.error(`[bluegreen-proxy] no pude leer ${ACTIVE_FILE}: ${err.message}`);
  }
}

readActive();
setInterval(readActive, POLL_MS).unref();

const agent = new http.Agent({ keepAlive: true, maxSockets: 256, keepAliveMsecs: 10_000 });

function isLocalHealth(req) {
  // /__bluegreen solo responde a llamadas locales directas (el workflow). Lo que
  // llega por el tunel o por IIS trae X-Forwarded-For / cf-connecting-ip y pasa a la app.
  const ra = req.socket.remoteAddress || '';
  const local = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
  return (
    local &&
    req.url === '/__bluegreen' &&
    !req.headers['x-forwarded-for'] &&
    !req.headers['cf-connecting-ip']
  );
}

function withClientAddress(req) {
  // Solo si no viene ninguna: no se reescribe lo que manda IIS/ARR ni el tunel.
  if (!ADD_XFF || req.headers['x-forwarded-for']) return req.headers;
  const ra = req.socket.remoteAddress;
  if (!ra) return req.headers;
  return { ...req.headers, 'x-forwarded-for': ra };
}

function forward(req, res, attempt) {
  if (!active) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '5' });
    res.end(`SynerLink (${LABEL}): sin destino activo`);
    return;
  }
  const port = active.port;
  const upstream = http.request(
    {
      host: UPSTREAM_HOST,
      port,
      method: req.method,
      path: req.url,
      headers: withClientAddress(req),
      agent,
    },
    (up) => {
      // rawHeaders conserva cabeceras repetidas (varias Set-Cookie) y su orden.
      res.writeHead(up.statusCode || 502, up.statusMessage, up.rawHeaders);
      up.pipe(res);
      up.on('error', () => res.destroy());
    },
  );
  upstream.on('error', (err) => {
    // Conexion rechazada antes de enviar nada (el destino se esta cambiando o
    // reiniciando): un reintento corto si la peticion no tiene cuerpo.
    const sinCuerpo = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    if (!res.headersSent && err.code === 'ECONNREFUSED' && sinCuerpo && attempt < 3) {
      setTimeout(() => {
        readActive();
        forward(req, res, attempt + 1);
      }, 300);
      return;
    }
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`SynerLink (${LABEL}): la aplicacion no responde`);
    } else {
      res.destroy();
    }
    console.error(`[bluegreen-proxy] ${req.method} ${req.url} -> :${port} ${err.code || err.message}`);
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  if (isLocalHealth(req)) {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, listen: LISTEN_PORT, active }));
    return;
  }
  forward(req, res, 0);
});

// WebSocket / upgrade: tuberia TCP cruda hacia el destino activo.
server.on('upgrade', (req, socket, head) => {
  if (!active) return socket.destroy();
  const up = net.connect(active.port, UPSTREAM_HOST, () => {
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    if (ADD_XFF && !req.headers['x-forwarded-for'] && req.socket.remoteAddress) {
      raw += `X-Forwarded-For: ${req.socket.remoteAddress}\r\n`;
    }
    up.write(raw + '\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

// Sin limites de tiempo propios: SSE y descargas largas los maneja la app.
server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 65_000;
server.timeout = 0;

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(LISTEN_PORT, () => {
  console.log(`[bluegreen-proxy] (${LABEL}) escuchando en :${LISTEN_PORT}; estado en ${ACTIVE_FILE}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
