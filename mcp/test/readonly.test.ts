import { describe, it, expect } from 'vitest';
import { assertReadOnlySql } from '../src/readonly.js';

describe('assertReadOnlySql — acepta solo lecturas', () => {
  it('acepta un SELECT simple', () => {
    expect(() => assertReadOnlySql('SELECT 1')).not.toThrow();
    expect(() => assertReadOnlySql('SELECT * FROM requests_general WHERE id = 1')).not.toThrow();
  });

  it('acepta SELECT sin importar mayúsculas/minúsculas ni espacios/saltos', () => {
    expect(() => assertReadOnlySql('   select   id  from  [case]  ')).not.toThrow();
    expect(() => assertReadOnlySql('\n  SeLeCt id\n FROM users\n')).not.toThrow();
  });

  it('acepta un CTE WITH ... SELECT', () => {
    const cte = `WITH t AS (SELECT id FROM requests_general) SELECT * FROM t`;
    expect(() => assertReadOnlySql(cte)).not.toThrow();
  });

  it('acepta un SELECT con un punto y coma final', () => {
    expect(() => assertReadOnlySql('SELECT 1;')).not.toThrow();
  });

  it('acepta comentarios de línea y de bloque alrededor de un SELECT', () => {
    expect(() => assertReadOnlySql('-- comentario\nSELECT 1')).not.toThrow();
    expect(() => assertReadOnlySql('/* nota */ SELECT 1')).not.toThrow();
  });
});

describe('assertReadOnlySql — rechaza escrituras y DDL', () => {
  const writes: [string, string][] = [
    ['INSERT', 'INSERT INTO requests_general (id) VALUES (1)'],
    ['UPDATE', 'UPDATE requests_general SET subject = 1 WHERE id = 1'],
    ['DELETE', 'DELETE FROM requests_general WHERE id = 1'],
    ['MERGE', 'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = 1'],
    ['DROP', 'DROP TABLE requests_general'],
    ['ALTER', 'ALTER TABLE requests_general ADD col INT'],
    ['TRUNCATE', 'TRUNCATE TABLE requests_general'],
    ['CREATE', 'CREATE TABLE x (id INT)'],
    ['GRANT', 'GRANT SELECT TO mcp'],
    ['EXEC', 'EXEC sp_who'],
    ['EXECUTE', 'EXECUTE sp_who'],
  ];

  for (const [verb, sql] of writes) {
    it(`rechaza ${verb}`, () => {
      expect(() => assertReadOnlySql(sql)).toThrow(/solo lectura/i);
    });
  }

  it('rechaza una mutación que empieza distinto de SELECT', () => {
    expect(() => assertReadOnlySql('UPDATE t SET a=1')).toThrow(
      /empiecen por SELECT/i
    );
  });

  it('rechaza una mutación escondida tras un comentario de bloque', () => {
    expect(() => assertReadOnlySql('/* SELECT */ DELETE FROM t')).toThrow(/solo lectura/i);
  });

  it('rechaza una escritura escondida en un comentario que termina la línea', () => {
    // El comentario de línea oculta el SELECT; lo que queda es el DROP.
    expect(() => assertReadOnlySql('-- SELECT 1\nDROP TABLE t')).toThrow(/solo lectura/i);
  });

  it('detecta la palabra clave sin importar mayúsculas/minúsculas', () => {
    expect(() => assertReadOnlySql('SELECT 1; delete from t')).toThrow(/solo lectura/i);
  });

  it('rechaza sentencias encadenadas (stacked) aunque empiecen por SELECT', () => {
    expect(() => assertReadOnlySql('SELECT 1; SELECT 2')).toThrow(/m.ltiples sentencias/i);
  });

  it('rechaza una consulta vacía', () => {
    expect(() => assertReadOnlySql('   ')).toThrow(/vac.a/i);
  });
});
