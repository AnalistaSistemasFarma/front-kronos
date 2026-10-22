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
 */
import { readFileSync } from 'node:fs';
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

const real = crearClienteSynerLink({ url: cfg.url, llave: cfg.llave });
const cfgSim = { ...cfg, hilosDir: path.join(cfg.hilosDir, 'verificacion-codigo'), agenteNombre: arg('nombre', 'Orus') };
const nada = async (...a) => null;
const synerlink = {
  contexto: () => real.contexto(contextoDe),
  descargar: (u) => real.descargar(u),
  estado: async (id, s, etiqueta, tareas) => {
    if (etiqueta) console.log(`[indicador] ${s}: ${etiqueta}${tareas?.length ? ` (${tareas.length} subagentes)` : ''}`);
  },
  responder: async (id, cuerpo) => console.log(`\n===== RESPUESTA (NO publicada) =====\n${cuerpo}\n===== FIN =====`),
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
