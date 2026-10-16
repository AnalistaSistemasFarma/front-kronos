/*
  REVERSA — SGC documental, Sprint 5 (mapa de relaciones, vencimientos y
  accesos). Deshace la migración 20261001100000_sgc_s5_relaciones_vencimientos_accesos
  y los datos de prisma/manual/2026-10-01-sgc-s5-vencimientos-olp.sql. Deja el
  esquema `sgc` como quedó en el Sprint 4.

  ⚠️ BORRA las relaciones entre documentos, las posiciones del mapa, la
  configuración y el REGISTRO de avisos de vencimiento, los enlaces iCal y las
  solicitudes de acceso. Antes de correrla, exportar a JSON esas 6 tablas
  como evidencia (quedan en ~/.horus/rollbacks/). Solo con autorización de
  Nicolás. Idempotente.

  - Quita el job `sgc_review_alerts` del programador central (dbo.scheduled_job)
    y SOLO sus corridas (dbo.scheduled_job_run de ese job); no toca los demás jobs.
  - Los accesos de consulta que se otorgaron al aprobar solicitudes
    (sgc.document_access, tabla del S1) se CONSERVAN: son accesos válidos con
    su motivo; Calidad los revoca desde la ficha si hace falta.
  - NO toca sgc.audit_log (inmodificable): los avisos enviados siguen constando.

  Orden: primero revertir el código (sin él nada lee estas tablas) y después
  correr esta reversa. Lotes separados por GO.
*/

SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'[sgc].[document_relation_sin_borrado]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[document_relation_sin_borrado];
IF OBJECT_ID(N'[sgc].[review_alert_config_sin_borrado]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[review_alert_config_sin_borrado];
IF OBJECT_ID(N'[sgc].[review_alert_inmodificable]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[review_alert_inmodificable];
IF OBJECT_ID(N'[sgc].[ical_token_sin_borrado]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[ical_token_sin_borrado];
IF OBJECT_ID(N'[sgc].[access_request_sin_borrado]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[access_request_sin_borrado];
GO

SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NOT NULL
  BEGIN
    IF OBJECT_ID(N'[dbo].[scheduled_job_run]', N'U') IS NOT NULL
      EXEC sp_executesql N'DELETE r FROM [dbo].[scheduled_job_run] r JOIN [dbo].[scheduled_job] j ON j.id = r.id_job WHERE j.job_type = N''sgc_review_alerts'';';
    EXEC sp_executesql N'DELETE FROM [dbo].[scheduled_job] WHERE job_type = N''sgc_review_alerts'';';
  END;

  IF OBJECT_ID(N'[sgc].[access_request]', N'U') IS NOT NULL      DROP TABLE [sgc].[access_request];
  IF OBJECT_ID(N'[sgc].[ical_token]', N'U') IS NOT NULL          DROP TABLE [sgc].[ical_token];
  IF OBJECT_ID(N'[sgc].[review_alert]', N'U') IS NOT NULL        DROP TABLE [sgc].[review_alert];
  IF OBJECT_ID(N'[sgc].[review_alert_config]', N'U') IS NOT NULL DROP TABLE [sgc].[review_alert_config];
  IF OBJECT_ID(N'[sgc].[graph_layout]', N'U') IS NOT NULL        DROP TABLE [sgc].[graph_layout];
  IF OBJECT_ID(N'[sgc].[document_relation]', N'U') IS NOT NULL   DROP TABLE [sgc].[document_relation];

  DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20261001100000_sgc_s5_relaciones_vencimientos_accesos';
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
GO

SELECT 'despues' AS momento, t.name AS tabla_sgc FROM sys.tables t WHERE t.schema_id = SCHEMA_ID(N'sgc') ORDER BY t.name;
