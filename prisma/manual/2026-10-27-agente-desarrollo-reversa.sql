/*
  REVERSA — Agente de desarrollo en Proyectos (2026-10-27). Deshace
  prisma/migrations/20261027170000_agent_es_desarrollo y los scripts -PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa (el código nuevo lee la
  columna).

  QUÉ HACE (idempotente): quita la restricción agent_es_desarrollo_df y la columna agent.es_desarrollo.
  No se pierde nada más: la marca se vuelve a poner corriendo el script -PRUEBAS/-PROD.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51732, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'agent_es_desarrollo_df' AND parent_object_id = OBJECT_ID(N'dbo.agent'))
  ALTER TABLE [dbo].[agent] DROP CONSTRAINT [agent_es_desarrollo_df];

IF COL_LENGTH(N'dbo.agent', N'es_desarrollo') IS NOT NULL
  ALTER TABLE [dbo].[agent] DROP COLUMN [es_desarrollo];

SELECT DB_NAME() AS base, COL_LENGTH(N'dbo.agent', N'es_desarrollo') AS es_desarrollo_despues;
