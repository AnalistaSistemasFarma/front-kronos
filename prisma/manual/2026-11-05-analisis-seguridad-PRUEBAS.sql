/*
  PASE MANUAL (PRUEBAS) — Auditoría de agentes → Análisis de seguridad de conversaciones. 2026-11-05.
  Pedido de Nicolás Rivera (2026-11-05): botón «Analizar» que lee las conversaciones del mes buscando
  inyecciones de prompt, fugas de datos e instrucciones maliciosas entre operador y agente.
  BASE: KRONOSDB_PRUEBAS (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; solo crea; no toca tablas existentes):
    1. dbo.agent_security_run     — corridas (pendiente → en_curso → terminado | fallido).
    2. dbo.agent_security_finding — hallazgos con evidencia YA ENMASCARADA (secretos ocultos).
  Sin modelo Prisma (igual que el indicador de automatizaciones): lib/agent-audit/security-db.ts.

  ORDEN: antes o después del código. Sin las tablas, la pantalla dice «aún no habilitado».
  No toca datos existentes: la reversa deja la base como estaba.
  REVERSA: prisma/manual/2026-11-05-analisis-seguridad-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51601, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

BEGIN TRY
BEGIN TRAN;

/* BLOQUE-DDL-INICIO */
/* ---- dbo.agent_security_run: corridas del análisis ------------------------ */
IF OBJECT_ID(N'[dbo].[agent_security_run]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_security_run] (
    [id_run]             INT            IDENTITY(1,1) NOT NULL,
    [periodo]            CHAR(7)        NOT NULL,
    [origen]             NVARCHAR(20)   NOT NULL,
    [status]             NVARCHAR(20)   NOT NULL,
    [requested_by]       NVARCHAR(200)  NULL,
    [requested_at]       DATETIME2      NOT NULL CONSTRAINT [agent_security_run_requested_at_df] DEFAULT sysutcdatetime(),
    [started_at]         DATETIME2      NULL,
    [finished_at]        DATETIME2      NULL,
    [progreso]           NVARCHAR(200)  NULL,
    [conversaciones]     INT            NULL,
    [mensajes_operador]  INT            NULL,
    [mensajes_agente]    INT            NULL,
    [hallazgos]          INT            NULL,
    [modelo]             NVARCHAR(60)   NULL,
    [resumen]            NVARCHAR(2000) NULL,
    [error_summary]      NVARCHAR(1000) NULL,
    CONSTRAINT [agent_security_run_pkey] PRIMARY KEY CLUSTERED ([id_run]),
    CONSTRAINT [CK_agent_security_run_status] CHECK ([status] IN (N'pendiente', N'en_curso', N'terminado', N'fallido')),
    CONSTRAINT [CK_agent_security_run_periodo] CHECK ([periodo] LIKE N'[2][0-9][0-9][0-9]-[01][0-9]')
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_security_run_periodo' AND object_id = OBJECT_ID(N'[dbo].[agent_security_run]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_security_run_periodo] ON [dbo].[agent_security_run]([periodo], [status], [requested_at] DESC);');

/* ---- dbo.agent_security_finding: hallazgos (evidencia ya enmascarada) ------ */
IF OBJECT_ID(N'[dbo].[agent_security_finding]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_security_finding] (
    [id_finding]      INT            IDENTITY(1,1) NOT NULL,
    [id_run]          INT            NOT NULL,
    [periodo]         CHAR(7)        NOT NULL,
    [id_message]      INT            NOT NULL,
    [id_conversation] INT            NOT NULL,
    [conv_kind]       NVARCHAR(20)   NULL,
    [id_agent]        INT            NULL,
    [id_company]      INT            NULL,
    [agente]          NVARCHAR(120)  NULL,
    [persona_email]   NVARCHAR(200)  NULL,
    [rol]             NVARCHAR(10)   NOT NULL,
    [message_at]      DATETIME2      NOT NULL,
    [categoria]       NVARCHAR(30)   NOT NULL,
    [severidad]       NVARCHAR(10)   NOT NULL,
    [detector]        NVARCHAR(20)   NOT NULL,
    [reglas]          NVARCHAR(300)  NULL,
    [evidencia]       NVARCHAR(800)  NULL,
    [explicacion]     NVARCHAR(1200) NULL,
    [recomendacion]   NVARCHAR(800)  NULL,
    [agente_cumplio]  NVARCHAR(10)   NULL,
    [estado]          NVARCHAR(20)   NOT NULL CONSTRAINT [agent_security_finding_estado_df] DEFAULT N'nuevo',
    [revisado_por]    NVARCHAR(200)  NULL,
    [revisado_at]     DATETIME2      NULL,
    [nota]            NVARCHAR(1000) NULL,
    [created_at]      DATETIME2      NOT NULL CONSTRAINT [agent_security_finding_created_at_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [agent_security_finding_pkey] PRIMARY KEY CLUSTERED ([id_finding]),
    CONSTRAINT [FK_agent_security_finding_run] FOREIGN KEY ([id_run]) REFERENCES [dbo].[agent_security_run]([id_run]) ON DELETE CASCADE,
    CONSTRAINT [CK_agent_security_finding_rol] CHECK ([rol] IN (N'user', N'agent')),
    CONSTRAINT [CK_agent_security_finding_categoria] CHECK ([categoria] IN (N'inyeccion_prompt', N'instruccion_maliciosa', N'fuga_datos', N'exfiltracion', N'evasion_controles', N'ingenieria_social')),
    CONSTRAINT [CK_agent_security_finding_severidad] CHECK ([severidad] IN (N'critica', N'alta', N'media', N'baja')),
    CONSTRAINT [CK_agent_security_finding_detector] CHECK ([detector] IN (N'ia', N'reglas', N'reglas+ia')),
    CONSTRAINT [CK_agent_security_finding_cumplio] CHECK ([agente_cumplio] IS NULL OR [agente_cumplio] IN (N'si', N'no', N'parcial', N'n/a')),
    CONSTRAINT [CK_agent_security_finding_estado] CHECK ([estado] IN (N'nuevo', N'revisado', N'falso_positivo', N'escalado'))
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_security_finding_periodo' AND object_id = OBJECT_ID(N'[dbo].[agent_security_finding]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_security_finding_periodo] ON [dbo].[agent_security_finding]([periodo], [severidad], [message_at] DESC);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_security_finding_run' AND object_id = OBJECT_ID(N'[dbo].[agent_security_finding]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_security_finding_run] ON [dbo].[agent_security_finding]([id_run]);');
/* BLOQUE-DDL-FIN */

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.agent_security_run', N'U') AS tabla_corridas,
       OBJECT_ID(N'dbo.agent_security_finding', N'U') AS tabla_hallazgos;
