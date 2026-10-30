/*
  REVERSA — Memorias de los agentes (2026-10-29).
  Deshace 2026-10-29-memorias-agentes-PRUEBAS.sql / -PROD.sql.

  ORDEN: primero el CÓDIGO anterior (o se deja: sin las tablas la pantalla dice «aún no
  habilitado» y el POST del recolector responde 503) y DESPUÉS esta reversa.

  PÉRDIDA DE DATOS: las memorias recolectadas (se vuelven a recolectar en la siguiente corrida),
  los enlaces, las corridas y los ajustes por agente (departamento y dueño de los personales).

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51573, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

BEGIN TRY
BEGIN TRAN;

IF OBJECT_ID(N'dbo.agent_memory_link', N'U') IS NOT NULL DROP TABLE [dbo].[agent_memory_link];
IF OBJECT_ID(N'dbo.agent_memory', N'U') IS NOT NULL DROP TABLE [dbo].[agent_memory];
IF OBJECT_ID(N'dbo.agent_memory_setting', N'U') IS NOT NULL DROP TABLE [dbo].[agent_memory_setting];
IF OBJECT_ID(N'dbo.agent_memory_run', N'U') IS NOT NULL DROP TABLE [dbo].[agent_memory_run];

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.agent_memory', N'U') AS agent_memory,
       OBJECT_ID(N'dbo.agent_memory_link', N'U') AS agent_memory_link,
       OBJECT_ID(N'dbo.agent_memory_setting', N'U') AS agent_memory_setting,
       OBJECT_ID(N'dbo.agent_memory_run', N'U') AS agent_memory_run;
