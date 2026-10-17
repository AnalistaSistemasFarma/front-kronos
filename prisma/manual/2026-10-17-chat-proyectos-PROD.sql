/*
  PASE MANUAL (PRODUCCIÓN) — Proyectos (hilos de agente) del chat. 2026-10-17.
  BASE: KRONOSDB (el script se detiene en cualquier otra base).

  ⛔ NO CORRER sin el visto bueno explícito de Nicolás Rivera. La F1 es un
  piloto SOLO en PRUEBAS; este archivo queda listo para cuando se decida
  pasar a producción.

  QUÉ HACE: el DDL de prisma/migrations/20261017120000_chat_projects, nada
  más. NO siembra proyectos ni toca permisos. Aditivo e idempotente. El
  módulo queda APAGADO hasta que el .env de producción tenga
  CHAT_PROJECTS_AGENTS (sin esa variable, las rutas responden 404).

  ⚠️ ORDEN OBLIGATORIO: 1) respaldo COPY_ONLY, 2) este script, 3) el código.
  Si el código sale antes, TODO el chat falla con "Invalid column name".

  🔒 BLOQUEOS: ALTER TABLE sobre chat_conversation pide Sch-M. Con
  LOCK_TIMEOUT 5000 el script se rinde a los 5 s si la tabla está tomada
  (error 1222) y hace ROLLBACK completo: vuelva a correrlo, es idempotente.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-
  front-kronos») o SSMS. REVERSA: prisma/manual/2026-10-17-chat-proyectos-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51470, N'Base no esperada: este script es solo para KRONOSDB.', 1;

SELECT DB_NAME() AS base, 'antes' AS momento,
       OBJECT_ID(N'dbo.chat_project', N'U') AS chat_project_id,
       (SELECT definition FROM sys.check_constraints WHERE name = 'chat_conversation_kind_ck') AS kind_ck;

BEGIN TRY
BEGIN TRANSACTION;

/* ---- 1. chat_project ------------------------------------------------ */
IF OBJECT_ID(N'[dbo].[chat_project]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project] (
    [id_project]   INT            IDENTITY(1,1) NOT NULL,
    [name]         NVARCHAR(120)  NOT NULL,
    [id_agent]     INT            NOT NULL,
    [id_company]   INT            NOT NULL,
    [profile]      NVARCHAR(40)   NOT NULL,
    [instructions] NVARCHAR(MAX)  NULL,
    [created_by]   NVARCHAR(1000) NOT NULL,
    [archived]     BIT            NOT NULL CONSTRAINT [chat_project_archived_df] DEFAULT 0,
    [created_at]   DATETIME2      NOT NULL CONSTRAINT [chat_project_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at]   DATETIME2      NOT NULL CONSTRAINT [chat_project_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_pkey] PRIMARY KEY CLUSTERED ([id_project]),
    CONSTRAINT [chat_project_id_agent_fkey] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [chat_project_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [chat_project_created_by_fkey] FOREIGN KEY ([created_by]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [chat_project_id_agent_archived_idx] ON [dbo].[chat_project]([id_agent], [archived]);
  CREATE NONCLUSTERED INDEX [chat_project_id_company_idx] ON [dbo].[chat_project]([id_company]);
END;

/* ---- 2. chat_project_member ----------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_project_member]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_member] (
    [id_project_member] INT            IDENTITY(1,1) NOT NULL,
    [id_project]        INT            NOT NULL,
    [id_user]           NVARCHAR(1000) NOT NULL,
    [role]              NVARCHAR(20)   NOT NULL CONSTRAINT [chat_project_member_role_df] DEFAULT N'member',
    [added_by]          NVARCHAR(1000) NULL,
    [added_at]          DATETIME2      NOT NULL CONSTRAINT [chat_project_member_added_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_member_pkey] PRIMARY KEY CLUSTERED ([id_project_member]),
    CONSTRAINT [chat_project_member_project_user] UNIQUE NONCLUSTERED ([id_project], [id_user]),
    CONSTRAINT [chat_project_member_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT [chat_project_member_id_user_fkey] FOREIGN KEY ([id_user]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [chat_project_member_id_user_idx] ON [dbo].[chat_project_member]([id_user]);
END;

/* ---- 2b. Reglas de integridad (bloques propios: también se aplican si
   las tablas las creó `prisma db push`, que no conoce CHECK ni índices
   filtrados) ---------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_name_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project] WITH CHECK ADD CONSTRAINT [chat_project_name_ck]
    CHECK (LEN(LTRIM(RTRIM([name]))) > 0);');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_profile_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project] WITH CHECK ADD CONSTRAINT [chat_project_profile_ck]
    CHECK (LEN([profile]) > 0 AND [profile] COLLATE Latin1_General_BIN NOT LIKE N''%[^a-z0-9-]%'');');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_project_member_role_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_project_member] WITH CHECK ADD CONSTRAINT [chat_project_member_role_ck]
    CHECK ([role] IN (N''owner'', N''member''));');

-- UN solo dueño por proyecto, garantizado por la base y no por cada endpoint.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_chat_project_member_owner' AND object_id = OBJECT_ID(N'[dbo].[chat_project_member]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [UX_chat_project_member_owner]
    ON [dbo].[chat_project_member]([id_project]) WHERE [role] = N''owner'';');

/* ---- 3. chat_project_file ------------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_project_file]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_file] (
    [id_project_file]  INT            IDENTITY(1,1) NOT NULL,
    [id_project]       INT            NOT NULL,
    [file_name]        NVARCHAR(400)  NOT NULL,
    [content_type]     NVARCHAR(200)  NULL,
    [size_bytes]       INT            NULL,
    [onedrive_item_id] NVARCHAR(300)  NULL,
    [uploaded_by]      NVARCHAR(1000) NULL,
    [created_at]       DATETIME2      NOT NULL CONSTRAINT [chat_project_file_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_file_pkey] PRIMARY KEY CLUSTERED ([id_project_file]),
    CONSTRAINT [chat_project_file_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE NONCLUSTERED INDEX [chat_project_file_id_project_idx] ON [dbo].[chat_project_file]([id_project]);
END;

/* ---- 4. chat_conversation: id_project + CHECKs ---------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[chat_conversation]') AND name = 'id_project')
BEGIN
  ALTER TABLE [dbo].[chat_conversation] ADD [id_project] INT NULL;
END;

-- En lotes propios (EXEC): nombran una columna creada en ESTE lote.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'chat_conversation_id_project_fkey')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_conversation] WITH CHECK
    ADD CONSTRAINT [chat_conversation_id_project_fkey]
    FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE NO ACTION ON UPDATE NO ACTION;');
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_conversation_id_project_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_conversation]'))
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_conversation_id_project_idx] ON [dbo].[chat_conversation]([id_project]);');
END;

-- La clase 'project' entra al CHECK de kind (se reemplaza solo si aún no la admite).
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_conversation_kind_ck' AND definition NOT LIKE '%project%')
BEGIN
  ALTER TABLE [dbo].[chat_conversation] DROP CONSTRAINT [chat_conversation_kind_ck];
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_conversation_kind_ck')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_conversation] WITH CHECK
    ADD CONSTRAINT [chat_conversation_kind_ck]
    CHECK ([kind] IN (''direct'', ''group'', ''people'', ''project''));');
END;

-- Una conversación de proyecto SIEMPRE tiene proyecto, y ninguna otra lo tiene.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_conversation_project_ck')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_conversation] WITH CHECK
    ADD CONSTRAINT [chat_conversation_project_ck]
    CHECK (([kind] = ''project'' AND [id_project] IS NOT NULL) OR ([kind] <> ''project'' AND [id_project] IS NULL));');
END;

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento,
       OBJECT_ID(N'dbo.chat_project', N'U') AS chat_project_id,
       (SELECT definition FROM sys.check_constraints WHERE name = 'chat_conversation_kind_ck') AS kind_ck,
       (SELECT definition FROM sys.check_constraints WHERE name = 'chat_conversation_project_ck') AS project_ck;
