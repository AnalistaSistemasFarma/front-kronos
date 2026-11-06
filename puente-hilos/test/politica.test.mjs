import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  carpetasLectura,
  jsonParaCodigo,
  leerArchivoManual,
  obtenerPoliticaApi,
  politicaDeArchivo,
  prohibidasLectura,
  resolverPolitica,
  textoPolitica,
  validarPoliticaApi,
} from '../src/politica.mjs';
import { armarArgumentos } from '../src/claude.mjs';
import { politicaDelTurno } from '../src/puente.mjs';
import { escribirContexto, rutasDelHilo, asegurarCarpetas } from '../src/hilos.mjs';

/*
 * Permisos de los agentes (2026-10-20): el puente lee la política de SynerLink al
 * iniciar cada turno. La base manda (incluso «ninguno»); sin política, el archivo
 * manual; ante cualquier duda, «ninguno».
 */

const SAPSEND_API = { slug: 'sapsend', name: 'SAPSEND', github: 'gsslatam/sapsend', branchTesting: 'testing', branchProduction: 'production' };
const dto = (extra = {}) => ({
  idProject: 1,
  source: 'bd',
  codeLevel: 'desarrollo_pases',
  level: 3,
  deploys: true,
  repos: [SAPSEND_API],
  deployApprovers: ['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com'],
  connectors: [],
  updatedAt: '2026-10-20T18:30:00.000Z',
  ...extra,
});

// El archivo manual tal como lo dejó el acceso al código del 2026-10-20 (sin la nota).
const ARCHIVO = {
  operadoresPases: ['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com'],
  repos: {
    sapsend: {
      github: 'gsslatam/sapsend',
      clon: '/Users/x/.puente-hilos/horus-prod/repos/sapsend',
      ramaPruebas: 'testing',
      ramaProduccion: 'production',
      workflowsProduccion: ['deploy-olp.yml'],
      despliegue: 'Producción por empresa.',
    },
  },
  proyectos: { 1: { repos: ['sapsend'], nivel: 2, pases: true } },
};

test('validarPoliticaApi: acepta la de la base y la normaliza', () => {
  const p = validarPoliticaApi(dto(), 1);
  assert.equal(p.origen, 'bd');
  assert.equal(p.nivel, 3);
  assert.equal(p.pases, true);
  assert.deepEqual(p.repos, [{ slug: 'sapsend', github: 'gsslatam/sapsend', ramaPruebas: 'testing', ramaProduccion: 'production' }]);
  assert.deepEqual(p.autorizadores, ['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com']);
});

test('validarPoliticaApi: sin política devuelve null; lo raro lanza (el turno cae a «ninguno»)', () => {
  assert.equal(validarPoliticaApi({ idProject: 1, source: 'sin-politica', codeLevel: 'ninguno', level: 0, repos: [] }, 1), null);
  assert.throws(() => validarPoliticaApi(dto({ idProject: 2 }), 1), /otro proyecto/);
  assert.throws(() => validarPoliticaApi(dto({ codeLevel: 'root', level: 9 }), 1), /nivel desconocido/);
  assert.throws(() => validarPoliticaApi(dto({ level: 1 }), 1), /inconsistente/);
  assert.throws(() => validarPoliticaApi(dto({ repos: [] }), 1), /sin repositorios/);
  assert.throws(() => validarPoliticaApi(dto({ repos: [{ ...SAPSEND_API, slug: '../etc' }] }), 1), /repositorio inválido/);
  assert.throws(() => validarPoliticaApi(dto({ deployApprovers: [] }), 1), /sin autorizadores/);
  assert.throws(() => validarPoliticaApi(dto({ source: 'otro' }), 1), /origen/);
});

test('obtenerPoliticaApi: 404 = SynerLink sin el API; otro error = «error»', async () => {
  const con = (fn) => ({ politica: fn });
  assert.equal((await obtenerPoliticaApi({}, 5, 1)).estado, 'no-disponible');
  assert.equal((await obtenerPoliticaApi(con(async () => { throw Object.assign(new Error('x'), { status: 404 }); }), 5, 1)).estado, 'no-disponible');
  assert.equal((await obtenerPoliticaApi(con(async () => { throw Object.assign(new Error('caído'), { status: 500 }); }), 5, 1)).estado, 'error');
  assert.equal((await obtenerPoliticaApi(con(async () => ({ policy: { source: 'sin-politica' } })), 5, 1)).estado, 'sin-politica');
  assert.equal((await obtenerPoliticaApi(con(async () => ({ policy: dto() })), 5, 1)).estado, 'bd');
  assert.equal((await obtenerPoliticaApi(con(async () => ({ policy: dto({ level: 0 }) })), 5, 1)).estado, 'error');
});

