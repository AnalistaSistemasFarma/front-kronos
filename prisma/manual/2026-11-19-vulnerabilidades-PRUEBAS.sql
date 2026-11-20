/*
  PASE MANUAL (PRUEBAS) — Auditoría de agentes → Vulnerabilidades (OSV). 2026-11-19.
  Pedido de Nicolás Rivera (2026-11-19): consumir la API de OSV (osv.dev) para conocer las vulnerabilidades
  recientes de las dependencias de nuestros desarrollos todo el tiempo y protegernos rápido.
  BASE: KRONOSDB_PRUEBAS (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; solo crea; no toca tablas existentes):
    1. dbo.agent_vuln_run     — escaneos (pendiente → en_curso → terminado | fallido).
    2. dbo.agent_vuln_finding — paquete afectado × vulnerabilidad × repositorio, con estado de revisión.
  Sin modelo Prisma (igual que el análisis de seguridad): lib/agent-audit/vulns-db.ts.
  ORDEN: antes o después del código. Sin las tablas, la pantalla dice «aún no habilitado».
  No toca datos existentes.
  REVERSA: prisma/manual/2026-11-19-vulnerabilidades-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51621, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

BEGIN TRY
BEGIN TRAN;

/* BLOQUE-DDL-INICIO */
/* ---- dbo.agent_vuln_run: escaneos de vulnerabilidades ----------------------- */
IF OBJECT_ID(N'[dbo].[agent_vuln_run]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_vuln_run] (
    [id_run]          INT            IDENTITY(1,1) NOT NULL,
    [origen]          NVARCHAR(20)   NOT NULL,
    [status]          NVARCHAR(20)   NOT NULL,
    [requested_by]    NVARCHAR(200)  NULL,
    [requested_at]    DATETIME2      NOT NULL CONSTRAINT [agent_vuln_run_requested_at_df] DEFAULT sysutcdatetime(),
    [started_at]      DATETIME2      NULL,
    [finished_at]     DATETIME2      NULL,
    [progreso]        NVARCHAR(200)  NULL,
    [repos]           INT            NULL,
    [paquetes]        INT            NULL,
    [hallazgos]       INT            NULL,
    [criticas]        INT            NULL,
    [altas]           INT            NULL,
    [nuevas]          INT            NULL,
    [resumen]         NVARCHAR(2000) NULL,
    [error_summary]   NVARCHAR(1000) NULL,
    CONSTRAINT [agent_vuln_run_pkey] PRIMARY KEY CLUSTERED ([id_run]),
    CONSTRAINT [CK_agent_vuln_run_status] CHECK ([status] IN (N'pendiente', N'en_curso', N'terminado', N'fallido')),
    CONSTRAINT [CK_agent_vuln_run_origen] CHECK ([origen] IN (N'manual', N'programado'))
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_vuln_run_estado' AND object_id = OBJECT_ID(N'[dbo].[agent_vuln_run]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_vuln_run_estado] ON [dbo].[agent_vuln_run]([status], [requested_at] DESC);');

/* ---- dbo.agent_vuln_finding: paquete afectado × vulnerabilidad × repositorio -- */
IF OBJECT_ID(N'[dbo].[agent_vuln_finding]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_vuln_finding] (
    [id_finding]       INT            IDENTITY(1,1) NOT NULL,
    [id_run]           INT            NOT NULL,
    [repo]             NVARCHAR(150)  NOT NULL,
    [rama]             NVARCHAR(100)  NOT NULL,
    [archivo]          NVARCHAR(300)  NOT NULL,
    [ecosistema]       NVARCHAR(30)   NOT NULL,
    [paquete]          NVARCHAR(250)  NOT NULL,
    [version]          NVARCHAR(80)   NOT NULL,
    [directa]          BIT            NOT NULL CONSTRAINT [agent_vuln_finding_directa_df] DEFAULT 0,
    [vuln_id]          NVARCHAR(80)   NOT NULL,
    [alias]            NVARCHAR(400)  NULL,
    [resumen]          NVARCHAR(600)  NULL,
    [severidad]        NVARCHAR(12)   NOT NULL,
    [publicada]        DATETIME2      NULL,
    [modificada]       DATETIME2      NULL,
    [version_corregida] NVARCHAR(200) NULL,
    [referencia]       NVARCHAR(500)  NULL,
    [primera_vez]      DATETIME2      NOT NULL,
    [estado]           NVARCHAR(20)   NOT NULL CONSTRAINT [agent_vuln_finding_estado_df] DEFAULT N'nuevo',
    [revisado_por]     NVARCHAR(200)  NULL,
    [revisado_at]      DATETIME2      NULL,
    [nota]             NVARCHAR(1000) NULL,
    CONSTRAINT [agent_vuln_finding_pkey] PRIMARY KEY CLUSTERED ([id_finding]),
    CONSTRAINT [FK_agent_vuln_finding_run] FOREIGN KEY ([id_run]) REFERENCES [dbo].[agent_vuln_run]([id_run]) ON DELETE CASCADE,
    CONSTRAINT [CK_agent_vuln_finding_severidad] CHECK ([severidad] IN (N'critica', N'alta', N'media', N'baja', N'desconocida')),
    CONSTRAINT [CK_agent_vuln_finding_estado] CHECK ([estado] IN (N'nuevo', N'en_revision', N'corregido', N'aceptado', N'falso_positivo'))
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_vuln_finding_run' AND object_id = OBJECT_ID(N'[dbo].[agent_vuln_finding]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_vuln_finding_run] ON [dbo].[agent_vuln_finding]([id_run], [severidad]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_vuln_finding_clave' AND object_id = OBJECT_ID(N'[dbo].[agent_vuln_finding]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_vuln_finding_clave] ON [dbo].[agent_vuln_finding]([repo], [vuln_id], [paquete]);');
/* BLOQUE-DDL-FIN */

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.agent_vuln_run', N'U') AS tabla_escaneos, OBJECT_ID(N'dbo.agent_vuln_finding', N'U') AS tabla_hallazgos;
