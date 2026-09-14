/*
  Migración: chat_message_reply_to
  Módulo Chat — CITAR Y RESPONDER un mensaje. Pedido de Nicolás el 2026-09-09:
  "en algunos softwares uno puede citar mensajes; en móvil uno hace el gesto de
  tomar el mensaje hacia la derecha y el input cita ese mensaje, en desktop
  clic derecho y responder o citar".

  ATENCIÓN: generada MANUALMENTE, mismo patrón que las anteriores de este
  repositorio (sin permiso de shadow database en este entorno — P3014).

  Qué agrega (100% ADITIVA — una columna nullable, su índice y su FK):
    - chat_message.id_reply_to (INT NULL): el mensaje al que responde. NULL =
      mensaje normal, que es la enorme mayoría.

  POR QUÉ NORMALIZADO Y NO COPIANDO EL TEXTO CITADO. Guardar el extracto en la
  fila (como hace algún cliente de mensajería) evitaría el JOIN, pero congela
  la cita: si el original se corrige, la cita sigue diciendo lo viejo. Y de
  todas formas hace falta el id para poder SALTAR al original, que es la mitad
  de la función. Con la FK, además, la base no deja citar un mensaje que no
  existe.

  LA FK VA CON NO ACTION, NO CON CASCADE, y es a propósito:
    - Es una FK a la MISMA tabla. Un CASCADE sobre sí misma lo rechaza SQL
      Server en cuanto hay más de un camino de borrado, y aquí ya existe uno:
      chat_message.id_conversation borra en cascada desde chat_conversation.
    - Hoy la aplicación NO borra mensajes ni conversaciones (no hay ninguna
      llamada a delete sobre esas tablas). Si algún día se agrega, esta FK hará
      que el borrado FALLE de forma ruidosa en vez de dejar citas apuntando al
      vacío — que es justo lo que uno quiere descubrir en el momento y no
      meses después.

  Idempotente: se puede re-correr sin efecto.
*/

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_message]') AND name = N'id_reply_to'
)
BEGIN
  ALTER TABLE [dbo].[chat_message] ADD [id_reply_to] INT NULL;
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_message]')
    AND name = N'chat_message_id_reply_to_idx'
)
BEGIN
  CREATE NONCLUSTERED INDEX [chat_message_id_reply_to_idx]
    ON [dbo].[chat_message]([id_reply_to]);
END

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'chat_message_id_reply_to_fkey'
    AND parent_object_id = OBJECT_ID(N'[dbo].[chat_message]')
)
BEGIN
  ALTER TABLE [dbo].[chat_message]
    ADD CONSTRAINT [chat_message_id_reply_to_fkey]
    FOREIGN KEY ([id_reply_to]) REFERENCES [dbo].[chat_message]([id])
    ON DELETE NO ACTION ON UPDATE NO ACTION;
END
