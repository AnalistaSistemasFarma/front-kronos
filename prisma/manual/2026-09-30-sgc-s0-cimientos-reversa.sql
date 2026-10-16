/*
  REVERSA de prisma/manual/2026-09-30-sgc-s0-cimientos.sql y de la migración
  20260930110000_sgc_esquema_base. Deja la base como estaba antes del SGC.
  Solo con autorización. Idempotente.
*/
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;

  DELETE suc FROM [dbo].[subprocess_user_company] suc
  JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
  WHERE s.subprocess_url LIKE N'/process/sgc-documental%';

  DELETE FROM [dbo].[subprocess] WHERE subprocess_url LIKE N'/process/sgc-documental%';

  DELETE p FROM [dbo].[process] p
  WHERE p.process = N'Sistema de Gestión de Calidad'
    AND NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] s WHERE s.id_process = p.id_process);

  IF OBJECT_ID(N'[sgc].[company_config]', N'U') IS NOT NULL DROP TABLE [sgc].[company_config];

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

IF EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'sgc')
  AND NOT EXISTS (SELECT 1 FROM sys.objects o JOIN sys.schemas sc ON sc.schema_id = o.schema_id WHERE sc.name = N'sgc')
  EXEC sp_executesql N'DROP SCHEMA [sgc];';

DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20260930110000_sgc_esquema_base';
