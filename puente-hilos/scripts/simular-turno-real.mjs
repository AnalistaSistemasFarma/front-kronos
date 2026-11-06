#!/usr/bin/env node
/**
 * Reproduce un turno REAL del puente (mismo `atender` de puente.mjs, mismos
 * argumentos, mismo entorno, mismo config aislado, mismo equipo de subagentes)
 * en una conversación FICTICIA, sin escribir nada en SynerLink:
 *
 *   - el contexto del proyecto se pide de verdad (GET de solo lectura) usando la
 *     conversación real que se indique con --contexto-de;
 *   - responder, indicador, confirmar, consumo, propuestas y equipo NO salen:
 *     se imprimen aquí;
 *   - carpetas, estado y auditoría quedan en <HILOS_DIR>/verificacion-codigo.
 *
 * Uso (con el entorno del .env del puente, como run.sh):
 *   node scripts/simular-turno-real.mjs --contexto-de 123 --conversacion 990010 \
 *     --autor nicolas.rivera@gsslatam.com --prompt-archivo p.txt
 *
 * Opciones (2026-10-21): --contexto-falso (proyecto ficticio, sin llamar a SynerLink),
 * --modelo <id> (p. ej. claude-haiku-4-5 para una verificación barata) y --adjuntos-en <dir>
 * (guarda ahí los archivos que el puente habría adjuntado).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cargarConfig } from '../src/config.mjs';
import { crearClienteSynerLink } from '../src/synerlink.mjs';
import { Estado } from '../src/hilos.mjs';
import { crearPuente } from '../src/puente.mjs';
import { correrTurno } from '../src/claude.mjs';

function arg(n, d = null) {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
}
const cfg = cargarConfig(process.env);
const contextoDe = Number(arg('contexto-de'));
const idConv = Number(arg('conversacion', '990010'));
if (!(idConv >= 990000)) throw new Error('La conversación debe ser ficticia (>= 990000).');
const autor = arg('autor', 'nadie@example.com');
const prompt = readFileSync(arg('prompt-archivo'), 'utf8');

const contextoFalso = process.argv.includes('--contexto-falso');
const adjuntosEn = arg('adjuntos-en');
const real = contextoFalso ? null : crearClienteSynerLink({ url: cfg.url, llave: cfg.llave });
const cfgSim = { ...cfg, hilosDir: path.join(cfg.hilosDir, 'verificacion-codigo'), agenteNombre: arg('nombre', 'Orus'), ...(arg('modelo') ? { modelo: arg('modelo') } : {}) };
const PROYECTO_FALSO = {
  project: {
    idProject: 990001, name: 'Verificación del puente', company: { companyName: 'GROUP SHARED SERVICES' },
    profile: { key: 'sin-conectores', label: 'Sin conectores' }, instructions: '', version: 'v-sim', files: [],
    links: { emails: [], requests: [] },
  },
  conversation: { id: idConv, title: 'Verificación' },
};
const nada = async (...a) => null;
const synerlink = {
  contexto: () => (contextoFalso ? PROYECTO_FALSO : real.contexto(contextoDe)),
  descargar: (u) => real.descargar(u),
  estado: async (id, s, etiqueta, tareas) => {
    if (etiqueta) console.log(`[indicador] ${s}: ${etiqueta}${tareas?.length ? ` (${tareas.length} subagentes)` : ''}`);
  },
  responder: async (id, cuerpo) => console.log(`\n===== RESPUESTA (NO publicada) =====\n${cuerpo}\n===== FIN =====`),
  responderConArchivos: async (id, cuerpo, archivos) => {
    console.log(`\n===== RESPUESTA CON ${archivos.length} ADJUNTO(S) (NO publicada) =====\n${cuerpo}\n--- adjuntos: ${archivos.map((a) => `${a.nombre} (${a.tipo}, ${a.bytes} B)`).join(', ')}\n===== FIN =====`);
    if (adjuntosEn) {
      mkdirSync(adjuntosEn, { recursive: true });
      for (const a of archivos) writeFileSync(path.join(adjuntosEn, a.nombre), a.datos);
    }
  },
  confirmar: nada,
  consumo: nada,
  proponer: async () => ({ creadas: [], rechazadas: [] }),
  corridas: async (r) => console.log(`[equipo] ${r.runs.map((x) => `${x.slug}:${x.status}:${x.toolUses} herr.`).join(', ')}${r.blocked.length ? ` BLOQUEOS: ${r.blocked.join('; ')}` : ''}`),
};
const estado = new Estado(cfgSim.hilosDir);
const correr = (o) =>
  correrTurno({
    ...o,
    alEvento: (e, acc) => {
      // Lo que REALMENTE arrancó (no lo que diga el modelo): modo de permisos, conectores y herramientas.
      if (e.type === 'system' && e.subtype === 'init') {
        const tools = e.tools ?? [];
        const mcp = (e.mcp_servers ?? []).map((s) => `${s.name}:${s.status}`).join(', ');
        console.log(`[init] nativas: ${tools.filter((t) => !t.startsWith('mcp__')).join(',')}`);
        console.log(`[init] plugins: ${(e.plugins ?? []).map((p) => p.name ?? p).join(', ') || '(ninguno)'}; skills: ${(e.skills ?? []).length} (${(e.skills ?? []).filter((x) => /migrar-agente|crear-usuario|cierre-casos/.test(x)).join(', ') || 'ninguna de las sensibles'})`);
        console.log(`[init] permisos=${e.permissionMode}; herramientas=${tools.length} (Bash ${tools.includes('Bash') ? 'sí' : 'no'}, Agent ${tools.includes('Agent') || tools.includes('Task') ? 'sí' : 'no'}, WebFetch ${tools.includes('WebFetch') ? 'sí' : 'no'}); conectores: ${mcp || '(ninguno)'}`);
      }
      if (e.type === 'assistant')
        for (const c of e.message?.content ?? [])
          if (c.type === 'tool_use') console.log(`${e.parent_tool_use_id ? '   [sub] ' : ''}>> ${c.name}: ${String(c.input?.command ?? c.input?.file_path ?? c.input?.pattern ?? c.input?.subagent_type ?? '').slice(0, 220)}`);
      if (e.type === 'user')
        for (const c of e.message?.content ?? [])
          if (c.type === 'tool_result' && c.is_error) console.log(`${e.parent_tool_use_id ? '   [sub] ' : ''}<< ERROR ${String(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 160)}`);
      if (e.type === 'result') for (const d of e.permission_denials ?? []) console.log(`NEGADO ${d.tool_name}: ${JSON.stringify(d.tool_input).slice(0, 200)}`);
      o.alEvento?.(e, acc);
    },
  });
const puente = crearPuente({ cfg: cfgSim, synerlink, estado, correr });
await puente.atender(String(idConv), [
  { id: 1, idConversation: idConv, body: prompt, author: { kind: 'user', id: 'sim', name: autor, email: autor }, conversation: { kind: 'project' }, attachments: [] },
]);
console.log(`\nComando exacto: ${path.join(cfgSim.hilosDir, 'proyectos', '<id>', 'conversaciones', String(idConv), '.puente', 'ultimo-comando.json')}`);
