/*
  Migración: chat_nudges (fase 2 de "mensajes entre personas": el ZUMBIDO).
  Aprobado por Nicolás Rivera el 2026-09-29 (decisiones D4, D5 y D6).

  Un zumbido es un MENSAJE DE SISTEMA marcado con `event_type = 'nudge'`:
  queda en el hilo y en la auditoría, llega por el mismo sondeo y el límite
  anti-abuso se cuenta en SQL, así que funciona igual con las dos instancias
  de producción.

  ADITIVO, se puede aplicar en caliente:
    - chat_message.event_type       NVARCHAR(20) NULL, CHECK (NULL o 'nudge')
    - chat_message_nudge_idx        índice FILTRADO (solo filas con evento):
                                    (event_type, id_user_author, created_at)
                                    INCLUDE (id_conversation). Cubre el tope
                                    "10 cada 10 minutos por remitente" y el
                                    pulso global sin tocar la tabla.
    - chat_participant.last_nudge_at DATETIME2 NULL  (1 cada 30 s, UPDATE atómico)
    - chat_participant.nudges_muted  BIT NOT NULL DEFAULT 0 (silenciar el hilo)

  ⚠️ ORDEN DEL PASE: esta migración va ANTES que el código (Prisma lee todas
  las columnas del modelo). Se aplica a mano con
  prisma/manual/2026-09-29-chat-people.sql. Idempotente.

  Para registrarla como aplicada en una base que YA tiene estos cambios:
    npx prisma migrate resolve --applied 20260929130000_chat_nudges
*/

BEGIN TRY

BEGIN TRAN;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_message]') AND name = 'event_type'
)
BEGIN
  ALTER TABLE [dbo].[chat_message] ADD [event_type] NVARCHAR(20) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_message_event_type_ck')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_message] WITH CHECK
    ADD CONSTRAINT [chat_message_event_type_ck]
    CHECK ([event_type] IS NULL OR [event_type] IN (''nudge''));');
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_message_nudge_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_message]'))
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_message_nudge_idx]
      ON [dbo].[chat_message] ([event_type], [id_user_author], [created_at])
      INCLUDE ([id_conversation])
      WHERE [event_type] IS NOT NULL;');
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_participant]') AND name = 'last_nudge_at'
)
BEGIN
  ALTER TABLE [dbo].[chat_participant] ADD [last_nudge_at] DATETIME2 NULL;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_participant]') AND name = 'nudges_muted'
)
BEGIN
  ALTER TABLE [dbo].[chat_participant]
    ADD [nudges_muted] BIT NOT NULL
    CONSTRAINT [chat_participant_nudges_muted_df] DEFAULT 0;
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
