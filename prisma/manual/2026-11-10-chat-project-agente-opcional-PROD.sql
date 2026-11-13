/*
  PASE MANUAL (PROD) — El asistente es opcional al crear un proyecto (2026-11-10).

  QUÉ HACE (idempotente): el MISMO bloque DDL de
  prisma/migrations/20261110120000_chat_project_agente_opcional/migration.sql:
  chat_project.id_agent pasa a admitir NULL (se quitan y se recrean iguales su índice y su llave
  foránea, en una transacción). No modifica filas.

  RESPALDO: antes del DDL copia (id_project, id_agent) de todas las filas a
  dbo.zz_respaldo_chat_project_20261110 (solo si no existe). Se puede borrar tras validar.

  IMPACTO: solo la tabla chat_project (24 filas en prod el 2026-11-10). Bloqueo de esquema de
  milisegundos sobre chat_project; LOCK_TIMEOUT 5000 aborta si alguien la tiene tomada. No toca
  user, company_user ni nada del inicio de sesión.

  ORDEN: ANTES del código. REVERSA: prisma/manual/2026-11-10-chat-project-agente-opcional-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() <> N'KRONOSDB'
  THROW 51592, N'Base no esperada: este script es solo para KRONOSDB (producción).', 1;

IF OBJECT_ID(N'dbo.zz_respaldo_chat_project_20261110', N'U') IS NULL AND OBJECT_ID(N'dbo.chat_project', N'U') IS NOT NULL
  SELECT id_project, id_agent, SYSDATETIME() AS respaldado_en INTO [dbo].[zz_respaldo_chat_project_20261110] FROM [dbo].[chat_project];

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.chat_project', N'U') IS NULL
  THROW 51590, N'Falta la tabla chat_project (módulo de Proyectos).', 1;

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.chat_project') AND name = N'id_agent' AND is_nullable = 0)
BEGIN
  BEGIN TRANSACTION;
  -- SQL Server no deja cambiar la nulabilidad de una columna con índice o llave foránea:
  -- se quitan, se cambia la columna y se vuelven a crear IGUALES (mismo nombre y reglas).
  IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'chat_project_id_agent_fkey' AND parent_object_id = OBJECT_ID(N'dbo.chat_project'))
    ALTER TABLE [dbo].[chat_project] DROP CONSTRAINT [chat_project_id_agent_fkey];
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'chat_project_id_agent_archived_idx' AND object_id = OBJECT_ID(N'dbo.chat_project'))
    DROP INDEX [chat_project_id_agent_archived_idx] ON [dbo].[chat_project];
  ALTER TABLE [dbo].[chat_project] ALTER COLUMN [id_agent] INT NULL;
  CREATE NONCLUSTERED INDEX [chat_project_id_agent_archived_idx] ON [dbo].[chat_project]([id_agent], [archived]);
  ALTER TABLE [dbo].[chat_project] WITH CHECK ADD CONSTRAINT [chat_project_id_agent_fkey]
    FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  COMMIT;
END;

/* BLOQUE-DDL-FIN */

SELECT DB_NAME() AS base,
       (SELECT is_nullable FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.chat_project') AND name = N'id_agent') AS id_agent_admite_null,
       (SELECT COUNT(*) FROM sys.indexes WHERE name = N'chat_project_id_agent_archived_idx' AND object_id = OBJECT_ID(N'dbo.chat_project')) AS indice,
       (SELECT COUNT(*) FROM sys.foreign_keys WHERE name = N'chat_project_id_agent_fkey' AND is_not_trusted = 0) AS llave_confiable,
       (SELECT COUNT(*) FROM dbo.chat_project) AS filas,
       (SELECT COUNT(*) FROM dbo.zz_respaldo_chat_project_20261110) AS filas_respaldo;
