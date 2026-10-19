/*
  PASE MANUAL (PRUEBAS) — SGC documental: DOCUMENTOS PADRE E HIJOS. 2026-10-19.
  BASE: KRONOSDB_PRUEBAS (o la base efímera kronos_ci de la CI). El script se detiene en cualquier otra base.

  Correr ANTES de desplegar el código en pruebas (.230).

  QUÉ HACE: el DDL de prisma/migrations/20261019100000_sgc_padres_hijos, nada más:
    - sgc.document_type.is_parent_type BIT NOT NULL DEFAULT 0 (ningún tipo queda marcado:
      sin marca, el código trata como padre al procedimiento, PR);
    - el CHECK document_relation_origen_estado_ck admite además los orígenes «solicitud» y «carga».
  NO toca datos ni configuración. Aditivo e IDEMPOTENTE; informa antes y después.
  Después del código: registrar la migración con scripts/sgc/pase-produccion/registrar-migraciones.mjs.

  🔒 BLOQUEOS: ALTER TABLE pide Sch-M. Con LOCK_TIMEOUT 5000 se rinde a los 5 s si la tabla
  está tomada (error 1222) y hace ROLLBACK: vuelva a correrlo.
  CÓMO CORRERLO: node scripts/sgc/pase-produccion/aplicar-sql.mjs (o un script Node con mssql).
  REVERSA: prisma/manual/2026-10-19-sgc-padres-hijos-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51201, N'Base no esperada para este script (PRUEBAS).', 1;
IF OBJECT_ID(N'sgc.document_type', N'U') IS NULL OR OBJECT_ID(N'sgc.document_relation', N'U') IS NULL
  THROW 51203, N'Falta el esquema sgc (migraciones S1 y S5).', 1;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_relation_origen_estado_ck')
  THROW 51204, N'Falta la migración 20261008110000_sgc_s9_archivos_relaciones_correo.', 1;

SELECT DB_NAME() AS base, 'antes' AS momento,
       COL_LENGTH(N'sgc.document_type', N'is_parent_type') AS tipo_es_padre,
       (SELECT definition FROM sys.check_constraints WHERE name = N'document_relation_origen_estado_ck') AS check_origen;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Pase PRUEBAS 2026-10-19: documentos padre e hijos (20261019100000_sgc_padres_hijos)';

BEGIN TRY
  BEGIN TRANSACTION;
  IF COL_LENGTH(N'sgc.document_type', N'is_parent_type') IS NULL
    ALTER TABLE [sgc].[document_type] ADD [is_parent_type] BIT NOT NULL CONSTRAINT [document_type_is_parent_type_df] DEFAULT 0;
  IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_relation_origen_estado_ck' AND definition NOT LIKE N'%solicitud%')
    ALTER TABLE [sgc].[document_relation] DROP CONSTRAINT [document_relation_origen_estado_ck];
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_relation_origen_estado_ck')
    EXEC sp_executesql N'ALTER TABLE [sgc].[document_relation] ADD CONSTRAINT [document_relation_origen_estado_ck] CHECK ([origin] IN (N''manual'', N''codigo'', N''listado'', N''solicitud'', N''carga'') AND [status] IN (N''propuesta'', N''confirmada''));';
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
  EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
  THROW;
END CATCH;

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;

SELECT DB_NAME() AS base, 'despues' AS momento,
       COL_LENGTH(N'sgc.document_type', N'is_parent_type') AS tipo_es_padre,
       (SELECT definition FROM sys.check_constraints WHERE name = N'document_relation_origen_estado_ck') AS check_origen;
