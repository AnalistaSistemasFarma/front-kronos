/*
  REVERSA: Proyectos — «Reuniones» del proyecto y análisis con el agente (2026-11-24, msg 38206).

  Borra dbo.chat_project_meeting_analysis, dbo.chat_project_meeting_rule y dbo.chat_project_meeting (en ese
  orden). Sin las tablas, el código de esta versión NO pasa verificar-esquema: se corre solo si se devuelve
  también el código (pase anterior). Se pierden las reuniones asignadas, las reglas de serie y los análisis
  (las propuestas de tarea que ya se crearon en el cronograma NO se tocan). Si hay filas, se niega salvo
  con la bandera de sesión:
    EXEC sp_set_session_context N'proyectos_reuniones_reversa_acepta_perdida', 1;
  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 52404, N'Base no esperada: este script solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @filas INT = 0, @n INT = 0;
IF OBJECT_ID(N'dbo.chat_project_meeting', N'U') IS NOT NULL
BEGIN
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[chat_project_meeting]', N'@n INT OUTPUT', @n = @n OUTPUT;
  SET @filas += @n;
END;
IF OBJECT_ID(N'dbo.chat_project_meeting_rule', N'U') IS NOT NULL
BEGIN
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[chat_project_meeting_rule]', N'@n INT OUTPUT', @n = @n OUTPUT;
  SET @filas += @n;
END;
SELECT DB_NAME() AS base, 'antes' AS momento, CASE WHEN OBJECT_ID(N'dbo.chat_project_meeting', N'U') IS NULL THEN 0 ELSE 1 END AS existe_meeting, CASE WHEN OBJECT_ID(N'dbo.chat_project_meeting_rule', N'U') IS NULL THEN 0 ELSE 1 END AS existe_rule, CASE WHEN OBJECT_ID(N'dbo.chat_project_meeting_analysis', N'U') IS NULL THEN 0 ELSE 1 END AS existe_analysis, @filas AS filas;

IF @filas > 0 AND ISNULL(CAST(SESSION_CONTEXT(N'proyectos_reuniones_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 52405, N'Hay reuniones asignadas o reglas de serie: use la bandera proyectos_reuniones_reversa_acepta_perdida para confirmar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.chat_project_meeting_analysis', N'U') IS NOT NULL
    DROP TABLE [dbo].[chat_project_meeting_analysis];
  IF OBJECT_ID(N'dbo.chat_project_meeting_rule', N'U') IS NOT NULL
    DROP TABLE [dbo].[chat_project_meeting_rule];
  IF OBJECT_ID(N'dbo.chat_project_meeting', N'U') IS NOT NULL
    DROP TABLE [dbo].[chat_project_meeting];
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, CASE WHEN OBJECT_ID(N'dbo.chat_project_meeting', N'U') IS NULL THEN 0 ELSE 1 END AS existe_meeting, CASE WHEN OBJECT_ID(N'dbo.chat_project_meeting_rule', N'U') IS NULL THEN 0 ELSE 1 END AS existe_rule, CASE WHEN OBJECT_ID(N'dbo.chat_project_meeting_analysis', N'U') IS NULL THEN 0 ELSE 1 END AS existe_analysis;
