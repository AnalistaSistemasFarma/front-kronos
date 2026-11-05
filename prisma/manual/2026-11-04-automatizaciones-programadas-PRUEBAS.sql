/*
  PASE MANUAL (PRUEBAS) — Indicador de automatizaciones → Automatizaciones programadas (2026-11-04).

  QUÉ HACE (aditivo e idempotente; solo crea lo que falta, no toca tablas existentes):
    - dbo.agent_scheduled_job   una fila por automatización programada de un agente (launchd, cron u
                                openclaw cron), con qué hace, cuándo corre, corridas y % terminado bien
                                en 30 y 90 días, última corrida, producción y su historia semanal
                                (semanas_json) para la tendencia. La publica el recolector de la Mac de
                                horus (scripts/agent-automation/programadas.py, solo lectura por SSH).
  Se cuenta aparte de los casos del chat (dbo.agent_automation_case): no suma horas ahorradas.
  Sin modelo Prisma (lib/agent-audit/scheduled-db.ts usa withMssqlPool).
  REVERSA: prisma/manual/2026-11-04-automatizaciones-programadas-reversa.sql
*/
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51594, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;
SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRAN;
IF OBJECT_ID(N'[dbo].[agent_scheduled_job]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_scheduled_job] (
    [id_job]              INT IDENTITY(1,1) NOT NULL,
    [clave]               NVARCHAR(160)  NOT NULL,   -- <host>:<tipo>:<nombre>, estable
    [id_agent]            INT            NOT NULL,
    [host]                NVARCHAR(40)   NOT NULL,   -- alias del equipo (local, jorge, pedro, lisa, cosmo)
    [tipo]                NVARCHAR(20)   NOT NULL,   -- launchd | cron | openclaw
    [nombre]              NVARCHAR(200)  NOT NULL,
    [descripcion]         NVARCHAR(1000) NULL,       -- qué hace, en lenguaje simple
    [programacion]        NVARCHAR(200)  NULL,       -- «Todos los días 16:00»
    [cargada]             BIT            NULL,
    [habilitada]          BIT            NULL,
    [estado]              NVARCHAR(20)   NOT NULL,   -- activa | pausada | fallando | sin_datos
    [estado_detalle]      NVARCHAR(400)  NULL,
    [ultima_corrida]      DATETIME2(0)   NULL,       -- UTC
    [ultima_ok]           BIT            NULL,
    [corridas_30]         INT            NOT NULL CONSTRAINT [DF_agent_scheduled_job_c30] DEFAULT (0),
    [ok_30]               INT            NOT NULL CONSTRAINT [DF_agent_scheduled_job_o30] DEFAULT (0),
    [corridas_90]         INT            NOT NULL CONSTRAINT [DF_agent_scheduled_job_c90] DEFAULT (0),
    [ok_90]               INT            NOT NULL CONSTRAINT [DF_agent_scheduled_job_o90] DEFAULT (0),
    [produccion_etiqueta] NVARCHAR(120)  NULL,       -- «certificaciones emitidas», «candidatos LAFT»…
    [produccion_30]       INT            NULL,
    [produccion_90]       INT            NULL,
    [primera_corrida]     DATE           NULL,
    [semanas_json]        NVARCHAR(MAX)  NULL,       -- [{inicio, corridas, ok, produccion}] (tendencia)
    [corte]               DATE           NOT NULL,
    [visto_at]            DATETIME2(0)   NOT NULL,   -- última vez que el recolector la vio
    [creado_at]           DATETIME2(0)   NOT NULL,
    CONSTRAINT [PK_agent_scheduled_job] PRIMARY KEY ([id_job]),
    CONSTRAINT [UQ_agent_scheduled_job_clave] UNIQUE ([clave]),
    CONSTRAINT [FK_agent_scheduled_job_agent] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE CASCADE
  );
  CREATE INDEX [IX_agent_scheduled_job_agent] ON [dbo].[agent_scheduled_job]([id_agent]);
END;
COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.agent_scheduled_job', N'U') AS agent_scheduled_job;
