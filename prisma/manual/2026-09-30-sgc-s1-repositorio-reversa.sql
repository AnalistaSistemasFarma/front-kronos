/*
  REVERSA — SGC documental, Sprint 1 (repositorio y listado maestro).
  Deshace la migración 20260930150000_sgc_s1_repositorio y los datos de
  prisma/manual/2026-09-30-sgc-s1-maestros-olp.sql. Deja el esquema `sgc`
  como quedó en el Sprint 0 (solo sgc.company_config).

  ⚠️ BORRA los documentos cargados, sus versiones, accesos y la AUDITORÍA del
  SGC. Antes de correrla, exportar a JSON las 8 tablas como evidencia
  (quedan en ~/.horus/rollbacks/). Los archivos en OneDrive (SGC/<EMPRESA>/…)
  NO se tocan. Solo con autorización de Nicolás. Idempotente.

  Orden: primero revertir el código (sin él nada lee estas tablas) y después
  correr esta reversa. Lotes separados por GO.
*/

IF OBJECT_ID(N'[sgc].[audit_log_solo_insercion]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[audit_log_solo_insercion];
GO

SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'[sgc].[audit_log]', N'U') IS NOT NULL        DROP TABLE [sgc].[audit_log];
  IF OBJECT_ID(N'[sgc].[document_access]', N'U') IS NOT NULL  DROP TABLE [sgc].[document_access];
  IF OBJECT_ID(N'[sgc].[document_version]', N'U') IS NOT NULL DROP TABLE [sgc].[document_version];
  IF OBJECT_ID(N'[sgc].[document]', N'U') IS NOT NULL         DROP TABLE [sgc].[document];
  IF OBJECT_ID(N'[sgc].[document_type]', N'U') IS NOT NULL    DROP TABLE [sgc].[document_type];
  IF OBJECT_ID(N'[sgc].[process_map]', N'U') IS NOT NULL      DROP TABLE [sgc].[process_map];
  IF OBJECT_ID(N'[sgc].[process_type]', N'U') IS NOT NULL     DROP TABLE [sgc].[process_type];
  IF OBJECT_ID(N'[sgc].[coding_guide]', N'U') IS NOT NULL     DROP TABLE [sgc].[coding_guide];
  DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20260930150000_sgc_s1_repositorio';
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
GO

SELECT 'despues' AS momento, t.name AS tabla_sgc FROM sys.tables t WHERE t.schema_id = SCHEMA_ID(N'sgc') ORDER BY t.name;
