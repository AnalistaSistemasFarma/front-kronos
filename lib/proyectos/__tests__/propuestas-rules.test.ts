import { describe, expect, it } from 'vitest';
import { puedeConfirmar, PUENTE_KINDS, resumenPropuesta, validarPropuesta } from '../propuestas-rules';

const editor = { contribute: true, manageMembers: false };
const lector = { contribute: false, manageMembers: false };
const dueno = { contribute: true, manageMembers: true };

describe('validarPropuesta', () => {
  it('tarea_crear: exige título y fecha; el responsable es texto, no un id', () => {
    const r = validarPropuesta({ kind: 'tarea_crear', tarea: { title: ' Revisar ', startDate: '2026-10-20', responsable: 'Silvia Gómez', status: 'en_curso', progress: 10 } });
    expect(r).toEqual({ ok: true, value: { kind: 'tarea_crear', tarea: { title: 'Revisar', startDate: '2026-10-20', responsable: 'Silvia Gómez', status: 'en_curso', progress: 10 } } });
    expect(validarPropuesta({ kind: 'tarea_crear', tarea: { startDate: '2026-10-20' } }).ok).toBe(false);
    expect(validarPropuesta({ kind: 'tarea_crear', tarea: { title: 'x', startDate: '20/10/2026' } }).ok).toBe(false);
    // Campos desconocidos (p. ej. idResponsible, created_by) se ignoran: el agente no fija ids.
    const sinIds = validarPropuesta({ kind: 'tarea_crear', tarea: { title: 'x', startDate: '2026-10-20', idResponsible: 'u-admin', created_by: 'u-admin' } });
    expect(sinIds.ok && JSON.stringify(sinIds.value)).not.toMatch(/u-admin/);
  });
  it('tarea_editar: exige la tarea y al menos un cambio', () => {
    expect(validarPropuesta({ kind: 'tarea_editar', idTask: 5, tarea: { status: 'hecha' } }).ok).toBe(true);
    expect(validarPropuesta({ kind: 'tarea_editar', idTask: 5, tarea: {} }).ok).toBe(false);
    expect(validarPropuesta({ kind: 'tarea_editar', idTask: -1, tarea: { status: 'hecha' } }).ok).toBe(false);
  });
  it('el puente solo puede proponer tareas', () => {
    expect(validarPropuesta({ kind: 'miembro_invitar', email: 'a@b.co', role: 'editor' }, PUENTE_KINDS).ok).toBe(false);
    expect(validarPropuesta({ kind: 'solicitud_vincular', idRequest: 3 }, PUENTE_KINDS).ok).toBe(false);
    expect(validarPropuesta({ kind: 'tarea_crear', tarea: { title: 'x', startDate: '2026-10-20' } }, PUENTE_KINDS).ok).toBe(true);
  });
  it('otros tipos', () => {
    expect(validarPropuesta({ kind: 'miembro_invitar', email: 'A@B.co', role: 'reader' })).toEqual({ ok: true, value: { kind: 'miembro_invitar', email: 'a@b.co', role: 'reader' } });
    expect(validarPropuesta({ kind: 'miembro_invitar', email: 'a@b.co', role: 'owner' }).ok).toBe(false);
    expect(validarPropuesta({ kind: 'conversacion_crear', agentCode: 'Play', title: null })).toEqual({ ok: true, value: { kind: 'conversacion_crear', agentCode: 'play', title: null } });
    expect(validarPropuesta({ kind: 'borrar_todo' }).ok).toBe(false);
    expect(validarPropuesta(null).ok).toBe(false);
  });
  it('resumen legible', () => {
    const v = validarPropuesta({ kind: 'tarea_editar', idTask: 5, tarea: { status: 'en_curso', progress: 40 } });
    expect(v.ok && resumenPropuesta(v.value, { tituloTarea: 'Radicar DIM' })).toBe('Tarea «Radicar DIM» → estado: En curso, avance: 40 %');
  });
});

describe('puedeConfirmar', () => {
  it('puente: cualquier dueño o editor; nunca un lector', () => {
    const p = { source: 'puente' as const, requestedFor: null, kind: 'tarea_crear' as const };
    expect(puedeConfirmar(p, { id: 'u1', caps: editor }).ok).toBe(true);
    expect(puedeConfirmar(p, { id: 'u1', caps: dueno }).ok).toBe(true);
    expect(puedeConfirmar(p, { id: 'u1', caps: lector }).ok).toBe(false);
  });
  it('MCP: SOLO la persona a cuyo nombre actuó el agente (aunque otro sea dueño)', () => {
    const p = { source: 'mcp' as const, requestedFor: 'u-silvia', kind: 'tarea_crear' as const };
    expect(puedeConfirmar(p, { id: 'u-silvia', caps: editor }).ok).toBe(true);
    expect(puedeConfirmar(p, { id: 'u-dueno', caps: dueno }).ok).toBe(false);
    // Y con el rol vigente: si hoy es lectora, tampoco.
    expect(puedeConfirmar(p, { id: 'u-silvia', caps: lector }).ok).toBe(false);
  });
  it('invitar exige ser el dueño', () => {
    const p = { source: 'mcp' as const, requestedFor: 'u1', kind: 'miembro_invitar' as const };
    expect(puedeConfirmar(p, { id: 'u1', caps: editor }).ok).toBe(false);
    expect(puedeConfirmar(p, { id: 'u1', caps: dueno }).ok).toBe(true);
  });
});
