/*
  REVERSA — Compras: autorización de solicitudes. Deshace
  prisma/manual/2026-10-21-compras-autorizacion-PRUEBAS.sql / -PROD.sql: borra
  dbo.purchase_authorization y dbo.purchase_company_config CON SUS DATOS.

  PÉRDIDA DE DATOS: purchase_authorization enlaza borradores SAP con sus autorizaciones.
  Si tiene filas, el script se DETIENE salvo que la sesión declare que acepta perderlas:
      EXEC sp_set_session_context N'compras_autorizacion_reversa_acepta_perdida', 1;
  No revierte nada en SAP ni en requests_general.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51472, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF OBJECT_ID(N'dbo.purchase_authorization', N'U') IS NOT NULL
  AND EXISTS (SELECT 1 FROM dbo.purchase_authorization)
  AND ISNULL(CONVERT(INT, SESSION_CONTEXT(N'compras_autorizacion_reversa_acepta_perdida')), 0) <> 1
  THROW 51473, N'Hay autorizaciones de compras registradas. Respáldelas y declare compras_autorizacion_reversa_acepta_perdida = 1.', 1;

BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.purchase_authorization', N'U') IS NOT NULL DROP TABLE dbo.purchase_authorization;
  IF OBJECT_ID(N'dbo.purchase_company_config', N'U') IS NOT NULL DROP TABLE dbo.purchase_company_config;
COMMIT TRANSACTION;
PRINT N'Reversa de la autorización de compras aplicada.';
