/*
  REVERSA — Módulo «Correo». Deshace la migración 20261015120000_correo_modulo y el
  script 2026-10-15-correo-permiso.sql:
    - quita los permisos otorgados (subprocess_user_company) del subproceso /process/correo,
    - borra el subproceso (el proceso «Solicitudes» NO se toca: es compartido),
    - borra el trigger y las tablas email_* (con sus datos).

  PÉRDIDA DE DATOS: si ya hay hilos vinculados o auditoría, el script se DETIENE salvo que
  la sesión declare que acepta perderlos (la auditoría es evidencia):
      EXEC sp_set_session_context N'correo_reversa_acepta_perdida', 1;
  Antes de eso, respalde las tablas email_thread_link, email_thread_message y email_audit.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51420, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

/* SQL dinámico: si la tabla ya no existe (segunda corrida) un SELECT directo fallaría. */
DECLARE @HayDatos BIT = 0;
IF OBJECT_ID(N'dbo.email_thread_link', N'U') IS NOT NULL AND OBJECT_ID(N'dbo.email_audit', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @h = CASE WHEN EXISTS (SELECT 1 FROM [dbo].[email_thread_link]) OR EXISTS (SELECT 1 FROM [dbo].[email_audit]) THEN 1 ELSE 0 END',
                     N'@h BIT OUTPUT', @h = @HayDatos OUTPUT;
IF @HayDatos = 1 AND ISNULL(CAST(SESSION_CONTEXT(N'correo_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51421, N'Hay hilos vinculados o auditoría del módulo Correo. Respalde email_* y declare correo_reversa_acepta_perdida = 1 para continuar.', 1;

SELECT DB_NAME() AS base, 'antes' AS momento, name AS objeto, type_desc FROM sys.objects
WHERE name LIKE N'email[_]%' OR name LIKE N'TR[_]email[_]%' ORDER BY name;

BEGIN TRY
  BEGIN TRANSACTION;

  DELETE suc FROM [dbo].[subprocess_user_company] suc
  JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
  WHERE s.subprocess_url = N'/process/correo';

  DELETE FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/correo';

  IF OBJECT_ID(N'dbo.TR_email_audit_inmutable', N'TR') IS NOT NULL DROP TRIGGER [dbo].[TR_email_audit_inmutable];
  IF OBJECT_ID(N'dbo.email_thread_message', N'U') IS NOT NULL DROP TABLE [dbo].[email_thread_message];
  IF OBJECT_ID(N'dbo.email_thread_link', N'U') IS NOT NULL DROP TABLE [dbo].[email_thread_link];
  IF OBJECT_ID(N'dbo.email_audit', N'U') IS NOT NULL DROP TABLE [dbo].[email_audit];

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, name AS objeto, type_desc FROM sys.objects
WHERE name LIKE N'email[_]%' OR name LIKE N'TR[_]email[_]%' ORDER BY name;
