import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../prisma', () => ({ prisma: {} }));
import { agentesDeNegocio, codigoPermitido, mensajeSoloDesarrollo, pideCodigo } from '../agentes-desarrollo-rules';
import { columnaNoExiste } from '../agentes-desarrollo';

/*
 * Agentes de desarrollo en Proyectos (2026-10-27): reglas puras y los scripts SQL del pase
 * (bloque DDL idéntico al de la migración, guardas DB_NAME(), marca SOLO horus/pedro, reversa
 * y el script de corrección de proyectos que por defecto solo LISTA).
 */
const leer = (rel: string) => readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8');
const bloque = (sql: string) => {
  const ini = sql.indexOf('SET XACT_ABORT ON;\n\nIF OBJECT_ID(N\'dbo.agent\'');
  const fin = sql.indexOf('/* BLOQUE-DDL-FIN */');
  expect(ini).toBeGreaterThan(-1);
  expect(fin).toBeGreaterThan(ini);
  return sql.slice(ini, fin).trim();
};
const MIGRACION = leer('prisma/migrations/20261027170000_agent_es_desarrollo/migration.sql');
const PRUEBAS = leer('prisma/manual/2026-10-27-agente-desarrollo-PRUEBAS.sql');
const PROD = leer('prisma/manual/2026-10-27-agente-desarrollo-PROD.sql');
const REVERSA = leer('prisma/manual/2026-10-27-agente-desarrollo-reversa.sql');
const CORRECCION = leer('prisma/manual/2026-10-27-proyectos-codigo-no-desarrollo.sql');

describe('reglas puras', () => {
  it('pideCodigo: nivel distinto de «ninguno» o algún repo', () => {
    expect(pideCodigo({ codeLevel: 'ninguno', repos: [] })).toBe(false);
    expect(pideCodigo({ codeLevel: 'ninguno' })).toBe(false);
    expect(pideCodigo({})).toBe(false);
    expect(pideCodigo({ codeLevel: 'lectura' })).toBe(true);
    expect(pideCodigo({ codeLevel: 'ninguno', repos: ['sapsend'] })).toBe(true);
  });

  it('codigoPermitido: solo si hay agentes y TODOS son de desarrollo', () => {
    const orus = { displayName: 'Orus', esDesarrollo: true };
    const play = { displayName: 'Play', esDesarrollo: false };
    expect(codigoPermitido([])).toBe(false);
    expect(codigoPermitido([orus])).toBe(true);
    expect(codigoPermitido([orus, play])).toBe(false);
    expect(agentesDeNegocio([orus, play])).toEqual([play]);
  });

  it('mensaje claro, en singular y en plural', () => {
    expect(mensajeSoloDesarrollo(['Play'])).toBe(
      'El acceso a código y los repositorios solo se asignan a agentes de desarrollo. Play no es agente de desarrollo: el proyecto queda en «Ninguno» y sin repositorios.'
    );
    expect(mensajeSoloDesarrollo(['Play', 'Lexa', 'Nancy'])).toContain('Play, Lexa y Nancy no son agentes de desarrollo');
    expect(mensajeSoloDesarrollo([])).toContain('Este proyecto no tiene agentes de desarrollo');
  });

  it('reconoce «la columna es_desarrollo no existe» (código antes que el DDL)', () => {
    expect(columnaNoExiste({ code: 'P2022' })).toBe(true);
    expect(columnaNoExiste(new Error("Invalid column name 'es_desarrollo'."))).toBe(true);
    expect(columnaNoExiste(new Error('timeout'))).toBe(false);
    expect(columnaNoExiste(null)).toBe(false);
  });
});

describe('scripts SQL', () => {
  it('PRUEBAS y PROD repiten TAL CUAL el bloque DDL de la migración', () => {
    expect(bloque(PRUEBAS)).toBe(bloque(MIGRACION));
    expect(bloque(PROD)).toBe(bloque(MIGRACION));
    expect(MIGRACION).toMatch(/ADD \[es_desarrollo\] BIT NOT NULL CONSTRAINT \[agent_es_desarrollo_df\] DEFAULT 0;/);
  });

  it('cada script se niega fuera de su base', () => {
    expect(PRUEBAS).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS', N'kronos_ci'\)\s+THROW/);
    expect(PROD).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB'\)\s+THROW/);
    expect(REVERSA).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci'\)\s+THROW/);
    expect(CORRECCION).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci'\)\s+THROW/);
  });

  it('marca SOLO a horus y pedro, por code, sin desmarcar a nadie', () => {
    for (const sql of [PRUEBAS, PROD]) {
      const updates = sql.match(/UPDATE \[dbo\]\.\[agent\][^;]*;/g) ?? [];
      expect(updates).toEqual(["UPDATE [dbo].[agent] SET [es_desarrollo] = 1 WHERE [code] IN (N''horus'', N''pedro'') AND [es_desarrollo] = 0;"]);
    }
  });

  it('la reversa quita la restricción y la columna', () => {
    expect(REVERSA).toContain('DROP CONSTRAINT [agent_es_desarrollo_df]');
    expect(REVERSA).toContain('DROP COLUMN [es_desarrollo]');
  });

  it('la corrección por defecto solo LISTA; ensayo deshace; aplicar exige quién autoriza y deja registro', () => {
    expect(CORRECCION).toMatch(/ISNULL\(CAST\(SESSION_CONTEXT\(N'proyectos_codigo_no_desarrollo_modo'\) AS NVARCHAR\(20\)\), N'listar'\)/);
    // Lo primero que puede escribir va DESPUÉS del RETURN del modo listar.
    const retorno = CORRECCION.indexOf("IF @modo = N'listar' OR NOT EXISTS (SELECT 1 FROM #afectados)\n  RETURN;");
    expect(retorno).toBeGreaterThan(-1);
    for (const dml of ['INSERT INTO dbo.chat_project_agent_policy ', 'UPDATE pol', 'DELETE r', 'INSERT INTO dbo.chat_project_agent_policy_log']) {
      expect(CORRECCION.indexOf(dml)).toBeGreaterThan(retorno);
    }
    expect(CORRECCION).toMatch(/IF @modo = N'aplicar'\s+COMMIT TRAN;\s+ELSE\s+ROLLBACK TRAN;/);
    expect(CORRECCION).toMatch(/IF @modo = N'aplicar' AND \(@actor IS NULL/);
    // Sin la columna (producción antes del pase), la lista fija horus/pedro.
    expect(CORRECCION).toContain("WHERE code IN (N'horus', N'pedro')");
  });
});
