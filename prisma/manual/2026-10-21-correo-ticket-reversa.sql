/*
  REVERSA — Correo · «Crear ticket» desde un hilo (2026-10-21). Deshace
  prisma/migrations/20261021200000_correo_ticket y los scripts -PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa.

  QUÉ HACE (idempotente): borra la tabla email_thread_case. Los TICKETS creados ([case],
  category_case) NO se tocan: siguen en la mesa de ayuda; solo se pierde la relación con el hilo.
  La auditoría (dbo.email_audit, acción CREAR_TICKET) tampoco se toca: es evidencia inmutable.

  PÉRDIDA DE DATOS: la relación hilo ↔ ticket. Si hay filas, el script se DETIENE salvo que la
  sesión declare que acepta perderlas:
      EXEC sp_set_session_context N'correo_ticket_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51543, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF OBJECT_ID(N'dbo.email_thread_case', N'U') IS NOT NULL
   AND ISNULL(CONVERT(INT, SESSION_CONTEXT(N'correo_ticket_reversa_acepta_perdida')), 0) <> 1
BEGIN
  DECLARE @n INT = 0;
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.email_thread_case', N'@n INT OUTPUT', @n = @n OUTPUT;
  IF @n > 0
    THROW 51544, N'Hay hilos relacionados con tickets. Respalde email_thread_case y declare correo_ticket_reversa_acepta_perdida = 1 en la sesión.', 1;
END;

BEGIN TRY
BEGIN TRAN;
IF OBJECT_ID(N'dbo.email_thread_case', N'U') IS NOT NULL DROP TABLE [dbo].[email_thread_case];
COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.email_thread_case', N'U') AS email_thread_case;
