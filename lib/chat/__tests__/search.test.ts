import { describe, expect, it } from 'vitest';
import { extractoDeBusqueda } from '../search';

/**
 * El extracto es la parte del buscador que se rompe en silencio: si queda mal,
 * no falla nada — solo se ven resultados ilegibles o cortados donde no debía.
 */
describe('extractoDeBusqueda', () => {
  it('centra el extracto en la coincidencia y marca que hay más texto', () => {
    const cuerpo = `${'a'.repeat(200)} cargue masivo ${'b'.repeat(200)}`;
    const salida = extractoDeBusqueda(cuerpo, 'cargue');

    expect(salida).toContain('cargue');
    expect(salida.startsWith('…')).toBe(true);
    expect(salida.endsWith('…')).toBe(true);
  });

  it('no pone puntos suspensivos cuando el mensaje entero cabe', () => {
    const salida = extractoDeBusqueda('El cargue quedó listo', 'cargue');

    expect(salida).toBe('El cargue quedó listo');
  });

  it('encuentra sin importar mayúsculas ni tildes del término escrito', () => {
    expect(extractoDeBusqueda('Revisé el CARGUE de ayer', 'cargue')).toContain('CARGUE');
  });

  it('aplana el Markdown para que el extracto se lea en una línea', () => {
    const cuerpo = 'Mire el **cargue** en [la nota](https://ejemplo.com) y `revise.txt`';
    const salida = extractoDeBusqueda(cuerpo, 'cargue');

    expect(salida).toBe('Mire el cargue en la nota y revise.txt');
  });

  it('reemplaza los bloques de código en vez de volcarlos', () => {
    const cuerpo = 'Salida del cargue:\n```\nSELECT 1\nSELECT 2\n```\nlisto';
    const salida = extractoDeBusqueda(cuerpo, 'cargue');

    expect(salida).toContain('[código]');
    expect(salida).not.toContain('SELECT');
  });

  it('devuelve el principio del mensaje cuando el término no está en el texto plano', () => {
    // Pasa de verdad: el término puede estar solo dentro de la URL de un
    // enlace, que el aplanado descarta a propósito.
    const salida = extractoDeBusqueda('Vea [la nota](https://ejemplo.com/cargue)', 'cargue');

    expect(salida).toBe('Vea la nota');
  });

  it('no revienta con un mensaje vacío', () => {
    expect(extractoDeBusqueda('', 'cargue')).toBe('');
  });
});
