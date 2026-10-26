/*
  Migración: proyectos_modulo — «Proyectos» pasa a ser un MÓDULO de SynerLink.
  Pedido de Nicolás Rivera del 2026-10-17 (por SynerLink). Sobre la F1
  (20261017120000_chat_projects). Ver el encabezado de ChatProject en schema.prisma.

  ADITIVO e IDEMPOTENTE, se puede aplicar en caliente:
    - chat_project.description NVARCHAR(1000) NULL.
    - chat_project_agent (agentes DESIGNADOS por proyecto) y la copia de la F1:
      cada proyecto queda con su agente de siempre designado (sin perder nada).
    - chat_project_member.role: owner / editor / reader. Los 'member' de la F1
      pasan a 'editor' (mismo poder que tenían). El CHECK admite 'member' como
      valor heredado mientras convivan el código de la F1 y el nuevo; el código
      nuevo lo lee como editor. El DEFAULT pasa a 'editor'.
    - chat_project_email y chat_project_request (vínculos con copia mínima).

  ⚠️ ORDEN DEL PASE: esta migración va ANTES que el código (Prisma lee las
  columnas y tablas nuevas). Con la migración aplicada, el código de la F1
  sigue funcionando: no lee nada nuevo y su 'member' sigue admitido.

  No corre en los despliegues: se aplica a mano con
    prisma/manual/2026-10-18-proyectos-modulo-PRUEBAS.sql  (incluye esto + permiso + migración de la F1)
    prisma/manual/2026-10-18-proyectos-modulo-PROD.sql     (incluye esto + permiso; NO correr sin visto bueno)
  Reversa: prisma/manual/2026-10-18-proyectos-modulo-reversa.sql.
  Registrarla como aplicada: npx prisma migrate resolve --applied 20261018120000_proyectos_modulo
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'[dbo].[chat_project]', N'U') IS NULL OR OBJECT_ID(N'[dbo].[chat_project_member]', N'U') IS NULL
  THROW 51480, N'Falta la migración 20261017120000_chat_projects (F1). Aplíquela primero.', 1;

BEGIN TRY

BEGIN TRAN;

/* ---- 1. chat_project.description ----------------------------------- */
IF COL_LENGTH(N'dbo.chat_project', N'description') IS NULL
  ALTER TABLE [dbo].[chat_project] ADD [description] NVARCHAR(1000) NULL;

/* ---- 2. chat_project_agent ----------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_project_agent]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_agent] (
    [id_project_agent] INT            IDENTITY(1,1) NOT NULL,
    [id_project]       INT            NOT NULL,
    [id_agent]         INT            NOT NULL,
    [added_by]         NVARCHAR(1000) NULL,
    [added_at]         DATETIME2      NOT NULL CONSTRAINT [chat_project_agent_added_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_agent_pkey] PRIMARY KEY CLUSTERED ([id_project_agent]),
    CONSTRAINT [chat_project_agent_project_agent] UNIQUE NONCLUSTERED ([id_project], [id_agent]),
    CONSTRAINT [chat_project_agent_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT [chat_project_agent_id_agent_fkey] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [chat_project_agent_id_agent_idx] ON [dbo].[chat_project_agent]([id_agent]);
END;

-- Migración de la F1: el agente de cada proyecto queda designado.
EXEC(N'INSERT INTO [dbo].[chat_project_agent] ([id_project], [id_agent], [added_by], [added_at])
  SELECT p.[id_project], p.[id_agent], p.[created_by], p.[created_at]
  FROM [dbo].[chat_project] p
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[chat_project_agent] pa WHERE pa.[id_project] = p.[id_project] AND pa.[id_agent] = p.[id_agent]);');

-- Y los agentes de conversaciones ya abiertas (por si alguna no era del agente del proyecto).
EXEC(N'INSERT INTO [dbo].[chat_project_agent] ([id_project], [id_agent], [added_by])
  SELECT DISTINCT c.[id_project], c.[id_agent], NULL
  FROM [dbo].[chat_conversation] c
  WHERE c.[kind] = ''project'' AND c.[id_project] IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM [dbo].[chat_project_agent] pa WHERE pa.[id_project] = c.[id_project] AND pa.[id_agent] = c.[id_agent]);');

/* ---- 3. Roles: owner / editor / reader ----------------------------- */
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_member_role_ck' AND definition NOT LIKE '%reader%')
  ALTER TABLE [dbo].[chat_project_member] DROP CONSTRAINT [chat_project_member_role_ck];

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_member_role_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_member] WITH CHECK ADD CONSTRAINT [chat_project_member_role_ck]
    CHECK ([role] IN (N''owner'', N''editor'', N''reader'', N''member''));');

