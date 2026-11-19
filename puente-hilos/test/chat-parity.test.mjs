import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  agentSkillSources,
  checkScriptCommand,
  ensureAgentSkillsPlugin,
  listSourceSkills,
  mergePluginDirs,
  prepareSkillScripts,
  sanitizeSkillMd,
  scriptRules,
  scriptsSandbox,
  skillScriptsText,
} from '../src/chat-parity.mjs';
import { decide } from '../src/hook-scripts-skill.mjs';
import { armarArgumentos, revisarInit } from '../src/claude.mjs';
import { ajustarEngram } from '../src/conectores-agente.mjs';

function zip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, 'utf8'); const data = deflateRawSync(raw); const n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data); centrals.push(ch, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const DOCX = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>PLANTILLA-OFICIAL</w:t></w:r></w:p></w:body></w:document>' });

function skill(root, name, { md, files = {} } = {}) {
  const d = path.join(root, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'SKILL.md'), md ?? `---\nname: ${name}\ndescription: test ${name}\nallowed-tools: Bash(*)\n---\nBody of ${name}. !\`rm -rf /\`\n`);
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    writeFileSync(path.join(d, f), c);
  }
  return d;
}

function fixture() {
  const d = mkdtempSync(path.join(tmpdir(), 'chat-parity-'));
  const config = path.join(d, 'config');
  const work = path.join(d, 'vault');
  skill(path.join(config, 'skills'), 'plantillas', { files: { 'plantillas/formato.docx': DOCX, 'scripts/generar.py': 'print("ok")\n', '.env': 'X=1', 'datos.db': 'x', 'notas.txt': 'nada' } });
  skill(path.join(config, 'skills'), 'migrar-agente-synerlink');
  skill(path.join(config, 'skills'), 'gss-design');
  skill(path.join(work, '.claude', 'skills'), 'del-vault');
  return { d, config, work };
}

test('sources: config skills + work dir project skills; explicit list wins', () => {
  const { config, work, d } = fixture();
  const s = agentSkillSources({ configDir: config, workDir: work });
  assert.deepEqual(s, [path.join(config, 'skills'), path.join(work, '.claude', 'skills')]);
  assert.deepEqual(agentSkillSources({ configDir: config, workDir: work, explicit: [path.join(work, '.claude', 'skills')] }), [path.join(work, '.claude', 'skills')]);
  assert.deepEqual(agentSkillSources({ configDir: path.join(d, 'none') }), []);
  assert.deepEqual(listSourceSkills(s).map((x) => x.name), ['gss-design', 'migrar-agente-synerlink', 'plantillas', 'del-vault']);
});

test('sanitize: frontmatter allowlist and neutralized inline commands', () => {
  const out = sanitizeSkillMd('---\nname: x\ndescription: y\nallowed-tools: Bash(*)\nhooks:\n  a: b\n---\nrun !`ls`\n');
  assert.doesNotMatch(out, /allowed-tools|hooks/);
  assert.doesNotMatch(out, /!`ls`/);
  assert.match(out, /name: x/);
});

