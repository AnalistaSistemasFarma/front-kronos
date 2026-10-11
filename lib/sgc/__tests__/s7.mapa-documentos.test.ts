import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * S7 (2026-10-08): «Mapa de procesos» se llama «Mapa de documentos» en la pantalla
 * (recomendación de la Dra. Ana Lucía en la socialización del 2026-10-07).
 * Solo cambian los rótulos: la ruta /mapa y los nombres internos se conservan.
 */
const ROOT = join(__dirname, '../../..');
const PAGES = [
  'app/(hub)/process/sgc-documental/page.tsx',
  'app/(hub)/process/sgc-documental/mapa/page.tsx',
  'app/(hub)/process/sgc-documental/listado/page.tsx',
];

describe('SGC · «Mapa de documentos»', () => {
  it.each(PAGES)('%s no muestra «Mapa de procesos»', (rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    // Se ignoran los comentarios de bloque/línea; se revisan los textos visibles.
    const visible = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(visible).not.toMatch(/mapa de procesos/i);
  });

  it('el tablero, la miga de pan y el listado dicen «Mapa de documentos»', () => {
    const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
    expect(read(PAGES[0])).toContain("title: 'Mapa de documentos'");
    expect(read(PAGES[1])).toContain("section='Mapa de documentos'");
    expect(read(PAGES[2])).toContain('Mapa de documentos');
  });
});
