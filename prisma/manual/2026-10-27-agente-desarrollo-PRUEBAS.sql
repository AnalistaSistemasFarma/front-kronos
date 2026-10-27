/*
  PASE MANUAL (PRUEBAS) — Agente de desarrollo en Proyectos (2026-10-27).
  Regla de Nicolás Rivera (2026-10-27, 16:08 COT): el nivel de código y los repositorios de un
  proyecto solo se asignan a AGENTES DE DESARROLLO.

  QUÉ HACE (idempotente):
    1. el MISMO bloque DDL de prisma/migrations/20261027170000_agent_es_desarrollo/migration.sql:
       agent.es_desarrollo BIT NOT NULL DEFAULT 0 (todos quedan «de negocio»);
    2. marca como de desarrollo SOLO a horus (Orus) y pedro (Pedro), por su code (los id_agent
       cambian entre PRUEBAS y producción). No desmarca a nadie.
  NO toca los permisos de los proyectos: los que ya tienen código con un agente de negocio se
  listan y corrigen con prisma/manual/2026-10-27-proyectos-codigo-no-desarrollo.sql.

  ORDEN: ANTES del código (el modelo Agent de Prisma lee la columna).
  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos»),
  con respaldo COPY_ONLY antes. REVERSA: prisma/manual/2026-10-27-agente-desarrollo-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51731, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS (o la base efímera de la CI).', 1;

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.agent', N'U') IS NULL
  THROW 51730, N'Falta la tabla agent (chat de agentes).', 1;

IF COL_LENGTH(N'dbo.agent', N'es_desarrollo') IS NULL
  ALTER TABLE [dbo].[agent] ADD [es_desarrollo] BIT NOT NULL CONSTRAINT [agent_es_desarrollo_df] DEFAULT 0;

/* BLOQUE-DDL-FIN */

-- La columna recién creada no existe al compilar este lote: la marca va en SQL dinámico.
EXEC sp_executesql N'UPDATE [dbo].[agent] SET [es_desarrollo] = 1 WHERE [code] IN (N''horus'', N''pedro'') AND [es_desarrollo] = 0;';

EXEC sp_executesql N'SELECT DB_NAME() AS base, a.id_agent, a.code, a.display_name, a.es_desarrollo
  FROM [dbo].[agent] a WHERE a.es_desarrollo = 1 ORDER BY a.id_agent;';
