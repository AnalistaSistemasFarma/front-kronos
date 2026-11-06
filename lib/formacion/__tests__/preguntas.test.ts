import { describe, expect, it } from 'vitest';
import { armarHilo, haceCuanto, limpiarTexto, type PreguntaPlana } from '../preguntas';

// Formación · preguntas y respuestas por video (Nicolás Rivera, 2026-10-26).
const f = (id: number, parent: number | null, email: string, min: number, extra: Partial<PreguntaPlana> = {}): PreguntaPlana => ({
  id,
  parent_id: parent,
  email,
  nombre: email.split('@')[0],
  texto: `t${id}`,
  created_at: new Date(Date.UTC(2026, 9, 26, 10, min)),
  eliminado_at: null,
  likes: 0,
  meGusta: false,
  ...extra,
});

describe('Formación · hilo de preguntas', () => {
  it('preguntas recientes primero, respuestas en orden y marca de formador y propia', () => {
    const hilo = armarHilo([f(1, null, 'ana@x.com', 1), f(2, null, 'luis@x.com', 2), f(3, 1, 'profe@x.com', 3), f(4, 1, 'luis@x.com', 4)], 'luis@x.com', new Set(['profe@x.com']));
    expect(hilo.map((p) => p.id)).toEqual([2, 1]);
    expect(hilo[1].respuestas.map((r) => r.id)).toEqual([3, 4]);
    expect(hilo[1].respuestas[0].esFormador).toBe(true);
    expect(hilo[0].propia).toBe(true);
  });

  it('una pregunta eliminada se conserva solo si tiene respuestas, sin nombre ni texto', () => {
    const hilo = armarHilo(
      [f(1, null, 'ana@x.com', 1, { eliminado_at: new Date() }), f(2, 1, 'luis@x.com', 2), f(3, null, 'ana@x.com', 3, { eliminado_at: new Date() })],
      'luis@x.com',
      new Set()
    );
    expect(hilo.map((p) => p.id)).toEqual([1]);
    expect(hilo[0].texto).toBe('Comentario eliminado');
    expect(hilo[0].nombre).toBe('');
  });

  it('valida el texto', () => {
    expect(limpiarTexto('  hola ')).toEqual({ ok: true, texto: 'hola' });
    expect(limpiarTexto('   ').ok).toBe(false);
    expect(limpiarTexto('x'.repeat(2001)).ok).toBe(false);
  });

  it('hace cuánto', () => {
    const ahora = Date.UTC(2026, 9, 26, 12, 0);
    expect(haceCuanto(new Date(ahora - 30_000).toISOString(), ahora)).toBe('Hace un momento');
    expect(haceCuanto(new Date(ahora - 5 * 60_000).toISOString(), ahora)).toBe('Hace 5 min');
    expect(haceCuanto(new Date(ahora - 3 * 86_400_000).toISOString(), ahora)).toBe('Hace 3 días');
  });
});
