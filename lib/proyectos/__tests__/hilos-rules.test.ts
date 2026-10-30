import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agentesMencionables,
  entregasHiloProyecto,
  historialParaAgente,
  MAX_HISTORIAL_CHARS_MENSAJE,
  normalizarTituloHilo,
  puedeGestionarHilo,
  type ActorHilo,
} from '../hilos-rules';

/*
 * Conversaciones de un proyecto (2026-10-29): multiagente por mención,
 * renombrar y eliminar. Reglas PURAS (lib/proyectos/hilos-rules.ts).
 */

const actor = (over: Partial<ActorHilo> = {}): ActorHilo => ({
  actorId: 'u-ana',
  role: 'editor',
  esAdmin: false,
  creadoPor: 'u-ana',
  proyectoArchivado: false,
  ...over,
});

describe('puedeGestionarHilo (renombrar y eliminar)', () => {
  it('quien creó el hilo y sigue escribiendo: sí', () => {
    expect(puedeGestionarHilo(actor()).ok).toBe(true);
  });

  it('un editor que NO lo creó: no', () => {
    const r = puedeGestionarHilo(actor({ creadoPor: 'u-otro' }));
    expect(r.ok).toBe(false);
  });

  it('el creador que quedó como lector: ya no', () => {
    expect(puedeGestionarHilo(actor({ role: 'reader' })).ok).toBe(false);
  });

  it('un lector que no lo creó: no', () => {
    expect(puedeGestionarHilo(actor({ role: 'reader', creadoPor: 'u-otro' })).ok).toBe(false);
  });

  it('el dueño del proyecto: sí, aunque no lo haya creado', () => {
    expect(puedeGestionarHilo(actor({ role: 'owner', creadoPor: 'u-otro' })).ok).toBe(true);
  });

  it('un administrador de SynerLink (miembro, cualquier rol): sí', () => {
    expect(puedeGestionarHilo(actor({ role: 'reader', creadoPor: 'u-otro', esAdmin: true })).ok).toBe(true);
  });

  it('hilos viejos sin creador: solo dueño o administrador', () => {
    expect(puedeGestionarHilo(actor({ creadoPor: null })).ok).toBe(false);
    expect(puedeGestionarHilo(actor({ creadoPor: null, role: 'owner' })).ok).toBe(true);
  });

  it('proyecto archivado: nadie, ni el dueño ni un administrador', () => {
    expect(puedeGestionarHilo(actor({ proyectoArchivado: true })).ok).toBe(false);
    expect(puedeGestionarHilo(actor({ proyectoArchivado: true, role: 'owner' })).ok).toBe(false);
    expect(puedeGestionarHilo(actor({ proyectoArchivado: true, esAdmin: true })).ok).toBe(false);
  });
});

describe('normalizarTituloHilo', () => {
  it('una línea, sin espacios repetidos', () => {
    expect(normalizarTituloHilo('  Plan   de\ncierre ')).toEqual({ ok: true, value: 'Plan de cierre' });
  });
  it('vacío, no texto o demasiado largo: error', () => {
    expect(normalizarTituloHilo('   ').ok).toBe(false);
    expect(normalizarTituloHilo(42).ok).toBe(false);
    expect(normalizarTituloHilo('x'.repeat(121)).ok).toBe(false);
    expect(normalizarTituloHilo('x'.repeat(120)).ok).toBe(true);
  });
});

const ORUS = { idAgent: 5, code: 'horus', displayName: 'Orus', handle: '@horus_gss_bot' };
const PLAY = { idAgent: 21, code: 'play', displayName: 'Play', handle: '@silvia_gss_bot' };
const PEDRO = { idAgent: 13, code: 'pedro', displayName: 'Pedro', handle: '@pedro_gss_bot' };

describe('agentesMencionables', () => {
  it('solo designados a los que la persona les escribe, sin el principal', () => {
    const r = agentesMencionables(
      [
        { ...ORUS, puedoEscribir: true },
        { ...PLAY, puedoEscribir: true },
        { ...PEDRO, puedoEscribir: false },
      ],
      ORUS.idAgent
    );
    expect(r.map((a) => a.code)).toEqual(['play']);
  });
});

