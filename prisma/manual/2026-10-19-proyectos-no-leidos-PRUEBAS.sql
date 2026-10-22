/*
  PASE MANUAL — Mensajes no leídos de las conversaciones de «Proyectos» (icono de la cabecera,
  2026-10-19) — SOLO KRONOSDB_PRUEBAS (o la base efímera de la CI).
  Pedido de Nicolás Rivera del 2026-10-19. NO lo corre el agente que hizo el PR: se corre en el pase,
  con el visto bueno de Nicolás.

  PRERREQUISITO (si falta, el script se detiene sin escribir nada):
    prisma/migrations/20261017120000_chat_projects (chat_conversation.id_project, PR #662).

  QUÉ HACE (idempotente; solo crea lo que falta, no toca datos existentes):
    el MISMO bloque DDL de prisma/migrations/20261019140000_proyectos_no_leidos/migration.sql:
    la tabla chat_project_read (marca de agua de lectura por conversación de proyecto y persona),
    su índice único (conversación, persona), su índice por persona y un CHECK (marca >= 0).
    No otorga permisos ni copia datos. Al estrenarla nadie tiene fila: lo que ya hay en las
    conversaciones de proyecto cuenta como nuevo hasta que cada miembro las abra.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos»),
  con respaldo COPY_ONLY antes. Después: npx prisma migrate resolve --applied 20261019140000_proyectos_no_leidos
  REVERSA: prisma/manual/2026-10-19-proyectos-no-leidos-reversa.sql
*/

SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51503, N'Base no esperada: este script solo corre en KRONOSDB_PRUEBAS (o la base efímera de la CI).', 1;

SET XACT_ABORT ON;

IF COL_LENGTH(N'dbo.chat_conversation', N'id_project') IS NULL
  THROW 51502, N'Falta la migración 20261017120000_chat_projects (chat_conversation.id_project). Aplíquela primero.', 1;

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[chat_project_read]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_read] (
    [id_project_read]      INT            IDENTITY(1,1) NOT NULL,
    [id_conversation]      INT            NOT NULL,
    [id_user]              NVARCHAR(1000) NOT NULL,
    [last_read_message_id] INT            NOT NULL,
    [updated_at]           DATETIME2      NOT NULL CONSTRAINT [chat_project_read_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_read_pkey] PRIMARY KEY CLUSTERED ([id_project_read]),
    CONSTRAINT [chat_project_read_id_conversation_fkey] FOREIGN KEY ([id_conversation]) REFERENCES [dbo].[chat_conversation]([id]) ON DELETE CASCADE ON UPDATE CASCADE
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_read_conversation_user' AND object_id = OBJECT_ID(N'[dbo].[chat_project_read]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [chat_project_read_conversation_user] ON [dbo].[chat_project_read]([id_conversation], [id_user]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_read_id_user_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_read]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_read_id_user_idx] ON [dbo].[chat_project_read]([id_user]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_read_last_read_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_read] WITH CHECK ADD CONSTRAINT [chat_project_read_last_read_ck] CHECK ([last_read_message_id] >= 0);');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
  (SELECT COUNT(*) FROM [dbo].[chat_project_read]) AS lecturas,
  CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_read_conversation_user' AND is_unique = 1) THEN 1 ELSE 0 END AS indice_unico;
