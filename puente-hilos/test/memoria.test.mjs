import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buscarSecreto, copiarMemoria, prepararMemoriaTurno, recortarIndice, textoMemoria, turnoConMemoria, MAX_LINEAS_INDICE } from '../src/memoria.mjs';
import { guiaDesarrolloSegura, textoGuiaDesarrollo, MAX_BYTES_GUIA, RUTA_GUIA_DESARROLLO } from '../src/guia.mjs';
import { SETTINGS_HIJO } from '../src/claude.mjs';
import { cargarConfig } from '../src/config.mjs';

test('buscarSecreto detecta tokens, llaves y contraseñas con valor; no los nombres de variables', () => {
  for (const s of [
    'token ghp_' + 'a'.repeat(36),
    'github_pat_' + 'A1'.repeat(15),
    'llave sk-ant-api03-' + 'x'.repeat(20),
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'bot 123456789:AA' + 'b'.repeat(33),
    'SAP_PASSWORD=Clave2026Ryan',
    'contraseña: "Xy9fhT3kLm"',
    'Authorization: Bearer ' + 'abc123'.repeat(5),
    'AKIA' + 'ABCDEFGHIJKLMNOP',
  ]) {
    assert.ok(buscarSecreto(s), `debió detectar: ${s}`);
  }
  for (const s of [
    'el token está en `TELEGRAM_BOT_TOKEN` del .env (no se imprime)',
    'Token: variable `TELEGRAM_BOT_TOKEN` en el .env',
    '(`SAP_PASSWORD=`) — MCP de solo lectura',
    'password=.. en la cadena de Prisma',
    'NEXTAUTH_SECRET: necesita 16 caracteres o más',
    'la contraseña del manager se rotó',
  ]) {
    assert.equal(buscarSecreto(s), null, `falso positivo: ${s}`);
  }
});

test('turnoConMemoria: sin lista = todos; con lista, TODOS los autores del lote deben estar (identidad del servidor)', () => {
  const nico = { author: { kind: 'user', email: 'Nicolas.Rivera@gsslatam.com' } };
  const otro = { author: { kind: 'user', email: 'otro@gsslatam.com' } };
  const agente = { author: { kind: 'agent', email: 'nicolas.rivera@gsslatam.com' } };
  assert.equal(turnoConMemoria([otro], []), true);
  assert.equal(turnoConMemoria([otro], null), true);
  const lista = ['nicolas.rivera@gsslatam.com'];
  assert.equal(turnoConMemoria([nico], lista), true);
  assert.equal(turnoConMemoria([nico, otro], lista), false);
  assert.equal(turnoConMemoria([agente], lista), false);
  assert.equal(turnoConMemoria([], lista), false);
});

function memoriaDePrueba() {
  const raiz = mkdtempSync(path.join(tmpdir(), 'memoria-'));
  const origen = path.join(raiz, 'memory');
  mkdirSync(origen);
  writeFileSync(path.join(origen, 'MEMORY.md'), '- [Ramas](tema-ramas.md) — testing primero\n- [Secreto](con-secreto.md)\n');
  writeFileSync(path.join(origen, 'tema-ramas.md'), 'PR a testing con CI en verde.');
  writeFileSync(path.join(origen, 'con-secreto.md'), 'el token es ghp_' + 'z'.repeat(36));
  writeFileSync(path.join(origen, 'MEMORY.md.bak-20260930'), 'respaldo viejo');
  writeFileSync(path.join(raiz, 'fuera.md'), 'no debe copiarse');
  symlinkSync(path.join(raiz, 'fuera.md'), path.join(origen, 'enlace.md'));
  return { raiz, origen };
}

test('copiarMemoria: copia solo .md reales, excluye los que tienen secretos, no toca el origen y reemplaza la copia', () => {
  const { raiz, origen } = memoriaDePrueba();
  const antes = readdirSync(origen).sort();
  const destino = path.join(raiz, 'hilo', '.puente', 'memoria');
  mkdirSync(path.dirname(destino), { recursive: true });
  const r = copiarMemoria({ origen, destino });
  assert.deepEqual(r.archivos, ['MEMORY.md', 'tema-ramas.md']);
  assert.deepEqual(r.excluidos.map((x) => x.archivo), ['con-secreto.md']);
  assert.match(r.excluidos[0].motivo, /secreto/);
  assert.deepEqual(readdirSync(destino).sort(), ['MEMORY.md', 'tema-ramas.md']);
  assert.match(r.indice, /tema-ramas\.md/);
  assert.equal(statSync(path.join(destino, 'tema-ramas.md')).mode & 0o777, 0o400, 'copia de solo lectura');
  assert.deepEqual(readdirSync(origen).sort(), antes, 'el origen no cambia');
  // Un archivo que desaparece del origen desaparece de la copia en el siguiente turno.
  writeFileSync(path.join(origen, 'tema-ramas.md'), 'cambiado');
  const r2 = copiarMemoria({ origen, destino });
  assert.equal(readFileSync(path.join(destino, 'tema-ramas.md'), 'utf8'), 'cambiado');
  assert.equal(r2.archivos.length, 2);
  assert.throws(() => copiarMemoria({ origen: 'relativa', destino }), /absoluta/);
});

