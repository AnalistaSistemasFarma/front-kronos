/*
  PASE MANUAL — "mensajes entre personas" + "zumbido" del chat de SynerLink.
  Aprobado por Nicolás Rivera el 2026-09-29.

  QUÉ ES: el DDL de las migraciones
    - 20260929120000_chat_people   (fase 1: hilos entre personas)
    - 20260929130000_chat_nudges   (fase 2: zumbido)
  en un solo archivo, para correrlo A MANO en la base antes del pase (las
  migraciones no corren en los despliegues: la base de producción no está
  baselined, P3005). Ver la memoria "correr-sql-servidores-front-kronos":
  script Node con `mssql` leyendo DATABASE_URL del .env, subido por scp y
  borrado al terminar.

  ⚠️ ORDEN OBLIGATORIO DEL PASE:
    1. Este script (DDL).          -> idempotente, aditivo, en caliente.
    2. prisma/seeds/chat-personas.sql (subproceso del piloto + centinela),
       ajustando @Emails a quienes van a probar.
    3. Recién entonces el código.  Si el código sale antes, TODO el chat falla
       con "Invalid column name" (Prisma lee todas las columnas del modelo).

  Se puede correr dos veces: cada bloque comprueba antes de escribir.
  Al final imprime el estado para comparar con el de antes.
*/

/* Estado ANTES */
SELECT 'antes' AS momento, name, definition FROM sys.check_constraints WHERE name = 'chat_conversation_kind_ck';
SELECT 'antes' AS momento, OBJECT_NAME(object_id) AS tabla, name AS columna
FROM sys.columns
WHERE object_id IN (OBJECT_ID(N'[dbo].[chat_conversation]'), OBJECT_ID(N'[dbo].[chat_message]'), OBJECT_ID(N'[dbo].[chat_participant]'))
  AND name IN ('dm_key', 'event_type', 'last_nudge_at', 'nudges_muted');

/* ==================================================================== */
/* FASE 1 — 20260929120000_chat_people                                   */
/* ==================================================================== */
BEGIN TRY

BEGIN TRAN;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_conversation]') AND name = 'dm_key'
)
BEGIN
  ALTER TABLE [dbo].[chat_conversation] ADD [dm_key] NVARCHAR(120) NULL;
END;

-- En su propio lote: el índice nombra una columna creada en ESTE lote (ver la
-- nota de EXEC en 20260908180000_add_chat_groups).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_chat_conversation_dm_key' AND object_id = OBJECT_ID(N'[dbo].[chat_conversation]'))
BEGIN
  EXEC(N'CREATE UNIQUE INDEX [UX_chat_conversation_dm_key]
      ON [dbo].[chat_conversation] ([dm_key])
      WHERE [dm_key] IS NOT NULL;');
END;

IF EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'chat_conversation_kind_ck' AND definition NOT LIKE '%people%'
)
BEGIN
  ALTER TABLE [dbo].[chat_conversation] DROP CONSTRAINT [chat_conversation_kind_ck];
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_conversation_kind_ck')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_conversation] WITH CHECK
    ADD CONSTRAINT [chat_conversation_kind_ck]
    CHECK ([kind] IN (''direct'', ''group'', ''people''));');
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

/* ==================================================================== */
/* FASE 2 — 20260929130000_chat_nudges                                   */
/* ==================================================================== */
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

/* Estado DESPUÉS */
SELECT 'despues' AS momento, name, definition FROM sys.check_constraints WHERE name = 'chat_conversation_kind_ck';
SELECT 'despues' AS momento, OBJECT_NAME(object_id) AS tabla, name AS columna
FROM sys.columns
WHERE object_id IN (OBJECT_ID(N'[dbo].[chat_conversation]'), OBJECT_ID(N'[dbo].[chat_message]'), OBJECT_ID(N'[dbo].[chat_participant]'))
  AND name IN ('dm_key', 'event_type', 'last_nudge_at', 'nudges_muted');
SELECT 'despues' AS momento, name AS indice FROM sys.indexes
WHERE name IN ('UX_chat_conversation_dm_key', 'chat_message_nudge_idx');
SELECT 'despues' AS momento, name, definition FROM sys.check_constraints WHERE name = 'chat_message_event_type_ck';
