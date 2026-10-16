/*
  REVERSA del PASO 7 (retiro del módulo documental viejo en KRONOSDB).

  1. Recrear las tablas vacías: aplicar, EN ESTE ORDEN y antes de este archivo,
     las dos migraciones originales que producción ya tenía:
        prisma/migrations/20260821000000_add_document_management/migration.sql
        prisma/migrations/20260821120000_document_management_workflow/migration.sql
     (con aplicar-sql.mjs --confirmo-produccion). Quedan vacías, como estaban.
  2. Este archivo restaura los 2 subprocesos (mismos ids 40 y 41), su
     asignación y sus notificaciones desde dbo.bk_sgc_pase_*.
  Solo tiene sentido si también se revierte el CÓDIGO a la versión anterior
  (el código nuevo ya no usa estas tablas). Idempotente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
IF OBJECT_ID(N'dbo.bk_sgc_pase_subprocess', N'U') IS NULL
  THROW 50612, N'No existe el respaldo dbo.bk_sgc_pase_subprocess: no hay nada que restaurar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  SET IDENTITY_INSERT dbo.subprocess ON;
  INSERT INTO dbo.subprocess (id_subprocess, subprocess, id_process, subprocess_url)
  SELECT b.id_subprocess, b.subprocess, b.id_process, b.subprocess_url FROM dbo.bk_sgc_pase_subprocess b
  WHERE NOT EXISTS (SELECT 1 FROM dbo.subprocess s WHERE s.id_subprocess = b.id_subprocess);
  SET IDENTITY_INSERT dbo.subprocess OFF;

  INSERT INTO dbo.subprocess_user_company (id_subprocess, id_company_user)
  SELECT b.id_subprocess, b.id_company_user FROM dbo.bk_sgc_pase_subprocess_user_company b
  WHERE NOT EXISTS (SELECT 1 FROM dbo.subprocess_user_company x WHERE x.id_subprocess = b.id_subprocess AND x.id_company_user = b.id_company_user);
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
-- Notificaciones: al momento de la verificación previa había 0; si el respaldo
-- tiene filas, restaurarlas con IDENTITY_INSERT sobre dbo.notifications.
SELECT 'despues' AS q,
  (SELECT COUNT(*) FROM dbo.subprocess WHERE subprocess_url LIKE N'/process/document-management%') AS subprocesos,
  (SELECT COUNT(*) FROM dbo.bk_sgc_pase_notifications) AS notificaciones_en_respaldo,
  (SELECT COUNT(*) FROM sys.tables WHERE schema_id = SCHEMA_ID(N'dbo') AND name IN (N'document', N'document_type', N'document_version')) AS tablas_recreadas;
