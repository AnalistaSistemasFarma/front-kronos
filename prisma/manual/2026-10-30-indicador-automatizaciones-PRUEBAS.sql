/*
  PASE MANUAL (PRUEBAS) — Auditoría de agentes → Indicador de automatizaciones (2026-10-30).

  QUÉ HACE (idempotente; solo crea lo que falta, no toca tablas existentes):
    - dbo.agent_automation_case  por corte y agente, cada caso de uso con su tiempo ANTES (humano
                                 realista sin IA, con pasos y supuestos), su tiempo DESPUÉS (la
                                 persona pidiendo y revisando + el tiempo medido del agente), las
                                 ocurrencias medidas en el chat y las horas ahorradas.
    - dbo.agent_automation_run   cada análisis: pedido con el botón «Analizar ahora» o programado.
                                 El analizador (Mac de horus, solo lectura) toma las pendientes.
  Sin modelo Prisma (lib/agent-audit/automation-db.ts usa withMssqlPool).
  REVERSA: prisma/manual/2026-10-30-indicador-automatizaciones-reversa.sql
*/
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51591, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;
SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRAN;
IF OBJECT_ID(N'[dbo].[agent_automation_run]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_automation_run] (
    [id_run]          INT IDENTITY(1,1) NOT NULL,
    [origen]          NVARCHAR(20)   NOT NULL,   -- manual | programado | carga
    [status]          NVARCHAR(20)   NOT NULL,   -- pendiente | en_curso | terminado | fallido
    [requested_by]    NVARCHAR(200)  NULL,
    [requested_at]    DATETIME2(0)   NOT NULL,
    [started_at]      DATETIME2(0)   NULL,
    [finished_at]     DATETIME2(0)   NULL,
    [corte]           DATE           NULL,
    [periodo_desde]   DATE           NULL,
    [tareas]          INT            NULL,
    [tareas_sin_clasificar] INT      NULL,
    [error_summary]   NVARCHAR(1000) NULL,
    CONSTRAINT [PK_agent_automation_run] PRIMARY KEY ([id_run])
  );
  CREATE INDEX [IX_agent_automation_run_status] ON [dbo].[agent_automation_run]([status], [requested_at]);
END;
IF OBJECT_ID(N'[dbo].[agent_automation_case]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_automation_case] (
    [id_case]            INT IDENTITY(1,1) NOT NULL,
    [id_run]             INT            NULL,
    [corte]              DATE           NOT NULL,
    [periodo_desde]      DATE           NOT NULL,
    [id_agent]           INT            NOT NULL,
    [clave]              NVARCHAR(40)   NOT NULL,   -- id estable del caso (p. ej. C001)
    [caso]               NVARCHAR(300)  NOT NULL,
    [descripcion]        NVARCHAR(1000) NULL,
    [clase]              NVARCHAR(30)   NULL,       -- recurrencia medida
    [area]               NVARCHAR(120)  NULL,
    [entregable]         NVARCHAR(300)  NULL,
    [terminos]           NVARCHAR(400)  NULL,       -- términos con los que el analizador reconoce el caso
    [ocurrencias]        INT            NOT NULL,
    [min_humano]         INT            NOT NULL,   -- ANTES: una ocurrencia sin IA (realista)
    [min_humano_min]     INT            NULL,
    [min_humano_max]     INT            NULL,
    [min_despues]        INT            NOT NULL,   -- DESPUÉS: la persona pidiendo y revisando
    [min_agente]         DECIMAL(8,1)   NULL,       -- mediana medida del agente (pedido → última respuesta)
    [horas_antes]        DECIMAL(10,1)  NOT NULL,
    [horas_despues]      DECIMAL(10,1)  NOT NULL,
    [horas_ahorradas]    DECIMAL(10,1)  NOT NULL,
    [horas_mes]          DECIMAL(10,1)  NOT NULL,
    [pasos_json]         NVARCHAR(MAX)  NULL,
    [supuestos]          NVARCHAR(600)  NULL,
    [confianza]          NVARCHAR(10)   NULL,
    [valido]             BIT            NOT NULL,
    CONSTRAINT [PK_agent_automation_case] PRIMARY KEY ([id_case]),
    CONSTRAINT [FK_agent_automation_case_agent] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE CASCADE
  );
  CREATE INDEX [IX_agent_automation_case_corte] ON [dbo].[agent_automation_case]([corte], [id_agent]);
END;
COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.agent_automation_case', N'U') AS agent_automation_case, OBJECT_ID(N'dbo.agent_automation_run', N'U') AS agent_automation_run;
