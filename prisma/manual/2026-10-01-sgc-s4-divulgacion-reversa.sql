/*
  REVERSA — SGC documental, Sprint 4 (divulgación, capacitación y vigencia).
  Deshace la migración 20261001000000_sgc_s4_divulgacion_capacitacion_vigencia
  y los datos de prisma/manual/2026-10-01-sgc-s4-divulgacion-capacitacion-olp.sql.
  Deja el esquema `sgc` como quedó en el Sprint 3.

  ⚠️ BORRA el alcance de divulgación, las lecturas, las capacitaciones con
  sus cargas y resultados y las personas por cargo (las firmas «Leyó» y
  «Capacitó» de sgc.signature NO se tocan: son inmodificables; tampoco los
  archivos en OneDrive). Antes de correrla, exportar a JSON esas 6 tablas y
  document_version.id_superseded_by como evidencia (quedan en
  ~/.horus/rollbacks/). Solo con autorización de Nicolás. Idempotente.

  - El flujo DOC vuelve a su versión anterior VIGENTE; la versión con la
    divulgación habilitada queda RETIRADA (no se borra: puede tener
    solicitudes y el registro de cambios es inmodificable).
  - Las versiones de documento que pasaron a vigente u obsoleta por el flujo
    se conservan como quedaron (estado, fechas): revertir un documento
    vigente es un acto de Calidad (anulación), no de la reversa técnica.
  - NO toca sgc.audit_log ni sgc.config_change_log (inmodificables).

  Orden: primero revertir el código (sin él nada lee estas tablas) y después
  correr esta reversa. Lotes separados por GO.
*/

SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'[sgc].[dissemination_scope_sin_borrado]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[dissemination_scope_sin_borrado];
IF OBJECT_ID(N'[sgc].[read_record_sin_borrado]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[read_record_sin_borrado];
IF OBJECT_ID(N'[sgc].[read_record_firma_inmodificable]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[read_record_firma_inmodificable];
IF OBJECT_ID(N'[sgc].[training_sin_borrado]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[training_sin_borrado];
IF OBJECT_ID(N'[sgc].[training_upload_solo_insercion]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[training_upload_solo_insercion];
IF OBJECT_ID(N'[sgc].[training_result_solo_insercion]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[training_result_solo_insercion];
IF OBJECT_ID(N'[sgc].[cargo_member_sin_borrado]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[cargo_member_sin_borrado];
GO

SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;

  /* Flujo DOC: la versión con la divulgación habilitada se retira y vuelve la anterior. */
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  DECLARE @V TABLE (id_flow_version INT, id_flow_process INT, version_number INT);
  INSERT INTO @V
    SELECT v.id_flow_version, v.id_flow_process, v.version_number FROM [sgc].[flow_version] v
    JOIN [sgc].[flow_process] p ON p.id_flow_process = v.id_flow_process
    WHERE p.code = N'DOC' AND v.status = N'vigente'
      AND EXISTS (SELECT 1 FROM [sgc].[flow_task_def] t WHERE t.id_flow_version = v.id_flow_version AND t.task_key = N'divulgacion' AND t.assignment = N'alcance' AND t.is_enabled = 1);
  UPDATE v SET status = N'retirada', retired_at = @Now, updated_at = @Now FROM [sgc].[flow_version] v JOIN @V x ON x.id_flow_version = v.id_flow_version;
  UPDATE prev SET status = N'vigente', retired_at = NULL, updated_at = @Now
  FROM [sgc].[flow_version] prev JOIN @V x ON x.id_flow_process = prev.id_flow_process
  WHERE prev.version_number = (SELECT MAX(p2.version_number) FROM [sgc].[flow_version] p2 WHERE p2.id_flow_process = x.id_flow_process AND p2.version_number < x.version_number);

  IF OBJECT_ID(N'[sgc].[training_result]', N'U') IS NOT NULL     DROP TABLE [sgc].[training_result];
  IF OBJECT_ID(N'[sgc].[training_upload]', N'U') IS NOT NULL     DROP TABLE [sgc].[training_upload];
  IF OBJECT_ID(N'[sgc].[training]', N'U') IS NOT NULL            DROP TABLE [sgc].[training];
  IF OBJECT_ID(N'[sgc].[read_record]', N'U') IS NOT NULL         DROP TABLE [sgc].[read_record];
  IF OBJECT_ID(N'[sgc].[dissemination_scope]', N'U') IS NOT NULL DROP TABLE [sgc].[dissemination_scope];
  IF OBJECT_ID(N'[sgc].[cargo_member]', N'U') IS NOT NULL        DROP TABLE [sgc].[cargo_member];

  IF COL_LENGTH(N'[sgc].[document_version]', N'id_superseded_by') IS NOT NULL ALTER TABLE [sgc].[document_version] DROP COLUMN [id_superseded_by];

  DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20261001000000_sgc_s4_divulgacion_capacitacion_vigencia';
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
GO

SELECT 'despues' AS momento, t.name AS tabla_sgc FROM sys.tables t WHERE t.schema_id = SCHEMA_ID(N'sgc') ORDER BY t.name;
