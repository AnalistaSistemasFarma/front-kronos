#!/usr/bin/env node
/**
 * ¿Este PR necesita el job «SGC — integración (SQL Server efímero)»?
 *
 * Uso:  node scripts/ci/integracion-relevante.mjs <archivo-con-rutas-cambiadas>
 *       (una ruta por línea; en CI sale de la API de GitHub: archivos del PR).
 *
 * Imprime en stdout `relevante=true|false` (formato de $GITHUB_OUTPUT) y en
 * stderr el motivo. Responde «true» si cualquiera de las rutas cambiadas:
 *
 *   1. coincide con una ruta FIJA de la lista de abajo (SGC, Bitácora de
 *      Proceso, Prisma —incluye las migraciones del Portal TH que el job
 *      prueba—, configuración de pruebas, el propio workflow…), o
 *   2. pertenece al ÁRBOL DE IMPORTACIONES de las pruebas de integración:
 *      se parte de tests/integration/** y se siguen los import/require locales
 *      (relativos y con alias «@/»); también desde lib/sgc y lib/bitacora-proceso. Así, si mañana lib/sgc empieza a usar otra
 *      utilidad compartida, el filtro la incluye solo, sin mantener una lista.
 *
 * Criterio de seguridad: ante CUALQUIER duda (no hay lista de archivos, la
 * lista está vacía, error de lectura) responde «true» y la integración corre.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

// Rutas fijas (prefijos o archivos exactos). Si cambia algo aquí, corre la integración.
const RUTAS_FIJAS = [
  // SGC documental
  'lib/sgc/',
  'app/api/sgc/',
  'app/(hub)/process/sgc-documental/',
  'components/sgc/',
  'scripts/sgc/',
  'scripts/evidencia/',
  'tests/integration/',
  // Bitácora de Proceso (antes Órdenes de Trabajo): sus pruebas de integración
  // (tests/integration/bitacora-proceso) y su reversa viven en este mismo job.
  'lib/bitacora-proceso/',
  'app/api/bitacora-proceso/',
  // Módulo Correo: su integración (tests/integration/correo) y su reversa viven en este job.
  'lib/correo/',
  // «Consultar a un agente»: el SQL de kronos-mcp se prueba en el mismo job (mcp/test-integracion).
  'mcp/src/correo/',
  'mcp/src/tools/correoAgente.ts',
  'mcp/test-integracion/',
  // Base de datos: esquema, migraciones (SGC, Bitácora y Portal TH se prueban en el job) y SQL manual
  'prisma/',
  // Utilidades compartidas de las que depende el SGC (también las detecta el árbol de importaciones)
  'lib/prisma.ts',
  'lib/notifications.js',
  'lib/push.js',
  'lib/onedrive/',
  'lib/onedriveName.ts',
  'lib/sap/serviceLayer.ts',
  'components/microsoft-365/useGetMicrosoftToken.jsx',
  '.github/dbconfig.ci.stub.js',
  // Dependencias y configuración de las pruebas
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.integration.config.mts',
  'vitest.server-only-stub.ts',
  // El propio workflow y este script
  '.github/workflows/ci.yml',
  'scripts/ci/',
];

// Raíces del árbol de importaciones (ver punto 2 de la cabecera).
const RAICES = ['tests/integration', 'lib/sgc', 'lib/bitacora-proceso', 'lib/correo'];

const EXTENSIONES = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const PATRON_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

function salir(relevante, motivo) {
  console.error(`[integracion-relevante] ${relevante ? 'CORRE' : 'SE OMITE'}: ${motivo}`);
  console.log(`relevante=${relevante}`);
  process.exit(0);
}

function listarArchivos(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) out.push(...listarArchivos(rel));
    else if (EXTENSIONES.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

/** Candidatos de archivo para un import; el primero que exista es la resolución. */
function candidatos(desde, spec) {
  let base;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(desde), spec));
  else return null; // paquete de npm: lo cubre package.json / package-lock.json
  return [base, ...EXTENSIONES.map((x) => base + x), ...EXTENSIONES.map((x) => `${base}/index${x}`)];
}

/** Árbol de importaciones locales alcanzable desde las pruebas de integración. */
function arbolDeIntegracion() {
  const alcanzables = new Set(); // archivos existentes y también candidatos no resueltos (p. ej. borrados en el PR)
  const visitados = new Set();
  if (listarArchivos('tests/integration').length === 0) throw new Error('No se encontraron pruebas en tests/integration');
  // Raíces: las pruebas de integración y TODO el código de los módulos que prueban.
  const cola = RAICES.flatMap(listarArchivos);
  while (cola.length) {
    const archivo = cola.pop();
    if (visitados.has(archivo)) continue;
    visitados.add(archivo);
    alcanzables.add(archivo);
    let texto;
    try { texto = fs.readFileSync(path.join(ROOT, archivo), 'utf8'); } catch { continue; }
    for (const [, spec] of texto.matchAll(PATRON_IMPORT)) {
      const cands = candidatos(archivo, spec);
      if (!cands) continue;
      const existente = cands.find((c) => fs.existsSync(path.join(ROOT, c)) && fs.statSync(path.join(ROOT, c)).isFile());
      if (existente) cola.push(existente);
      else cands.forEach((c) => alcanzables.add(c));
    }
  }
  return alcanzables;
}

const archivoLista = process.argv[2];
if (!archivoLista || !fs.existsSync(archivoLista)) salir(true, 'no hay lista de archivos cambiados (push, workflow_dispatch o error): se corre todo');
const cambiados = fs.readFileSync(archivoLista, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
if (cambiados.length === 0) salir(true, 'la lista de archivos cambiados vino vacía: se corre todo por seguridad');

const porRutaFija = cambiados.filter((f) => RUTAS_FIJAS.some((r) => (r.endsWith('/') ? f.startsWith(r) : f === r)));
if (porRutaFija.length) salir(true, `ruta del SGC/BD/configuración: ${porRutaFija.slice(0, 10).join(', ')}`);

let arbol;
try { arbol = arbolDeIntegracion(); } catch (e) { salir(true, `no se pudo calcular el árbol de importaciones (${e.message})`); }
const porImportacion = cambiados.filter((f) => arbol.has(f));
if (porImportacion.length) salir(true, `lo importan las pruebas de integración: ${porImportacion.slice(0, 10).join(', ')}`);

salir(false, `${cambiados.length} archivo(s) cambiado(s), ninguno toca el SGC, la Bitácora de Proceso, Prisma ni lo que importan las pruebas de integración (${arbol.size} rutas en el árbol)`);
