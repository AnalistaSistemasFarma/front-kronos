/*
  REVERSA — Auditoría de inicios de sesión. Deshace
  prisma/manual/2026-10-16-login-audit-PRUEBAS.sql / -PROD.sql (y la migración
  20261016200000_user_login_audit): quita el subproceso-permiso con sus asignaciones y
  borra dbo.user_login_audit CON SUS DATOS.

  PÉRDIDA DE DATOS: la tabla es evidencia de seguridad. Si tiene filas, el script se
  DETIENE salvo que la sesión declare que acepta perderlas:
      EXEC sp_set_session_context N'login_audit_reversa_acepta_perdida', 1;
  Antes de eso, respalde la tabla (o exporte a Excel desde la pantalla).

  Si solo quiere APAGAR el registro sin perder datos, no corra esto: basta con revertir el
  código (sin el envoltorio withLoginAudit nadie escribe en la tabla).

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51456, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF OBJECT_ID(N'dbo.user_login_audit', N'U') IS NOT NULL
  AND EXISTS (SELECT 1 FROM dbo.user_login_audit)
  AND ISNULL(CONVERT(INT, SESSION_CONTEXT(N'login_audit_reversa_acepta_perdida')), 0) <> 1
  THROW 51457, N'Hay inicios de sesión registrados. Respalde dbo.user_login_audit y declare login_audit_reversa_acepta_perdida = 1.', 1;

DECLARE @SubUrl NVARCHAR(255) = N'/process/administration/users/inicios-sesion';

BEGIN TRANSACTION;
  DELETE suc FROM [dbo].[subprocess_user_company] suc
  JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
  WHERE s.subprocess_url = @SubUrl;
  DELETE FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl;
  IF OBJECT_ID(N'dbo.user_login_audit', N'U') IS NOT NULL DROP TABLE dbo.user_login_audit;
COMMIT TRANSACTION;
PRINT N'Reversa de la auditoría de inicios de sesión aplicada.';