describe('entregasHiloProyecto (a quién despierta un mensaje)', () => {
  const base = { mencionables: [PLAY], principal: ORUS };

  it('sin mención: solo el principal, como siempre', () => {
    expect(entregasHiloProyecto({ ...base, body: 'Revise el cierre' })).toEqual({ invitados: [], principalAtiende: true });
  });

  it('menciona SOLO a otro (por código, handle o nombre): responde ese y el principal no', () => {
    for (const body of ['@play ¿qué opina?', '@silvia_gss_bot revise', 'oiga @Play']) {
      expect(entregasHiloProyecto({ ...base, body })).toEqual({ invitados: [PLAY.idAgent], principalAtiende: false });
    }
  });

  it('menciona al principal y a otro: responden los dos', () => {
    expect(entregasHiloProyecto({ ...base, body: '@horus y @play, revisen' })).toEqual({ invitados: [PLAY.idAgent], principalAtiende: true });
  });

  it('mencionar a un agente que NO es mencionable (no asignado o no designado) no lo despierta', () => {
    expect(entregasHiloProyecto({ ...base, body: '@pedro ayúdeme' })).toEqual({ invitados: [], principalAtiende: true });
  });

  it('un correo o un bloque de código no son menciones', () => {
    expect(entregasHiloProyecto({ ...base, body: 'escriba a ana@play.com' }).invitados).toEqual([]);
    expect(entregasHiloProyecto({ ...base, body: '```\n@play\n```' }).invitados).toEqual([]);
  });

  it('sin mencionables: nunca invita a nadie', () => {
    expect(entregasHiloProyecto({ mencionables: [], principal: ORUS, body: '@play hola' })).toEqual({ invitados: [], principalAtiende: true });
  });
});

describe('historialParaAgente', () => {
  it('autor legible por rol, adjuntos por nombre y cuerpo recortado', () => {
    const h = historialParaAgente([
      { id: 1, role: 'system', body: 'inicio', created_at: new Date('2026-10-29T10:00:00Z'), userAuthor: null, agentAuthor: null, attachments: [] },
      { id: 2, role: 'user', body: 'x'.repeat(MAX_HISTORIAL_CHARS_MENSAJE + 10), created_at: new Date('2026-10-29T10:01:00Z'), userAuthor: { name: 'Ana', email: 'a@x' }, agentAuthor: null, attachments: [{ file_name: 'a.pdf' }] },
      { id: 3, role: 'agent', body: 'listo', created_at: new Date('2026-10-29T10:02:00Z'), userAuthor: null, agentAuthor: { id_agent: 21, code: 'play', display_name: 'Play' }, attachments: [] },
    ]);
    expect(h.map((m) => m.author)).toEqual(['SynerLink', 'Ana', 'Play']);
    expect(h[1].body.endsWith('[recortado]')).toBe(true);
    expect(h[1].attachments).toEqual(['a.pdf']);
    expect(h[2].agentCode).toBe('play');
  });
});

/* ─────────────────────────── SQL ─────────────────────────── */

const raiz = path.resolve(__dirname, '../../..');
const leer = (p: string) => readFileSync(path.join(raiz, p), 'utf8');
const migracion = leer('prisma/migrations/20261029180000_chat_project_conversation_log/migration.sql');
const bloque = migracion.slice(migracion.indexOf('SET XACT_ABORT ON;'), migracion.indexOf('/* BLOQUE-DDL-FIN */'));

describe('SQL del registro de conversaciones', () => {
  it('PRUEBAS y PROD llevan el bloque DDL idéntico y su guarda de base ANTES del DDL', () => {
    for (const [archivo, base] of [
      ['prisma/manual/2026-10-29-chat-project-conversation-log-PRUEBAS.sql', 'KRONOSDB_PRUEBAS'],
      ['prisma/manual/2026-10-29-chat-project-conversation-log-PROD.sql', 'KRONOSDB'],
    ] as const) {
      const sql = leer(archivo);
      const b = sql.slice(sql.indexOf('SET XACT_ABORT ON;'), sql.indexOf('/* BLOQUE-DDL-FIN */'));
      expect(b).toBe(bloque);
      expect(sql.indexOf(`N'${base}'`)).toBeGreaterThan(-1);
      expect(sql.indexOf(`N'${base}'`)).toBeLessThan(sql.indexOf('CREATE TABLE'));
    }
  });

  it('solo crea lo nuevo (sin DROP, sin ALTER de tablas existentes) y la reversa exige confirmar la pérdida', () => {
    expect(bloque).not.toMatch(/DROP\s/i);
    expect(bloque).not.toMatch(/ALTER TABLE \[dbo\]\.\[chat_conversation\]/i);
    expect(bloque).toMatch(/INSTEAD OF UPDATE, DELETE/);
    expect(leer('prisma/manual/2026-10-29-chat-project-conversation-log-reversa.sql')).toMatch(/@ConfirmoPerdidaRegistro/);
  });
});