test('resolverPolitica: la base MANDA, incluso «ninguno» (revoca lo del archivo)', () => {
  const ninguno = validarPoliticaApi(dto({ codeLevel: 'ninguno', level: 0, repos: [], deployApprovers: [] }), 1);
  const p = resolverPolitica({ api: { estado: 'bd', politica: ninguno }, archivo: ARCHIVO, idProject: 1 });
  assert.equal(p.nivel, 0);
  assert.equal(p.origen, 'bd');
});

test('resolverPolitica: sin política en la base o sin API, el archivo manual (compatibilidad)', () => {
  for (const estado of ['sin-politica', 'no-disponible']) {
    const p = resolverPolitica({ api: { estado }, archivo: ARCHIVO, idProject: 1 });
    assert.equal(p.origen, 'archivo');
    assert.equal(p.nivel, 3);
    assert.equal(p.pases, true);
  }
  // Otro proyecto, o sin archivo: «ninguno».
  assert.equal(resolverPolitica({ api: { estado: 'sin-politica' }, archivo: ARCHIVO, idProject: 9 }).nivel, 0);
  assert.equal(resolverPolitica({ api: { estado: 'no-disponible' }, archivo: null, idProject: 1 }).nivel, 0);
});

test('resolverPolitica: error del API o archivo inválido = «ninguno» con nota', () => {
  const a = resolverPolitica({ api: { estado: 'error' }, archivo: ARCHIVO, idProject: 1 });
  assert.equal(a.nivel, 0);
  assert.match(a.nota, /No pude leer los permisos/);
  const b = resolverPolitica({ api: { estado: 'sin-politica' }, archivo: null, idProject: 1, errorArchivo: new Error('json') });
  assert.equal(b.nivel, 0);
  assert.match(b.nota, /no es válido/);
});

test('politicaDeArchivo: nivel 2 sin pases = desarrollo; repos que el archivo no declara se omiten', () => {
  const sinPases = { ...ARCHIVO, proyectos: { 1: { repos: ['sapsend', 'otro'], nivel: 2, pases: false } } };
  const p = politicaDeArchivo(sinPases, 1);
  assert.equal(p.codeLevel, 'desarrollo');
  assert.deepEqual(p.repos.map((r) => r.slug), ['sapsend']);
  // Pases sin operadores declarados no valen.
  assert.equal(politicaDeArchivo({ ...ARCHIVO, operadoresPases: [] }, 1).codeLevel, 'desarrollo');
});

test('jsonParaCodigo: misma forma de repos-por-proyecto.json; clon y workflows salen del archivo local', () => {
  const p = validarPoliticaApi(dto(), 1);
  const j = jsonParaCodigo(p, ARCHIVO, 1);
  assert.deepEqual(Object.keys(j), ['operadoresPases', 'repos', 'proyectos']);
  assert.equal(j.repos.sapsend.clon, ARCHIVO.repos.sapsend.clon);
  assert.deepEqual(j.repos.sapsend.workflowsProduccion, ['deploy-olp.yml']);
  assert.deepEqual(j.proyectos['1'], { repos: ['sapsend'], nivel: 2, pases: true });
  // El archivo es el techo: un autorizador de la base que el Mac no declara no pasa.
  const otro = validarPoliticaApi(dto({ deployApprovers: ['alexander@gsslatam.com'] }), 1);
  const j2 = jsonParaCodigo(otro, ARCHIVO, 1);
  assert.deepEqual(j2.operadoresPases, []);
  assert.equal(j2.proyectos['1'].pases, false);
  // Lectura no lleva desarrollo; un repo sin clon en este Mac tampoco.
  assert.equal(jsonParaCodigo(validarPoliticaApi(dto({ codeLevel: 'lectura', level: 1, deployApprovers: [] }), 1), ARCHIVO, 1), null);
  assert.equal(jsonParaCodigo(p, { repos: {} }, 1), null);
});

test('carpetasLectura y prohibidasLectura: solo clones que existen; sin .env ni .git', () => {
  const p = validarPoliticaApi(dto({ codeLevel: 'lectura', level: 1, deployApprovers: [] }), 1);
  const { dirs, faltan } = carpetasLectura(p, ARCHIVO, { existe: () => true });
  assert.deepEqual(dirs.map((d) => d.ruta), ['/Users/x/.puente-hilos/horus-prod/repos/sapsend']);
  assert.deepEqual(faltan, []);
  assert.deepEqual(carpetasLectura(p, ARCHIVO, { existe: () => false }).faltan, ['sapsend']);
  const prohibidas = prohibidasLectura(dirs);
  assert.ok(prohibidas.includes('Read(//Users/x/.puente-hilos/horus-prod/repos/sapsend/**/.env)'));
  assert.ok(prohibidas.includes('Read(//Users/x/.puente-hilos/horus-prod/repos/sapsend/.git/**)'));
  assert.ok(prohibidas.includes('Read(**/.env)'));
  assert.deepEqual(carpetasLectura(validarPoliticaApi(dto({ codeLevel: 'ninguno', level: 0, repos: [], deployApprovers: [] }), 1), ARCHIVO).dirs, []);
});

