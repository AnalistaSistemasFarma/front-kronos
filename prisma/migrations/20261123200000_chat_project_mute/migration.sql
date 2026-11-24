/*
  Migration: chat_project_mute — per-user "mute notifications" for a PROJECT — 2026-11-23.
  Request from Nicolás Rivera (SynerLink conv 1, msg 38059): «en los proyectos ayúdame a poder tener
  un botón de silenciar notificaciones». See lib/proyectos/mute.ts.

  ADDITIVE and IDEMPOTENT, safe to apply hot (the previous code does not read any of this):
    - chat_project_mute  one row per (project, person) = that person muted that project.
                         No row = notifications on (the default). Muting only affects that person.
  No data is copied or changed.

  BLOQUE-DDL-INICIO (the manual PRUEBAS and PROD scripts repeat this block verbatim;
  lib/proyectos/__tests__/mute-sql.test.ts checks they stay in sync).
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'[dbo].[chat_project]', N'U') IS NULL
  THROW 52301, N'Missing table dbo.chat_project (migration 20261017120000_chat_projects). Apply it first.', 1;

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[chat_project_mute]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_project_mute] (
    [id_project_mute] INT            IDENTITY(1,1) NOT NULL,
    [id_project]      INT            NOT NULL,
    [id_user]         NVARCHAR(1000) NOT NULL,
    [created_at]      DATETIME2      NOT NULL CONSTRAINT [chat_project_mute_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_project_mute_pkey] PRIMARY KEY CLUSTERED ([id_project_mute]),
    CONSTRAINT [chat_project_mute_id_project_fkey] FOREIGN KEY ([id_project]) REFERENCES [dbo].[chat_project]([id_project]) ON DELETE CASCADE ON UPDATE CASCADE
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_mute_project_user' AND object_id = OBJECT_ID(N'[dbo].[chat_project_mute]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [chat_project_mute_project_user] ON [dbo].[chat_project_mute]([id_project], [id_user]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_project_mute_id_user_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_project_mute]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_project_mute_id_user_idx] ON [dbo].[chat_project_mute]([id_user]);');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

/* BLOQUE-DDL-FIN */
