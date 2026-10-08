/* REVERSA del paso opcional del programador central: solo si NO hay otros jobs que dependan de él. */
SET XACT_ABORT ON;
IF EXISTS (SELECT 1 FROM dbo.scheduled_job WHERE job_type <> N'sgc_review_alerts')
  THROW 50641, N'Hay jobs del programador que no son del SGC: no se quitan las tablas.', 1;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.scheduled_job_run', N'U') IS NOT NULL DROP TABLE dbo.scheduled_job_run;
IF OBJECT_ID(N'dbo.scheduled_job', N'U') IS NOT NULL DROP TABLE dbo.scheduled_job;
COMMIT TRANSACTION;
