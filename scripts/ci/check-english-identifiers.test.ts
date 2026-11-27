import { describe, expect, it } from 'vitest';
import * as g from './check-english-identifiers.mjs';

const words = g.loadWords();

describe('English-only guard: Spanish detection', () => {
  it('splits identifiers into words', () => {
    expect(g.splitWords('guardarRutaAntesDeChat')).toEqual(['guardar', 'ruta', 'antes', 'de', 'chat']);
    expect(g.splitWords('OT_MARGEN_SUPERIOR_MAX_MM')).toEqual(['ot', 'margen', 'superior', 'max', 'mm']);
    expect(g.splitWords('HTMLParser2')).toEqual(['html', 'parser', '2']);
  });
  it('flags Spanish identifiers and keeps English ones', () => {
    expect(g.spanishReason('guardarRutaAntesDeChat', words)).toBe('guardar');
    expect(g.spanishReason('sinArticulo', words)).toBe('articulo');
    expect(g.spanishReason('avisos', words)).toBe('avisos');
    expect(g.spanishReason('año', words)).toBe('accent');
    expect(g.spanishReason('saveRouteBeforeChat', words)).toBeNull();
    expect(g.spanishReason('paras', words)).toBeNull();
    expect(g.spanishReason('data', words)).toBeNull();
    expect(g.spanishReason('todoList', words)).toBeNull();
  });
  it('reads comments and PR titles as Spanish prose only when they are', () => {
    expect(g.isSpanishProse('Guarda la ruta para volver cuando se cierra el chat')).toBe(true);
    expect(g.isSpanishProse('feat(sales): PO document side panel in the PDF offer review')).toBe(false);
    expect(g.isSpanishProse('Parses «la línea 2 es X» and «quita la línea 3» commands')).toBe(false);
  });
});

describe('English-only guard: lexers', () => {
  it('ignores strings, template text and comments in code', () => {
    const lx = g.lexJs("const saveRoute = 'guardar ruta'; // guardar\nconst x = `texto ${nombreUsuario} más`;\n");
    expect(lx.idents[1]).toEqual(['const', 'saveRoute']);
    expect(lx.comments[1]).toBe('guardar');
    expect(lx.idents[2]).toEqual(['const', 'x', 'nombreUsuario']);
  });
  it('drops JSX text and keeps the expressions', () => {
    const code = g.stripJsxText('<Text size="xs">Mostrar 100 más (se ven {simShown} de {total})</Text>');
    expect(code).toContain('simShown');
    expect(code).not.toContain('Mostrar');
    expect(g.stripJsxText('                Cronograma anual por {data.label}')).not.toContain('Cronograma');
    expect(g.stripJsxText('      Recordar')).not.toContain('Recordar');
  });
  it('reads DB names in Prisma @map and SQL brackets', () => {
    const p = g.lexPrisma('  marginTopMm Int? @map("margen_superior_mm")');
    expect(p.idents[1]).toContain('margen_superior_mm');
    const s = g.lexSql("ALTER TABLE dbo.[ot_registro] ADD [nota_texto] NVARCHAR(200) NULL; -- comentario\nSELECT 'texto' AS x");
    expect(s.idents[1]).toContain('nota_texto');
    expect(s.idents[2]).not.toContain('texto');
  });
  it('detects declarations', () => {
    expect(g.declares('  const avisos = [];', 'avisos', '.ts')).toBe(true);
    expect(g.declares('  avisos: string[];', 'avisos', '.ts')).toBe(true);
    expect(g.declares('  return d.avisos.join(" ");', 'avisos', '.ts')).toBe(false);
    expect(g.declares('ALTER TABLE dbo.x ADD nota NVARCHAR(10) NULL;', 'nota', '.sql')).toBe(true);
    expect(g.declares('  nota String? @db.NVarChar(10)', 'nota', '.prisma')).toBe(true);
  });
});
