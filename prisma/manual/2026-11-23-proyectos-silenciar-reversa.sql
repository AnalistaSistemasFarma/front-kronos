/*
  REVERSA: Proyectos — «Silenciar notificaciones» (2026-11-23, msg 38059).

  Borra dbo.chat_project_mute. Sin la tabla, el código de esta versión NO pasa verificar-esquema: se
  corre solo si se devuelve también el código (pase anterior). Se pierden los silencios que cada
  persona haya puesto (todos vuelven a recibir notificaciones, como antes). Si hay filas, se niega
  salvo con la bandera de sesión:
    EXEC sp_set_session_context N'proyectos_silenciar_reversa_acepta_perdida', 1;
  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 52304, N'Base no esperada: este script solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @filas INT = 0;
IF OBJECT_ID(N'dbo.chat_project_mute', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[chat_project_mute]', N'@n INT OUTPUT', @n = @filas OUTPUT;
SELECT DB_NAME() AS base, 'antes' AS momento, CASE WHEN OBJECT_ID(N'dbo.chat_project_mute', N'U') IS NULL THEN 0 ELSE 1 END AS existe_chat_project_mute, @filas AS filas;

IF @filas > 0 AND ISNULL(CAST(SESSION_CONTEXT(N'proyectos_silenciar_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 52305, N'chat_project_mute tiene filas (proyectos silenciados): use la bandera proyectos_silenciar_reversa_acepta_perdida para confirmar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.chat_project_mute', N'U') IS NOT NULL
    DROP TABLE [dbo].[chat_project_mute];
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, CASE WHEN OBJECT_ID(N'dbo.chat_project_mute', N'U') IS NULL THEN 0 ELSE 1 END AS existe_chat_project_mute;
