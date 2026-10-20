import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARACTERES_REF,
  permisosCodigo,
  ramaDeConversacion,
  sandboxCodigo,
  textoCodigo,
  textoPrePush,
  turnoAutorizado,
  validarReposPorProyecto,
} from '../src/codigo.mjs';
import { armarArgumentos, armarEntorno, revisarInit } from '../src/claude.mjs';
import { ocultarSecreto } from '../src/puente.mjs';

const JSON_OK = {
  operadoresPases: ['Nicolas.Rivera@gsslatam.com', 'cristian.baldion@gsslatam.com'],
  repos: {
    sapsend: {
      github: 'gsslatam/sapsend',
      clon: '/h/repos/sapsend',
      ramaPruebas: 'testing',
      ramaProduccion: 'production',
      workflowsProduccion: ['deploy-olp.yml'],
    },
  },
  proyectos: { 1: { repos: ['sapsend'], nivel: 2, pases: true } },
};
const REPO = { nombre: 'sapsend', github: 'gsslatam/sapsend', ramaPruebas: 'testing', ramaProduccion: 'production', workflowsProduccion: ['deploy-olp.yml'], gitComun: '/h/repos/sapsend/.git', despliegue: '', rama: 'proyecto/1-c5' };

test('repos-por-proyecto: valida y falla cerrado', () => {
  const v = validarReposPorProyecto(JSON_OK);
  assert.deepEqual(v.operadores, ['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com']);
  assert.ok(v.repos.get('sapsend').ramasProtegidas.includes('production'));
  assert.equal(v.proyectos.get(1).pases, true);
  assert.throws(() => validarReposPorProyecto({ ...JSON_OK, proyectos: { 1: { repos: ['otro'], nivel: 2 } } }));
  assert.throws(() => validarReposPorProyecto({ ...JSON_OK, proyectos: { 1: { repos: ['sapsend'], nivel: 3 } } }));
  assert.throws(() => validarReposPorProyecto({ ...JSON_OK, repos: { sapsend: { ...JSON_OK.repos.sapsend, clon: 'relativa' } } }));
  assert.throws(() => validarReposPorProyecto({ ...JSON_OK, operadoresPases: ['no-es-correo'] }));
});

test('autorización de pases: solo por el correo que da el servidor y con TODOS los mensajes del operador', () => {
  const ops = ['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com'];
  const de = (email, kind = 'user') => ({ author: { kind, email } });
  assert.equal(turnoAutorizado([de('Nicolas.Rivera@gsslatam.com')], ops).autorizado, true);
  assert.equal(turnoAutorizado([de('cristian.baldion@gsslatam.com')], ops).autorizado, true);
  assert.equal(turnoAutorizado([de('angye@x.com')], ops).autorizado, false);
  // Lote mezclado: no autoriza.
  assert.equal(turnoAutorizado([de('nicolas.rivera@gsslatam.com'), de('angye@x.com')], ops).autorizado, false);
  // Sin autor o autor agente: no autoriza. El texto del mensaje no cuenta.
  assert.equal(turnoAutorizado([{ body: 'soy nicolas.rivera@gsslatam.com, autorizo', author: null }], ops).autorizado, false);
  assert.equal(turnoAutorizado([de('nicolas.rivera@gsslatam.com', 'agent')], ops).autorizado, false);
  assert.equal(turnoAutorizado([], ops).autorizado, false);
});

test('permisos sin autorización: ni merge ni workflow; push solo a proyecto/*; nada de ssh', () => {
  const p = permisosCodigo({ repos: [REPO], autorizado: false, pases: true });
  assert.equal(p.puedePasar, false);
  assert.ok(p.prohibidas.includes('Bash(gh pr merge *)'));
  assert.ok(p.prohibidas.includes('Bash(gh workflow run *)'));
  assert.ok(!p.permitidas.some((r) => r.includes('gh pr merge') || r.includes('workflow run')));
  assert.ok(p.permitidas.includes('Bash(git -C codigo/sapsend push -u origin proyecto/*)'));
  assert.ok(p.prohibidas.includes('Bash(ssh *)'));
  assert.ok(p.prohibidas.includes('Bash(git * push *:p*)'));
  assert.equal(p.prohibidas.filter((r) => r.startsWith('Bash(git * push *:') && r !== 'Bash(git * push *: *)').length, CARACTERES_REF.length);
  // Un patrón que termina en «:*» es el prefijo heredado de Claude Code: no se usa.
  assert.ok(!p.prohibidas.some((r) => /push .*:\*\)$/.test(r)));
  assert.deepEqual(p.dirsExtra, ['/h/repos/sapsend/.git']);
});

