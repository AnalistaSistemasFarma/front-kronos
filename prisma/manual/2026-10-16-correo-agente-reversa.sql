/*
  REVERSA — Correo · «Consultar a un agente». Deshace la migración
  20261016100000_correo_agente: borra email_agent_action y email_agent_share (con sus datos).
  La auditoría (dbo.email_audit) NO se toca: es evidencia inmutable.

  PÉRDIDA DE DATOS: si ya hay concesiones, el script se DETIENE salvo que la sesión declare
  que acepta perderlas:
      EXEC sp_set_session_context N'correo_agente_reversa_acepta_perdida', 1;
  Antes de eso, respalde las dos tablas.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51431, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF OBJECT_ID(N'dbo.email_agent_share', N'U') IS NOT NULL
  AND EXISTS (SELECT 1 FROM dbo.email_agent_share)
  AND ISNULL(CONVERT(INT, SESSION_CONTEXT(N'correo_agente_reversa_acepta_perdida')), 0) <> 1
  THROW 51432, N'Hay concesiones registradas. Respalde email_agent_share/email_agent_action y declare correo_agente_reversa_acepta_perdida = 1.', 1;

BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.email_agent_action', N'U') IS NOT NULL DROP TABLE dbo.email_agent_action;
  IF OBJECT_ID(N'dbo.email_agent_share', N'U') IS NOT NULL DROP TABLE dbo.email_agent_share;
COMMIT TRANSACTION;
PRINT N'Reversa de Correo · agente aplicada.';
