/*
  PASE MANUAL (PROD) — Proyectos: «Silenciar notificaciones» por persona y proyecto. 2026-11-23.
  Pedido de Nicolás Rivera (SynerLink conv. 1, msg 38059).
  BASE: KRONOSDB (producción). El script se detiene en cualquier otra base.

  ⛔ NO CORRER sin el visto bueno explícito de Nicolás Rivera. ORDEN OBLIGATORIO en el pase:
  1) respaldo COPY_ONLY de KRONOSDB, 2) este script, 3) el código (schema.prisma agrega el modelo
  ChatProjectMute: verificar-esquema detiene el cambio de color si la tabla no existe).
  El script SOLO CREA una tabla nueva: el código anterior sigue funcionando con ella.

  QUÉ HACE: el DDL de prisma/migrations/20261123200000_chat_project_mute, nada más:
  crea dbo.chat_project_mute (una fila por proyecto y persona = esa persona silenció ese proyecto;
  sin fila = notificaciones activas, como hoy) con su único (proyecto, persona) y el índice por persona.
  No inserta filas. Aditivo e IDEMPOTENTE; informa antes y después.

  🔒 BLOQUEOS: crear una tabla nueva no bloquea tablas existentes (la FK a chat_project pide un
  bloqueo breve de esquema). LOCK_TIMEOUT 5000: si no lo consigue en 5 s hace ROLLBACK; vuelva a correrlo.
  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos») o SSMS.
  REVERSA: prisma/manual/2026-11-23-proyectos-silenciar-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 52303, N'Base no esperada para este script (PROD).', 1;

SELECT DB_NAME() AS base, 'antes' AS momento, CASE WHEN OBJECT_ID(N'dbo.chat_project_mute', N'U') IS NULL THEN 0 ELSE 1 END AS existe_chat_project_mute;

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

SELECT DB_NAME() AS base, 'despues' AS momento, CASE WHEN OBJECT_ID(N'dbo.chat_project_mute', N'U') IS NULL THEN 0 ELSE 1 END AS existe_chat_project_mute;
