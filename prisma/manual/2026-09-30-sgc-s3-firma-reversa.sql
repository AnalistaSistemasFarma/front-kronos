/*
  REVERSA — SGC documental, Sprint 3 (firma electrónica propia, PDF
  controlado, lista de chequeo de Calidad y borrador en la app). Deshace la
  migración 20260930230000_sgc_s3_firma_pdf_calidad y los datos de
  prisma/manual/2026-09-30-sgc-s3-firma-calidad-olp.sql. Deja el esquema
  `sgc` como quedó en el Sprint 2.

  ⚠️ BORRA las firmas electrónicas, consentimientos, maestro de firmas,
  revisiones del borrador y listas de chequeo (los archivos de evidencia en
  OneDrive SGC/<EMPRESA>/_firmas/ y los PDF controlados NO se tocan). Antes de
  correrla, exportar a JSON esas 5 tablas y las columnas nuevas como
  evidencia (quedan en ~/.horus/rollbacks/). Solo con autorización de
  Nicolás. Idempotente.

  - El flujo DOC vuelve a su versión anterior VIGENTE; la versión con lista de
    chequeo queda RETIRADA (no se borra: puede tener solicitudes y el registro
    de cambios es inmodificable).
  - Los puntos de firma vuelven al valor del S2 («pendiente_s3»), salvo los
    firmados, que quedan «firmada».
  - Las versiones de documento generadas por el S3 (estado «borrador») se
    conservan; pierden id_request, manifest_json y signed_content_sha256.
  - NO toca sgc.audit_log ni sgc.config_change_log (inmodificables).

  Orden: primero revertir el código (sin él nada lee estas tablas) y después
  correr esta reversa. Lotes separados por GO.
*/

SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'[sgc].[signature_solo_insercion]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[signature_solo_insercion];
IF OBJECT_ID(N'[sgc].[signature_consent_solo_insercion]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[signature_consent_solo_insercion];
IF OBJECT_ID(N'[sgc].[draft_revision_solo_insercion]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[draft_revision_solo_insercion];
IF OBJECT_ID(N'[sgc].[quality_check_solo_insercion]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[quality_check_solo_insercion];
IF OBJECT_ID(N'[sgc].[signature_master_sin_borrado]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[signature_master_sin_borrado];
IF OBJECT_ID(N'[sgc].[signature_master_solo_revocacion]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[signature_master_solo_revocacion];
GO

SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;

  /* Flujo DOC: la versión con lista de chequeo se retira y vuelve la anterior. */
  IF COL_LENGTH(N'[sgc].[flow_form_field]', N'quality_check') IS NOT NULL
    EXEC sp_executesql N'
      DECLARE @Now DATETIME2 = SYSUTCDATETIME();
      DECLARE @V TABLE (id_flow_version INT, id_flow_process INT, version_number INT);
      INSERT INTO @V
        SELECT v.id_flow_version, v.id_flow_process, v.version_number FROM [sgc].[flow_version] v
        JOIN [sgc].[flow_process] p ON p.id_flow_process = v.id_flow_process
        WHERE p.code = N''DOC'' AND v.status = N''vigente''
          AND EXISTS (SELECT 1 FROM [sgc].[flow_form_field] f WHERE f.id_flow_version = v.id_flow_version AND f.quality_check = 1);
      UPDATE v SET status = N''retirada'', retired_at = @Now, updated_at = @Now FROM [sgc].[flow_version] v JOIN @V x ON x.id_flow_version = v.id_flow_version;
      UPDATE prev SET status = N''vigente'', retired_at = NULL, updated_at = @Now
      FROM [sgc].[flow_version] prev JOIN @V x ON x.id_flow_process = prev.id_flow_process
      WHERE prev.version_number = (SELECT MAX(p2.version_number) FROM [sgc].[flow_version] p2 WHERE p2.id_flow_process = x.id_flow_process AND p2.version_number < x.version_number);';

  /* Puntos de firma al valor del S2. */
  UPDATE [sgc].[task_assignee] SET signature_status = N'pendiente_s3' WHERE signature_status IN (N'pendiente', N'sin_firma_s2');

  IF OBJECT_ID(N'[sgc].[quality_check]', N'U') IS NOT NULL     DROP TABLE [sgc].[quality_check];
  IF OBJECT_ID(N'[sgc].[signature]', N'U') IS NOT NULL         DROP TABLE [sgc].[signature];
  IF OBJECT_ID(N'[sgc].[signature_consent]', N'U') IS NOT NULL DROP TABLE [sgc].[signature_consent];
  IF OBJECT_ID(N'[sgc].[signature_master]', N'U') IS NOT NULL  DROP TABLE [sgc].[signature_master];
  IF OBJECT_ID(N'[sgc].[draft_revision]', N'U') IS NOT NULL    DROP TABLE [sgc].[draft_revision];

  IF COL_LENGTH(N'[sgc].[task_assignee]', N'id_signature') IS NOT NULL ALTER TABLE [sgc].[task_assignee] DROP COLUMN [id_signature];
  IF COL_LENGTH(N'[sgc].[request]', N'id_document_version') IS NOT NULL ALTER TABLE [sgc].[request] DROP COLUMN [id_document_version], [controlled_pdf_status], [controlled_pdf_error];
  IF COL_LENGTH(N'[sgc].[document_version]', N'id_request') IS NOT NULL ALTER TABLE [sgc].[document_version] DROP COLUMN [id_request], [manifest_json], [signed_content_sha256];
  IF OBJECT_ID(N'[sgc].[flow_form_field_quality_check_df]', N'D') IS NOT NULL ALTER TABLE [sgc].[flow_form_field] DROP CONSTRAINT [flow_form_field_quality_check_df];
  IF COL_LENGTH(N'[sgc].[flow_form_field]', N'quality_check') IS NOT NULL ALTER TABLE [sgc].[flow_form_field] DROP COLUMN [quality_check];

  DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20260930230000_sgc_s3_firma_pdf_calidad';
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
GO

SELECT 'despues' AS momento, t.name AS tabla_sgc FROM sys.tables t WHERE t.schema_id = SCHEMA_ID(N'sgc') ORDER BY t.name;
