/*
  REVERSA — Acceso con biométrico (passkeys). Deshace prisma/manual/2026-10-31-passkeys-PRUEBAS.sql /
  -PROD.sql (y la migración 20261031150000_user_passkey):
    1. Borra dbo.user_passkey CON SUS FILAS (las personas tendrán que volver a registrar su biométrico;
       no es evidencia de auditoría: los ingresos quedan en user_login_audit).
    2. Devuelve CK_user_login_audit_provider a sus 3 valores, SOLO si no hay filas con 'passkey'
       (si las hay, el CHECK se deja ampliado para no perder evidencia).

  Si solo quiere APAGAR la función sin tocar la base, basta con revertir el código.
  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51583, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

BEGIN TRY
BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[user_passkey]', N'U') IS NOT NULL
  DROP TABLE [dbo].[user_passkey];

IF OBJECT_ID(N'[dbo].[user_login_audit]', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM [dbo].[user_login_audit] WHERE [provider] = N'passkey')
   AND ISNULL(OBJECT_DEFINITION(OBJECT_ID(N'[dbo].[CK_user_login_audit_provider]')), N'') LIKE N'%passkey%'
BEGIN
  EXEC(N'ALTER TABLE [dbo].[user_login_audit] DROP CONSTRAINT [CK_user_login_audit_provider];');
  EXEC(N'ALTER TABLE [dbo].[user_login_audit] ADD CONSTRAINT [CK_user_login_audit_provider] CHECK ([provider] IN (N''credentials'', N''supplier-nit'', N''azure-ad''));');
END;

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues-reversa' AS momento,
       OBJECT_ID(N'dbo.user_passkey', N'U') AS tabla_id,
       OBJECT_DEFINITION(OBJECT_ID(N'dbo.CK_user_login_audit_provider')) AS check_proveedor;