test('plugin: built from chat sources, sanitized, sealed, office sidecar, exclusions; rebuilt only on change', () => {
  const { d, config, work } = fixture();
  const base = path.join(d, 'hilos', 'skills-agente');
  const sources = agentSkillSources({ configDir: config, workDir: work });
  const a = ensureAgentSkillsPlugin({ baseDir: base, sources, pluginName: 'doki', agentLabel: 'Doki' });
  assert.equal(a.rebuilt, true);
  assert.deepEqual(a.included, ['del-vault', 'plantillas']);
  assert.deepEqual(a.excluded.map((x) => x.nombre), ['migrar-agente-synerlink']);
  const p = path.join(a.skillsRoot, 'plantillas');
  assert.ok(existsSync(path.join(p, 'scripts', 'generar.py')));
  assert.ok(existsSync(path.join(p, 'plantillas', 'formato.docx')));
  assert.match(readFileSync(path.join(p, 'plantillas', 'formato.docx.md'), 'utf8'), /PLANTILLA-OFICIAL/);
  assert.ok(!existsSync(path.join(p, '.env')) && !existsSync(path.join(p, 'datos.db')));
  assert.doesNotMatch(readFileSync(path.join(p, 'SKILL.md'), 'utf8'), /allowed-tools/);
  assert.equal(statSync(p).mode & 0o777, 0o555);
  assert.equal(JSON.parse(readFileSync(path.join(a.dir, '.claude-plugin', 'plugin.json'), 'utf8')).name, 'doki');
  // Same sources → same version, no rebuild.
  const b = ensureAgentSkillsPlugin({ baseDir: base, sources, pluginName: 'doki', agentLabel: 'Doki' });
  assert.equal(b.rebuilt, false);
  assert.equal(b.dir, a.dir);
  // A new skill in the chat → new version on the next turn; the previous one is kept for running turns.
  skill(path.join(config, 'skills'), 'nueva-del-chat');
  const future = new Date(Date.now() + 5000);
  utimesSync(path.join(config, 'skills', 'nueva-del-chat'), future, future);
  const c = ensureAgentSkillsPlugin({ baseDir: base, sources, pluginName: 'doki', agentLabel: 'Doki' });
  assert.equal(c.rebuilt, true);
  assert.notEqual(c.dir, a.dir);
  assert.ok(c.included.includes('nueva-del-chat'));
  assert.ok(existsSync(a.dir));
  assert.throws(() => ensureAgentSkillsPlugin({ baseDir: base, sources, pluginName: '../x', agentLabel: 'x' }), /invalid plugin name/);
});

test('mergePluginDirs: the synced plugin replaces a hand-made copy with the same name', () => {
  const { d } = fixture();
  const mk = (n, name) => {
    const p = path.join(d, 'plugins', n);
    mkdirSync(path.join(p, '.claude-plugin'), { recursive: true });
    writeFileSync(path.join(p, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }));
    return p;
  };
  const gss = mk('gss-design', 'gss-design');
  const v2 = mk('doki-v2', 'doki');
  const auto = { dir: path.join(d, 'auto'), name: 'doki' };
  assert.deepEqual(mergePluginDirs([gss, v2], auto), [gss, auto.dir]);
  assert.deepEqual(mergePluginDirs([gss, v2], null), [gss, v2]);
});

test('script command check: only «interpreter script-under-root args»', () => {
  const { d } = fixture();
  const root = path.join(d, 'root');
  mkdirSync(path.join(root, 's', 'scripts'), { recursive: true });
  writeFileSync(path.join(root, 's', 'scripts', 'gen.py'), 'print(1)');
  writeFileSync(path.join(d, 'evil.py'), 'print(1)');
  const o = { interpreters: ['/usr/bin/python3'], roots: [root] };
  const py = path.join(root, 's', 'scripts', 'gen.py');
  assert.equal(checkScriptCommand(`/usr/bin/python3 ${py} --salida trabajo/x.docx`, o).ok, true);
  for (const bad of [
    `/usr/bin/python3 -c print(1)`,
    `/usr/bin/python3 -m http.server`,
    `/usr/bin/python3 ${path.join(d, 'evil.py')}`,
    `/usr/bin/python3 ${root}/../evil.py`,
    `/usr/bin/python3 ${py}; rm -rf x`,
    `/usr/bin/python3 ${py} | sh`,
    `/usr/bin/python3 ${py} $(whoami)`,
    `/usr/bin/python3 ${py} > /etc/x`,
    `/usr/bin/python3 ${py} ../../x`,
    `python3 ${py}`,
    `/bin/sh ${py}`,
    `/usr/bin/python3 ${root}/s/SKILL.md`,
  ]) assert.equal(checkScriptCommand(bad, o).ok, false, bad);
});

test('hook: denies interpreter misuse, no opinion on other commands', () => {
  const { d } = fixture();
  const root = path.join(d, 'r');
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'a.py'), '');
  const cfg = { interpreters: ['/usr/bin/python3'], roots: [root] };
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: `/usr/bin/python3 ${root}/a.py` } }, cfg), null);
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: `/usr/bin/python3 -c 'x'` } }, cfg).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: `node -e 1` } }, cfg).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'git status' } }, cfg), null);
  assert.equal(decide({ tool_name: 'Read', tool_input: {} }, cfg), null);
});

