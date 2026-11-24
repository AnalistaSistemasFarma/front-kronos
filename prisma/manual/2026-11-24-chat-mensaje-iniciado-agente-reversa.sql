/*
  REVERSA: Chat — mensajes que un asistente envía por iniciativa propia (2026-11-24, msgs 38807–38809).

  Borra dbo.chat_agent_initiated_message. Los MENSAJES ya enviados se quedan en el chat (son filas normales
  de chat_message); se pierde su auditoría (motivo, llave), la insignia y el conteo de los topes. Sin la
  tabla, la herramienta chat_enviar_mensaje_usuario falla cerrada (no envía nada) y el resto del chat sigue
  igual (las lecturas de la insignia y del contexto toleran que la tabla falte). Si hay filas, se niega salvo
  con la bandera de sesión:
    EXEC sp_set_session_context N'chat_mensaje_iniciado_reversa_acepta_perdida', 1;
  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 52404, N'Base no esperada: este script solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @filas INT = 0;
IF OBJECT_ID(N'dbo.chat_agent_initiated_message', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[chat_agent_initiated_message]', N'@n INT OUTPUT', @n = @filas OUTPUT;
SELECT DB_NAME() AS base, 'antes' AS momento, CASE WHEN OBJECT_ID(N'dbo.chat_agent_initiated_message', N'U') IS NULL THEN 0 ELSE 1 END AS existe_chat_agent_initiated_message, @filas AS filas;

IF @filas > 0 AND ISNULL(CAST(SESSION_CONTEXT(N'chat_mensaje_iniciado_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 52405, N'chat_agent_initiated_message tiene filas (auditoría de mensajes enviados): use la bandera chat_mensaje_iniciado_reversa_acepta_perdida para confirmar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.chat_agent_initiated_message', N'U') IS NOT NULL
    DROP TABLE [dbo].[chat_agent_initiated_message];
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, CASE WHEN OBJECT_ID(N'dbo.chat_agent_initiated_message', N'U') IS NULL THEN 0 ELSE 1 END AS existe_chat_agent_initiated_message;