EXEC(N'UPDATE [dbo].[chat_project_member] SET [role] = N''editor'' WHERE [role] = N''member'';');

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'chat_project_member_role_df' AND definition LIKE '%member%')
BEGIN
  ALTER TABLE [dbo].[chat_project_member] DROP CONSTRAINT [chat_project_member_role_df];
  ALTER TABLE [dbo].[chat_project_member] ADD CONSTRAINT [chat_project_member_role_df] DEFAULT N'editor' FOR [role];
END;

/* ---- 4. chat_project_email ----------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_project_email]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_email] (
    [id_project_email] INT            IDENTITY(1,1) NOT NULL,
    [id_project]       INT            NOT NULL,
    [mailbox]          NVARCHAR(254)  NOT NULL,
    [conversation_id]  NVARCHAR(512)  NOT NULL,
    [subject]          NVARCHAR(400)  NOT NULL,
    [sender_name]      NVARCHAR(200)  NULL,
    [sender_email]     NVARCHAR(254)  NULL,
    [last_message_at]  DATETIME2      NULL,
    [message_count]    INT            NULL,
    [summary]          NVARCHAR(500)  NULL,
    [linked_by]        NVARCHAR(1000) NOT NULL,
    [linked_at]        DATETIME2      NOT NULL CONSTRAINT [chat_project_email_linked_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_email_pkey] PRIMARY KEY CLUSTERED ([id_project_email]),
    CONSTRAINT [chat_project_email_project_thread] UNIQUE NONCLUSTERED ([id_project], [mailbox], [conversation_id]),
    CONSTRAINT [chat_project_email_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT [chat_project_email_linked_by_fkey] FOREIGN KEY ([linked_by]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [chat_project_email_linked_by_idx] ON [dbo].[chat_project_email]([linked_by]);
END;

-- El buzón se guarda siempre en minúsculas (así lo compara el código).
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_email_mailbox_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_email] WITH CHECK ADD CONSTRAINT [chat_project_email_mailbox_ck]
    CHECK ([mailbox] = LOWER([mailbox]) COLLATE Latin1_General_BIN AND [mailbox] LIKE N''%_@_%'');');

/* ---- 5. chat_project_request --------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_project_request]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_request] (
    [id_project_request] INT            IDENTITY(1,1) NOT NULL,
    [id_project]         INT            NOT NULL,
    [id_request]         INT            NOT NULL,
    [id_company]         INT            NOT NULL,
    [subject]            NVARCHAR(400)  NOT NULL,
    [process_name]       NVARCHAR(200)  NULL,
    [linked_by]          NVARCHAR(1000) NOT NULL,
    [linked_at]          DATETIME2      NOT NULL CONSTRAINT [chat_project_request_linked_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_request_pkey] PRIMARY KEY CLUSTERED ([id_project_request]),
    CONSTRAINT [chat_project_request_project_request] UNIQUE NONCLUSTERED ([id_project], [id_request]),
    CONSTRAINT [chat_project_request_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT [chat_project_request_linked_by_fkey] FOREIGN KEY ([linked_by]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [chat_project_request_id_request_idx] ON [dbo].[chat_project_request]([id_request]);
END;

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
