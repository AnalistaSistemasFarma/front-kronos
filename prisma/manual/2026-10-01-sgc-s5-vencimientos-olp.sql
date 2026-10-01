/*
  PASE MANUAL — SGC documental, Sprint 5: avisos anticipados de vencimiento
  de One Latam Pharma (datos) y job del programador central. Autorizado por
  Nicolás Rivera el 2026-09-30 (plan del SGC documental de OLP, ejecución
  sprint por sprint hasta testing; calendario pedido el 2026-09-30 19:42).

  PRERREQUISITO: migración 20261001100000_sgc_s5_relaciones_vencimientos_accesos
  aplicada y el CÓDIGO del S5 desplegado (el programador debe conocer el
  job_type `sgc_review_alerts`; si el job existe antes que el código, el
  programador lo registra como «job_type desconocido» y lo pospone).

  QUÉ HACE (idempotente):
    1. Configuración GENERAL de avisos de la empresa (sgc.review_alert_config,
       alcance «empresa»), si no existe: 60, 30, 15 y 7 días antes y el día del
       vencimiento; aviso de vencido repetido cada 7 días (escalado a Calidad);
       recordatorio automático de lectura cada 7 días; correo encendido.
       Calidad la ajusta luego desde «Calendario de vencimientos → Avisos».
       Queda en sgc.audit_log con el motivo.
    2. Job GLOBAL del programador central (dbo.scheduled_job; uno solo para
       todas las empresas activas), si no existe: `sgc_review_alerts`, todos
       los días a las 6:00 a. m. (hora del servidor, Colombia). Es una FILA de
       datos en la tabla compartida del programador (no cambia su estructura).

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS; en
  KRONOSDB solo con autorización del pase. Imprime antes y después.

  REVERSA: prisma/manual/2026-10-01-sgc-s5-relaciones-vencimientos-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Reason NVARCHAR(1000) = N'Sprint 5 del SGC documental: avisos por defecto a 60, 30, 15 y 7 días y el día del vencimiento (pedido de Nicolás Rivera, 2026-09-30 19:42).';

SELECT 'antes' AS momento, scope_key, offsets_json, overdue_every_days, reading_reminder_days, email_enabled FROM [sgc].[review_alert_config] WHERE id_company = @IdCompany;

BEGIN TRY
  BEGIN TRANSACTION;

  IF EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompany)
     AND NOT EXISTS (SELECT 1 FROM [sgc].[review_alert_config] WHERE id_company = @IdCompany AND scope_key = N'empresa')
  BEGIN
    INSERT INTO [sgc].[review_alert_config] (id_company, scope, scope_key, offsets_json, overdue_every_days, reading_reminder_days, email_enabled, extra_emails_json, is_active, change_reason, updated_by)
    VALUES (@IdCompany, N'empresa', N'empresa', N'[60,30,15,7,0]', 7, 7, 1, N'[]', 1, @Reason, @Actor);
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, SYSUTCDATETIME(), @Actor, N'vencimiento.configurado', N'review_alert_config', CAST(SCOPE_IDENTITY() AS NVARCHAR(60)), NULL,
            N'{"scope":"empresa","offsets":[60,30,15,7,0],"overdueEveryDays":7,"readingReminderDays":7,"emailEnabled":true}', @Reason);
  END;

  IF OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM [dbo].[scheduled_job] WHERE job_type = N'sgc_review_alerts')
  BEGIN
    -- Próximas 6:00 a. m. (hora del servidor).
    DECLARE @Next DATETIME = DATEADD(HOUR, 6, CAST(CAST(GETDATE() AS DATE) AS DATETIME));
    IF @Next <= GETDATE() SET @Next = DATEADD(DAY, 1, @Next);
    EXEC sp_executesql N'INSERT INTO [dbo].[scheduled_job] (name, job_type, payload, cron_expression, next_run_date, active, source_module, created_by, created_at)
      VALUES (N''SGC · avisos de vencimiento y recordatorios de lectura'', N''sgc_review_alerts'', NULL, N''0 6 * * *'', @Next, 1, N''sgc-documental'', @Actor, GETDATE());',
      N'@Next DATETIME, @Actor NVARCHAR(255)', @Next = @Next, @Actor = @Actor;
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT 'despues' AS momento, scope_key, offsets_json, overdue_every_days, reading_reminder_days, email_enabled FROM [sgc].[review_alert_config] WHERE id_company = @IdCompany;
IF OBJECT_ID(N'[dbo].[scheduled_job]', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT ''job'' AS q, id, name, job_type, cron_expression, next_run_date, active, source_module FROM [dbo].[scheduled_job] WHERE job_type = N''sgc_review_alerts'';';