test('armarArgumentos: la lectura agrega --add-dir y niega secretos; sin política, igual que antes', () => {
  const base = { perfil: { mcpServers: {}, herramientas: [], web: false }, sesion: { id: '11111111-1111-1111-1111-111111111111', nueva: true }, rutaMcp: '/m', rutaSistema: '/s', dirArchivos: '/a' };
  const sin = armarArgumentos(base);
  const con = armarArgumentos({ ...base, lectura: { dirs: ['/r/sapsend'], prohibidas: ['Read(//r/sapsend/**/.env)'] } });
  assert.equal(sin.filter((a) => a === '--add-dir').length, 1);
  assert.equal(con.filter((a) => a === '--add-dir').length, 2);
  assert.ok(con.includes('/r/sapsend'));
  assert.ok(con.includes('Read(//r/sapsend/**/.env)'));
  // Nunca Bash por la lectura.
  assert.ok(!con.slice(con.indexOf('--allowedTools'), con.indexOf('--disallowedTools')).some((a) => a.startsWith('Bash')));
});

test('textoPolitica: dice el nivel, lo que puede leer y que el desarrollo aún no aplica', () => {
  const p = validarPoliticaApi(dto(), 1);
  const t = textoPolitica({ politica: p, lectura: { dirs: [{ slug: 'sapsend', github: 'gsslatam/sapsend', ruta: '/r/sapsend' }], faltan: [] } });
  assert.match(t, /Desarrollo \+ pases/);
  assert.match(t, /\/r\/sapsend/);
  assert.match(t, /solo puede LEER/);
  assert.match(t, /nicolas\.rivera@gsslatam\.com/);
  assert.match(textoPolitica({ politica: { nivel: 0, repos: [], pases: false, nota: null }, lectura: { dirs: [], faltan: [] } }), /NO tiene acceso a código/);
});

test('leerArchivoManual: sin ruta o sin archivo = null; JSON inválido lanza', () => {
  assert.equal(leerArchivoManual(null), null);
  assert.equal(leerArchivoManual('/no/existe.json'), null);
  assert.throws(() => leerArchivoManual('/x.json', { existe: () => true, leer: () => '{' }));
  assert.deepEqual(leerArchivoManual('/x.json', { existe: () => true, leer: () => JSON.stringify(ARCHIVO) }).proyectos['1'].repos, ['sapsend']);
});

test('politicaDelTurno + escribirContexto: el bloque llega al sistema y queda copia en .puente/politica.json', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'politica-'));
  const clon = path.join(dir, 'repos', 'sapsend');
  mkdirSync(clon, { recursive: true });
  const archivo = { ...ARCHIVO, repos: { sapsend: { ...ARCHIVO.repos.sapsend, clon } } };
  const synerlink = { politica: async () => ({ policy: dto({ codeLevel: 'lectura', level: 1, deploys: false, deployApprovers: [] }) }) };
  const t = await politicaDelTurno({ cfg: { rutaReposPorProyecto: '/x.json' }, synerlink, idConversation: 5, idProject: 1, leerArchivo: () => archivo });
  assert.equal(t.politica.codeLevel, 'lectura');
  assert.deepEqual(t.lectura.dirs, [clon]);
  const rutas = rutasDelHilo(dir, 1, 5);
  asegurarCarpetas(rutas);
  const contexto = { project: { idProject: 1, name: 'P', company: { companyName: 'GSS' }, profile: { key: 'gss', label: 'GSS' }, files: [], instructions: null } };
  escribirContexto({ rutas, agente: 'Orus', contexto, perfil: { mcpServers: {} }, instruccionesEn: 'system-prompt', politicaTurno: t });
  assert.match(readFileSync(rutas.sistema, 'utf8'), /Acceso a código en este proyecto: Lectura/);
  assert.equal(JSON.parse(readFileSync(path.join(rutas.puente, 'politica.json'), 'utf8')).codeLevel, 'lectura');

  // SynerLink caído: «ninguno», sin carpetas, con la nota.
  const caido = await politicaDelTurno({ cfg: {}, synerlink: { politica: async () => { throw new Error('ECONNRESET'); } }, idConversation: 5, idProject: 1, leerArchivo: () => archivo });
  assert.equal(caido.politica.nivel, 0);
  assert.equal(caido.lectura, null);
  assert.match(caido.bloque, /No pude leer los permisos/);
});
