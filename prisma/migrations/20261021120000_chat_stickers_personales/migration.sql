/*
  Migración: chat_stickers_personales — «MIS STICKERS» en el chat (2026-10-21).
  Pedido de Nicolás Rivera (2026-10-20): cada persona carga sus propios stickers (WebP estático o
  animado) y puede PROPONERLOS a su empresa; un administrador los aprueba o los rechaza.

  SOLO ADITIVO e IDEMPOTENTE, se puede aplicar en caliente. Crea UNA tabla nueva y no altera ni copia
  nada existente (ni chat_sticker, ni chat_message_media, ni sus CHECK):

    - chat_sticker_personal  marca de «este sticker de chat_sticker es de una PERSONA» (id_user), con
                             su retiro (removed_at: deja de estar en «Mis stickers» pero los mensajes
                             ya enviados lo siguen mostrando) y la propuesta a la empresa
                             (propuesto → aprobado | rechazado). Al aprobar, el sticker se COPIA como
                             sticker de la empresa (fila nueva de chat_sticker con id_company) y su id
                             queda en id_sticker_company.

  La imagen vive en chat_sticker (mismo CHECK de tipo y de 512 KB). Un mensaje con un sticker personal
  usa provider 'empresa' + id_sticker, que el CHECK de chat_message_media ya admite.

  BLOQUE-DDL-INICIO (los scripts manuales de PRUEBAS y PROD repiten este bloque tal cual;
  lib/chat/__tests__/stickers-personales-sql.test.ts verifica que no se separen).
*/

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
