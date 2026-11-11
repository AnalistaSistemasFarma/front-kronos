/*
  REVERSA — El asistente es opcional al crear un proyecto (2026-11-10). Deshace
  prisma/migrations/20261110120000_chat_project_agente_opcional y los scripts -PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa.

  QUÉ HACE (idempotente): a los proyectos con id_agent NULL que YA tienen asistentes les pone el
  primero que se agregó (chat_project_agent, el mismo dato que guarda el código nuevo), y vuelve
  la columna a NOT NULL (índice y llave se recrean iguales). Si queda algún proyecto SIN ningún
  asistente, se niega: el código anterior exige uno. Agréguele un asistente (o archívelo y
  asígnelo a mano) antes de correrla.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51593, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.chat_project') AND name = N'id_agent' AND is_nullable = 1)
BEGIN
  BEGIN TRANSACTION;
  UPDATE p SET p.id_agent = (SELECT TOP 1 pa.id_agent FROM dbo.chat_project_agent pa WHERE pa.id_project = p.id_project ORDER BY pa.added_at, pa.id_project_agent)
    FROM dbo.chat_project p
   WHERE p.id_agent IS NULL AND EXISTS (SELECT 1 FROM dbo.chat_project_agent pa WHERE pa.id_project = p.id_project);
  IF EXISTS (SELECT 1 FROM dbo.chat_project WHERE id_agent IS NULL)
    THROW 51594, N'Hay proyectos sin ningún asistente: agrégueles uno antes de la reversa (el código anterior exige uno).', 1;
  IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'chat_project_id_agent_fkey' AND parent_object_id = OBJECT_ID(N'dbo.chat_project'))
    ALTER TABLE [dbo].[chat_project] DROP CONSTRAINT [chat_project_id_agent_fkey];
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'chat_project_id_agent_archived_idx' AND object_id = OBJECT_ID(N'dbo.chat_project'))
    DROP INDEX [chat_project_id_agent_archived_idx] ON [dbo].[chat_project];
  ALTER TABLE [dbo].[chat_project] ALTER COLUMN [id_agent] INT NOT NULL;
  CREATE NONCLUSTERED INDEX [chat_project_id_agent_archived_idx] ON [dbo].[chat_project]([id_agent], [archived]);
  ALTER TABLE [dbo].[chat_project] WITH CHECK ADD CONSTRAINT [chat_project_id_agent_fkey]
    FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  COMMIT;
END;

SELECT DB_NAME() AS base,
       (SELECT is_nullable FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.chat_project') AND name = N'id_agent') AS id_agent_admite_null,
       (SELECT COUNT(*) FROM dbo.chat_project) AS filas;
