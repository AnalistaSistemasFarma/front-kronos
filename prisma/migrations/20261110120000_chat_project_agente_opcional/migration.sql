/*
  Migración: el ASISTENTE es OPCIONAL al crear un proyecto (2026-11-10).
  Pedido de Nicolás Rivera (SynerLink, 2026-11-10 11:34): «Juan Mora aún no puede crear proyectos.
  El tema de que se usen agentes para crear proyectos ahora debería ser opcional, que existan los
  2 caminos y que se puedan añadir después en el camino más agentes.»

  QUÉ HACE: chat_project.id_agent pasa de NOT NULL a NULL («agente con el que se creó»; NULL =
  proyecto creado sin asistente). El acceso de los agentes ya lo daba chat_project_agent (varios
  por proyecto), que no cambia. No toca ni copia datos: las 24 filas actuales conservan su agente.
  Para cambiar la nulabilidad, el índice chat_project_id_agent_archived_idx y la llave
  chat_project_id_agent_fkey se quitan y se vuelven a crear iguales, en UNA transacción.

  IDEMPOTENTE: si la columna ya admite NULL, no hace nada.

  ⚠️ ORDEN: ANTES del código. Con el código anterior, la columna NULL no estorba (siempre la llena).

  BLOQUE-DDL-INICIO (los scripts manuales de PRUEBAS y PROD repiten este bloque tal cual;
  lib/proyectos/__tests__/agente-opcional.test.ts verifica que no se separen).
*/

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
