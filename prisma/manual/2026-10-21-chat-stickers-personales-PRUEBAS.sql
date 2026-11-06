/*
  PASE MANUAL (PRUEBAS) — «Mis stickers» del chat (2026-10-21).
  NO lo corre el agente que hizo el PR: se corre con el visto bueno de Nicolás.

  QUÉ HACE (idempotente; solo crea lo que falta, no toca ni copia datos existentes):
    el MISMO bloque DDL de prisma/migrations/20261021120000_chat_stickers_personales/migration.sql:
    la tabla NUEVA chat_sticker_personal con sus índices y CHECK.

  REQUIERE: las tablas del #698 (chat_sticker) — 2026-10-20-chat-reacciones-stickers-PRUEBAS.sql antes.
  ORDEN: puede ir antes o después del código. Sin la tabla, «Mis stickers» responde «aún no
  disponible» y el resto del chat sigue igual (lib/chat/message-extras.ts tolera la tabla ausente).

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos») o SSMS,
  con respaldo COPY_ONLY antes. Después: npx prisma migrate resolve --applied 20261021120000_chat_stickers_personales
  REVERSA: prisma/manual/2026-10-21-chat-stickers-personales-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51530, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

IF OBJECT_ID(N'dbo.chat_sticker', N'U') IS NULL
  THROW 51532, N'Falta chat_sticker: corra primero el script de reacciones, GIF y stickers (2026-10-20).', 1;

SET XACT_ABORT ON;

BEGIN TRY

BEGIN TRAN;

/* ---- chat_sticker_personal ------------------------------------------- */
IF OBJECT_ID(N'[dbo].[chat_sticker_personal]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_sticker_personal] (
    [id_sticker]         INT            NOT NULL,
    [id_user]            NVARCHAR(1000) NOT NULL,
    [removed_at]         DATETIME2      NULL,
    [proposed_company]   INT            NULL,
    [proposal_state]     NVARCHAR(20)   NULL,
    [proposed_at]        DATETIME2      NULL,
    [reviewed_by]        NVARCHAR(1000) NULL,
    [reviewed_at]        DATETIME2      NULL,
    [id_sticker_company] INT            NULL,
    CONSTRAINT [chat_sticker_personal_pkey] PRIMARY KEY CLUSTERED ([id_sticker]),
    CONSTRAINT [chat_sticker_personal_id_sticker_fkey] FOREIGN KEY ([id_sticker]) REFERENCES [dbo].[chat_sticker]([id_sticker]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [chat_sticker_personal_id_user_fkey] FOREIGN KEY ([id_user]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [chat_sticker_personal_proposed_company_fkey] FOREIGN KEY ([proposed_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [chat_sticker_personal_reviewed_by_fkey] FOREIGN KEY ([reviewed_by]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [chat_sticker_personal_id_sticker_company_fkey] FOREIGN KEY ([id_sticker_company]) REFERENCES [dbo].[chat_sticker]([id_sticker]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_sticker_personal_user_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_sticker_personal]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_sticker_personal_user_idx] ON [dbo].[chat_sticker_personal]([id_user], [removed_at]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_sticker_personal_propuesta_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_sticker_personal]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_sticker_personal_propuesta_idx] ON [dbo].[chat_sticker_personal]([proposal_state], [proposed_company]);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_sticker_personal_estado_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_sticker_personal] WITH CHECK ADD CONSTRAINT [chat_sticker_personal_estado_ck] CHECK (([proposal_state] IS NULL AND [proposed_company] IS NULL) OR ([proposal_state] IN (N''propuesto'', N''aprobado'', N''rechazado'') AND [proposed_company] IS NOT NULL AND [proposed_at] IS NOT NULL));');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_sticker_personal_aprobado_ck')
  EXEC(N'ALTER TABLE [dbo].[chat_sticker_personal] WITH CHECK ADD CONSTRAINT [chat_sticker_personal_aprobado_ck] CHECK ([proposal_state] IS NULL OR [proposal_state] <> N''aprobado'' OR ([id_sticker_company] IS NOT NULL AND [reviewed_by] IS NOT NULL AND [reviewed_at] IS NOT NULL));');

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

/* BLOQUE-DDL-FIN */

SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.chat_sticker_personal', N'U') AS chat_sticker_personal;
