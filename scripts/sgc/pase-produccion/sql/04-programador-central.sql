/*
  PASE DEL SGC A PRODUCCIÓN — PASO OPCIONAL (requiere decisión de Nicolás):
  PROGRAMADOR CENTRAL DE TAREAS en KRONOSDB.

  Hallazgo del S6 (solo lectura, 2026-10-01): en producción NO existen
  dbo.scheduled_job ni dbo.scheduled_job_run (el programador central solo está
  activo en PRUEBAS). Sin ellas, el SQL del S5 no crea el job
  `sgc_review_alerts` y los AVISOS AUTOMÁTICOS de vencimiento y los
  recordatorios automáticos de lectura NO corren (todo lo demás del SGC sí).

  Este script crea las dos tablas con la MISMA estructura de PRUEBAS (vacías).
  El código de main ya trae el programador (lib/scheduler, /api/scheduler/run
  y el respaldo oportunista de la campana), así que con las tablas el job del
  SGC corre solo a las 6:00 (o cuando alguien con sesión consulta la campana
  después de esa hora). Opcional: tarea programada de Windows que llame
  POST /api/scheduler/run con un Bearer de INTEGRATION_API_KEYS.
  Correr ANTES de 2026-10-01-sgc-s5-vencimientos-olp.sql. Idempotente.
  Reversa: 04-programador-central-reversa.sql.
*/
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID(N'dbo.scheduled_job', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.scheduled_job (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_scheduled_job PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    job_type NVARCHAR(50) NOT NULL,
    payload NVARCHAR(MAX) NULL,
    cron_expression NVARCHAR(100) NOT NULL,
    next_run_date DATETIME NOT NULL,
    last_run_date DATETIME NULL,
    last_status NVARCHAR(20) NULL,
    active BIT NOT NULL CONSTRAINT DF_scheduled_job_active DEFAULT ((1)),
    source_module NVARCHAR(50) NULL,
    created_by NVARCHAR(1000) NULL,
    created_at DATETIME NOT NULL CONSTRAINT DF_scheduled_job_created_at DEFAULT (GETDATE())
  );
  CREATE INDEX IX_scheduled_job_due ON dbo.scheduled_job (active, next_run_date);
END;
IF OBJECT_ID(N'dbo.scheduled_job_run', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.scheduled_job_run (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_scheduled_job_run PRIMARY KEY,
    id_job INT NOT NULL CONSTRAINT FK_scheduled_job_run_job REFERENCES dbo.scheduled_job (id),
    run_at DATETIME NOT NULL CONSTRAINT DF_scheduled_job_run_run_at DEFAULT (GETDATE()),
    status NVARCHAR(20) NOT NULL,
    detail NVARCHAR(1000) NULL,
    result_ref NVARCHAR(255) NULL
  );
END;
COMMIT TRANSACTION;
SELECT name FROM sys.tables WHERE name IN (N'scheduled_job', N'scheduled_job_run');
