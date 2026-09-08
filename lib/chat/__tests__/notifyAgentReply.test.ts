import { describe, expect, it } from 'vitest';
import { summarizeReply } from '../notifyAgentReply';

/**
 * Solo se prueba `summarizeReply`, que es la parte PURA: el resto de
 * notifyAgentReply es base de datos y push. Mismo criterio que
 * agent-keys.test.ts.
 */
describe('summarizeReply', () => {
  it('toma la primera línea con contenido', () => {
    expect(summarizeReply('\n\nPrimera de verdad.\nSegunda.', 0)).toBe('Primera de verdad.');
  });

  it('quita los adornos de Markdown, que en una notificación se ven como error', () => {
    expect(summarizeReply('## Resumen del **cierre** de mes', 0)).toBe('Resumen del cierre de mes');
    expect(summarizeReply('- revise el `.env` del servidor', 0)).toBe(
      'revise el .env del servidor'
    );
    expect(summarizeReply('> Ver [el informe](https://ejemplo.com/x)', 0)).toBe('Ver el informe');
  });

  it('recorta lo muy largo con puntos suspensivos', () => {
    const largo = 'a'.repeat(300);
    const out = summarizeReply(largo, 0);
    expect(out.length).toBe(140);
    expect(out.endsWith('…')).toBe(true);
  });

  it('describe los adjuntos cuando el mensaje no trae texto', () => {
    expect(summarizeReply('', 1)).toBe('Le envió un archivo.');
    expect(summarizeReply('   ', 3)).toBe('Le envió 3 archivos.');
    expect(summarizeReply('', 0)).toBe('Le respondió en el chat.');
  });

  it('anota los adjuntos que acompañan a un texto', () => {
    expect(summarizeReply('Aquí va el informe.', 2)).toBe('Aquí va el informe. (+2 archivos)');
    expect(summarizeReply('Aquí va el informe.', 1)).toBe('Aquí va el informe. (+1 archivo)');
  });
});