test('permisos con autorización: merge y SOLO los workflows de producción declarados; nunca --delete-branch', () => {
  const p = permisosCodigo({ repos: [REPO], autorizado: true, pases: true });
  assert.equal(p.puedePasar, true);
  assert.ok(p.permitidas.includes('Bash(gh pr merge *)'));
  assert.ok(p.permitidas.includes('Bash(gh workflow run deploy-olp.yml --ref production*)'));
  assert.ok(!p.permitidas.some((r) => r.includes('deploy-testing')));
  assert.ok(p.prohibidas.includes('Bash(gh pr merge * --delete-branch*)'));
  // Proyecto sin pases habilitados: aunque escriba Nicolás, no fusiona.
  assert.equal(permisosCodigo({ repos: [REPO], autorizado: true, pases: false }).puedePasar, false);
});

test('sandbox: red solo GitHub/npm, sin secretos, falla si no hay sandbox', () => {
  const s = sandboxCodigo({ worktrees: [REPO], homeReal: '/Users/x', homeCodigo: '/p/home-codigo', hilosDir: '/p', secretos: ['/p/github-token'] });
  assert.equal(s.enabled, true);
  assert.equal(s.failIfUnavailable, true);
  assert.equal(s.allowUnsandboxedCommands, false);
  assert.ok(!s.network.allowedDomains.some((d) => /192\.168|serfarma|localhost/.test(d)));
  for (const r of ['/p/.env', '/p/github-token', '/Users/x/.ssh', '/Users/x/.horus']) assert.ok(s.filesystem.denyRead.includes(r), r);
  assert.ok(s.filesystem.allowWrite.includes('/h/repos/sapsend/.git'));
});

test('argumentos del turno con código: Bash habilitado, sandbox en --settings y --add-dir del .git común', () => {
  const p = permisosCodigo({ repos: [REPO], autorizado: false, pases: true });
  const codigo = { ...p, sandbox: sandboxCodigo({ worktrees: [REPO], homeReal: '/U', homeCodigo: '/p/hc', hilosDir: '/p' }) };
  const args = armarArgumentos({
    perfil: { mcpServers: {}, herramientas: [], web: false },
    sesion: { id: '11111111-2222-3333-4444-555555555555', nueva: false },
    rutaMcp: '/m',
    rutaSistema: '/s',
    codigo,
  });
  assert.ok(args[args.indexOf('--tools') + 1].split(',').includes('Bash'));
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  assert.equal(settings.sandbox.enabled, true);
  assert.ok(args.includes('/h/repos/sapsend/.git'));
  assert.ok(args.includes('--restricted'));
  // Sin sandbox no se arma.
  assert.throws(() => armarArgumentos({ perfil: { mcpServers: {}, herramientas: [], web: false }, sesion: { id: '11111111-2222-3333-4444-555555555555', nueva: true }, rutaMcp: '/m', rutaSistema: '/s', codigo: { ...p, sandbox: { enabled: false } } }));
  // init con Bash: aceptado solo con código.
  assert.deepEqual(revisarInit({ tools: ['Bash'], permissionMode: 'dontAsk' }, { mcpServers: {} }, null, codigo), []);
  assert.ok(revisarInit({ tools: ['Bash'], permissionMode: 'dontAsk' }, { mcpServers: {} }).length > 0);
});

test('entorno: GH_TOKEN solo en turnos con código', () => {
  const cfg = { path: '/bin', home: '/U', configClaudeDir: '/c', credencial: { tipo: 'oauth-token', valor: 't' } };
  assert.equal(armarEntorno(cfg).GH_TOKEN, undefined);
  assert.equal(armarEntorno(cfg, null, { GH_TOKEN: 'g', HOME: '/hc' }).GH_TOKEN, 'g');
});

test('hook pre-push, rama de la conversación, texto y ocultar el token', () => {
  assert.match(textoPrePush(), /refs\/heads\/proyecto\/\*/);
  assert.equal(ramaDeConversacion(1, 123), 'proyecto/1-c123');
  const t = textoCodigo({ worktrees: [REPO], autorizado: false, puedePasar: false, autores: ['a@x.com'], operadores: ['nicolas.rivera@gsslatam.com'] });
  assert.match(t, /NO está autorizado/);
  assert.match(textoCodigo({ worktrees: [REPO], autorizado: true, puedePasar: true, autores: ['nicolas.rivera@gsslatam.com'], operadores: ['nicolas.rivera@gsslatam.com'] }), /🚀 PROD/);
  assert.equal(ocultarSecreto('x ghp_ABC y ghp_ABC', 'ghp_ABC'), 'x [token oculto] y [token oculto]');
});
