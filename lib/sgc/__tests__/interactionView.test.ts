import { describe, expect, it } from 'vitest';
import { presentInteraction, presentInteractions, type SgcInteractionInput } from '../interactionView';

const NAMES: Record<string, string> = {
  'ana@x.com': 'Ana López',
  'pedro@x.com': 'Pedro Ruiz',
  'luz@x.com': 'Luz Díaz',
};
const nameOf = (e: string) => NAMES[e.toLowerCase()] ?? e;

let seq = 0;
function item(body: string, kind = 'estado', authorEmail = 'ana@x.com', createdAt = '2026-10-01T15:00:00.000Z'): SgcInteractionInput {
  seq += 1;
  return { id: String(seq), kind, authorEmail, author: NAMES[authorEmail] ?? null, body, createdAt };
}

describe('Historial de interacciones · presentación (no cambia lo guardado)', () => {
  it('aprobación con firma: acción humana, motivo visible y la huella solo en el detalle', () => {
    const body =
      'Aprobó en «Revisión».\nComentario: Todo en orden.\nFirma electrónica: Revisó (firmado electrónicamente). Motivo: Revisión técnica\nContenido firmado: borrador-v1.html · SHA-256 abc123';
    const v = presentInteraction(item(body, 'decision'), nameOf);
    expect(v.who).toBe('Ana López');
    expect(v.action).toBe('aprobó «Revisión» y firmó como «Revisó»');
    expect(v.observation).toBe('Todo en orden.');
    expect(v.note).toContain('Motivo de la firma: Revisión técnica');
    expect(v.details.join('\n')).toContain('SHA-256 abc123');
    expect(`${v.action} ${v.observation} ${v.note}`).not.toContain('SHA-256');
    expect(v.raw).toBe(body);
  });

  it('devolución: «devolvió … a elaboración» con sus observaciones', () => {
    const v = presentInteraction(item('Devolvió a elaboración en «Revisión».\nObservaciones: Falta el anexo 2.', 'devolucion'), nameOf);
    expect(v.action).toBe('devolvió el documento a elaboración desde «Revisión»');
    expect(v.observation).toBe('Falta el anexo 2.');
  });

  it('asignación automática: nombres en vez de correos y grupos legibles', () => {
    const v = presentInteraction(item('Tarea «Revisión» asignada a: pedro@x.com, grupo CALIDAD_VERIF · firma en orden.'), nameOf);
    expect(v.automatic).toBe(true);
    expect(v.action).toBe('«Revisión» quedó asignada a Pedro Ruiz, el grupo calidad verif');
    expect(v.note).toBe('Firma en orden');
  });

  it('firmantes: quién entró y quién salió, sin símbolos ni correos', () => {
    const v = presentInteraction(item('Asignó los firmantes de «Revisión».\n+ pedro@x.com (orden 1)\n− luz@x.com\nModo de firma: en orden\nMotivo: Cambio de revisor.', 'firmantes'), nameOf);
    expect(v.action).toBe('asignó los firmantes de «Revisión»: agregó a Pedro Ruiz; quitó a Luz Díaz');
    expect(v.observation).toBe('Cambio de revisor.');
    expect(v.note).toBe('Firma en orden.');
  });

  it('reasignación con motivo', () => {
    const v = presentInteraction(item('Reasignó «Aprobación» de pedro@x.com a luz@x.com.\nMotivo: Vacaciones.', 'reasignacion'), nameOf);
    expect(v.action).toBe('reasignó «Aprobación» de Pedro Ruiz a Luz Díaz');
    expect(v.observation).toBe('Vacaciones.');
  });

  it('borrador guardado: sin la huella en la vista principal', () => {
    const v = presentInteraction(item('Guardó la revisión 2 del borrador en el editor de la app: ajusté el alcance\nSHA-256: ffee', 'adjunto'), nameOf);
    expect(v.action).toBe('guardó la revisión 2 del borrador');
    expect(v.note).toBe('ajusté el alcance');
    expect(v.details).toEqual(['SHA-256: ffee']);
  });

  it('una nota muestra el texto de la persona como observación', () => {
    const v = presentInteraction(item('Por favor revisar la sección 3.', 'nota'), nameOf);
    expect(v.action).toBe('agregó una nota');
    expect(v.observation).toBe('Por favor revisar la sección 3.');
  });

  it('el programador aparece como «Sistema» y los recordatorios seguidos se agrupan sin perder fechas', () => {
    const sys = 'sistema.sgc@synerlink';
    const a = item('Recordatorio automático de lectura (cada 3 días) a 1 persona(s): luz@x.com.', 'estado', sys, '2026-10-01T11:00:00.000Z');
    const b = item('Recordatorio automático de lectura (cada 3 días) a 1 persona(s): luz@x.com.', 'estado', sys, '2026-10-04T11:00:00.000Z');
    const out = presentInteractions([a, b], nameOf);
    expect(out).toHaveLength(1);
    expect(out[0].who).toBe('Sistema');
    expect(out[0].count).toBe(2);
    expect(out[0].groupedDates).toEqual([a.createdAt, b.createdAt]);
    expect(out[0].details.join(' ')).toContain('Luz Díaz');
  });

  it('no agrupa acciones de personas separadas en el tiempo', () => {
    const a = item('Por favor revisar.', 'nota', 'ana@x.com', '2026-10-01T11:00:00.000Z');
    const b = item('Por favor revisar.', 'nota', 'ana@x.com', '2026-10-01T15:00:00.000Z');
    expect(presentInteractions([a, b], nameOf)).toHaveLength(2);
  });

  it('un texto que no reconoce se muestra igual (nada se esconde)', () => {
    const v = presentInteraction(item('Algo nuevo que pasó.\nOtra línea.'), nameOf);
    expect(v.action).toBe('algo nuevo que pasó.');
    expect(v.note).toBe('Otra línea.');
  });
});