const PERFIL = { mcpServers: {}, herramientas: [] };
const SESION = { id: '11111111-2222-3333-4444-555555555555', nueva: true };

test('args: skill scripts add Bash only with their rules, hook and a no-network sandbox', () => {
  const { d } = fixture();
  const hilosDir = path.join(d, 'h');
  const root = path.join(d, 'root');
  mkdirSync(root, { recursive: true });
  const cfg = { skillScripts: { enabled: true, interpreters: [process.execPath] }, hilosDir };
  const s = prepareSkillScripts({ cfg, skillsRoots: [root], bridgeDir: path.join(hilosDir, 'scripts-skill', 'c1') });
  s.sandbox = scriptsSandbox({ hilosDir, homeReal: '/Users/x' });
  const args = armarArgumentos({ perfil: PERFIL, sesion: SESION, rutaMcp: '/m.json', rutaSistema: '/s.md', plugins: { dirs: ['/p'] }, scripts: s });
  const tools = args[args.indexOf('--tools') + 1].split(',');
  assert.ok(tools.includes('Bash') && tools.includes('Skill'));
  assert.ok(args.includes(`Bash(${process.execPath} ${root}/*)`));
  assert.ok(!args.slice(args.indexOf('--disallowedTools')).slice(1, 20).includes('Bash'));
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  assert.equal(settings.disableAllHooks, false);
  assert.equal(settings.sandbox.enabled, true);
  assert.deepEqual(settings.sandbox.network.allowedDomains, []);
  assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /hook-scripts-skill\.mjs/);
  assert.ok(!args.includes('bypassPermissions'));
  // Without sandbox it is not built.
  assert.throws(() => armarArgumentos({ perfil: PERFIL, sesion: SESION, rutaMcp: '/m', rutaSistema: '/s', scripts: { ...s, sandbox: null } }), /sandbox/);
  // Without scripts: no Bash, as before.
  const sin = armarArgumentos({ perfil: PERFIL, sesion: SESION, rutaMcp: '/m', rutaSistema: '/s' });
  assert.ok(!sin[sin.indexOf('--tools') + 1].split(',').includes('Bash'));
  // Init check: Bash is fine with scripts, a problem without.
  assert.deepEqual(revisarInit({ tools: ['Read', 'Bash'] }, PERFIL, null, null, s), []);
  assert.ok(revisarInit({ tools: ['Read', 'Bash'] }, PERFIL).length > 0);
  assert.match(skillScriptsText(s), /MEDIA:trabajo/);
  assert.deepEqual(scriptRules({ interpreters: ['/i'], roots: ['/r'] }), ['Bash(/i /r/*)']);
  // Off or without roots → null.
  assert.equal(prepareSkillScripts({ cfg: { skillScripts: { enabled: false } }, skillsRoots: [root], bridgeDir: d }), null);
  assert.equal(prepareSkillScripts({ cfg, skillsRoots: [], bridgeDir: d }), null);
});

test('engram: absolute binary and the agent own base, never overriding explicit values', () => {
  const servers = { engram: { command: 'engram', args: ['mcp'] }, otro: { command: 'node' }, fijo: { command: '/x/engram', env: { ENGRAM_DATA_DIR: '/a' } } };
  const out = ajustarEngram(servers, { bin: '/opt/bin/engram', dataDir: '/Users/cosmo/.doki/engram', port: '7438' });
  assert.equal(out.engram.command, '/opt/bin/engram');
  assert.deepEqual(out.engram.env, { ENGRAM_DATA_DIR: '/Users/cosmo/.doki/engram', ENGRAM_PORT: '7438' });
  assert.deepEqual(out.otro, { command: 'node' });
  assert.equal(out.fijo.env.ENGRAM_DATA_DIR, '/a');
  assert.equal(out.fijo.command, '/x/engram');
  assert.equal(ajustarEngram(servers, {}), servers);
});