test('textoMemoria: índice, solo lectura, bloque para el bot principal y recorte del índice', () => {
  const t = textoMemoria({ agente: 'Orus', indice: '- [Ramas](tema-ramas.md)', archivos: ['MEMORY.md', 'tema-ramas.md'], excluidos: [{ archivo: 'x.md', motivo: 's' }] });
  assert.match(t, /SOLO LECTURA/);
  assert.match(t, /\.\/\.puente\/memoria\//);
  assert.match(t, /🧠 Para la memoria de Orus/);
  assert.match(t, /\[Ramas\]\(tema-ramas\.md\)/);
  assert.match(t, /1 archivo\(s\) de memoria no se copiaron/);
  assert.doesNotMatch(t, /x\.md/, 'no nombra los excluidos');
  const largo = Array.from({ length: MAX_LINEAS_INDICE + 50 }, (_, i) => `- línea ${i}`).join('\n');
  const rec = recortarIndice(largo);
  assert.ok(rec.split('\n').length < MAX_LINEAS_INDICE + 5);
  assert.match(rec, /ábralo completo/);
});

test('prepararMemoriaTurno: sin HILOS_MEMORIA_DIR no hace nada; autor fuera de la lista va sin memoria y se borra la copia; si falla, va sin memoria', () => {
  const { raiz, origen } = memoriaDePrueba();
  const rutas = { puente: path.join(raiz, 'c1', '.puente') };
  mkdirSync(rutas.puente, { recursive: true });
  const nico = [{ author: { kind: 'user', email: 'nicolas.rivera@gsslatam.com' } }];
  const otro = [{ author: { kind: 'user', email: 'otro@x.com' } }];
  assert.deepEqual(prepararMemoriaTurno({ cfg: {}, rutas, lote: nico, agenteNombre: 'Orus' }), { bloque: '', motivo: null });
  const cfg = { memoriaDir: origen, memoriaLectores: ['nicolas.rivera@gsslatam.com'] };
  const ok = prepararMemoriaTurno({ cfg, rutas, lote: nico, agenteNombre: 'Orus' });
  assert.equal(ok.motivo, null);
  assert.match(ok.bloque, /Su memoria/);
  assert.ok(existsSync(path.join(rutas.puente, 'memoria', 'tema-ramas.md')));
  const no = prepararMemoriaTurno({ cfg, rutas, lote: otro, agenteNombre: 'Orus' });
  assert.match(no.motivo, /lectores/);
  assert.match(no.bloque, /NO tiene su memoria/);
  assert.ok(!existsSync(path.join(rutas.puente, 'memoria')), 'la copia se borra para ese turno');
  const falla = prepararMemoriaTurno({ cfg: { memoriaDir: path.join(raiz, 'no-existe'), memoriaLectores: [] }, rutas, lote: otro, agenteNombre: 'Orus' });
  assert.equal(falla.bloque, '');
  assert.match(falla.motivo, /no se pudo/);
});

test('el hijo no usa la memoria automática nativa', () => {
  assert.equal(SETTINGS_HIJO.autoMemoryEnabled, false);
});

test('config: HILOS_MEMORIA_DIR absoluta y fuera de HILOS_DIR; lectores como correos', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cfg-mem-'));
  const hilos = path.join(dir, 'play-pruebas');
  mkdirSync(hilos);
  const perfiles = path.join(dir, 'perfiles.json');
  writeFileSync(perfiles, '{}');
  const base = {
    HILOS_ENTORNO: 'pruebas', HILOS_SYNERLINK_URL: 'http://192.168.11.230:3030', HILOS_SYNERLINK_KEY: 'k'.repeat(40), HILOS_AGENTE: 'play',
    HILOS_ANTHROPIC_API_KEY: 'x', HILOS_DIR: hilos, HILOS_PERFILES: perfiles, PATH: '/usr/bin', HOME: dir,
  };
  const c = cargarConfig({ ...base, HILOS_MEMORIA_DIR: path.join(dir, 'memory'), HILOS_MEMORIA_LECTORES: 'Nicolas.Rivera@gsslatam.com, cristian.baldion@gsslatam.com' });
  assert.equal(c.memoriaDir, path.join(dir, 'memory'));
  assert.deepEqual(c.memoriaLectores, ['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com']);
  assert.equal(cargarConfig(base).memoriaDir, null);
  assert.throws(() => cargarConfig({ ...base, HILOS_MEMORIA_DIR: 'memory' }), /absoluta/);
  assert.throws(() => cargarConfig({ ...base, HILOS_MEMORIA_DIR: path.join(hilos, 'mem') }), /dentro de HILOS_DIR/);
  assert.throws(() => cargarConfig({ ...base, HILOS_MEMORIA_DIR: path.join(dir, 'm'), HILOS_MEMORIA_LECTORES: 'no-es-correo' }), /correos/);
});

test('resumen del flujo de pases: versionado, corto, sin secretos y con las reglas clave', () => {
  const t = textoGuiaDesarrollo();
  assert.ok(Buffer.byteLength(readFileSync(RUTA_GUIA_DESARROLLO, 'utf8')) <= MAX_BYTES_GUIA);
  assert.doesNotMatch(t, /^# /m, 'el H1 del archivo se quita');
  for (const r of [/--delete-branch/, /release\/pendiente-prod/, /cherry-pick -x -m 1/, /🧪 TESTING/, /🚀 PROD/, /COPY_ONLY/, /RDP 3/, /Service Layer/, /Nicolás Rivera y Cristian Baldión/]) assert.match(t, r);
  assert.equal(buscarSecreto(t), null);
  assert.equal(guiaDesarrolloSegura(() => { throw new Error('x'); }).bloque, '');
  assert.throws(() => textoGuiaDesarrollo({ leer: () => '  ' }), /vacía/);
  assert.throws(() => textoGuiaDesarrollo({ leer: () => 'a'.repeat(MAX_BYTES_GUIA + 1) }), /pasa de/);
});
