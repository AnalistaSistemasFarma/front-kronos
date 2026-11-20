/*
  PASE MANUAL (PROD) — Auditoría de agentes → Vulnerabilidades → «Lo más reciente y crítico». 2026-11-20.
  Pedido de Nicolás Rivera (2026-11-20, SynerLink conv. 1 msg 37017): ver las vulnerabilidades más recientes y
  críticas del mundo (CISA KEV + NVD) y saber si el software de terceros que usamos (SAP Business One, Tomcat,
  SAP JVM, SQL Server, IIS, Windows Server, Node.js…) está afectado.
  BASE: KRONOSDB (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; solo crea; no toca tablas existentes):
    1. dbo.agent_threat_sync      — actualizaciones del catálogo (pendiente → en_curso → terminado | fallido).
    2. dbo.agent_threat_cve       — caché de CVE (KEV + NVD + EPSS), una fila por CVE.
    3. dbo.agent_threat_inventory — inventario editable de software de terceros (producto, fabricante, versión,
                                    rol del equipo, claves CPE). SIN direcciones IP ni nombres de servidor.
  Sin modelo Prisma (igual que las demás tablas de auditoría): lib/agent-audit/threats-db.ts.
  ORDEN: antes o después del código. Sin las tablas, la pestaña dice «aún no habilitada».
  ANTES: respaldo COPY_ONLY. No toca datos existentes. Carga inicial del inventario: 2026-11-20-vulnerabilidades-criticas-inventario-PROD.sql
  REVERSA: prisma/manual/2026-11-20-vulnerabilidades-criticas-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51642, N'Base no esperada: este script es solo para KRONOSDB.', 1;

BEGIN TRY
BEGIN TRAN;

/* BLOQUE-DDL-INICIO */
/* ---- dbo.agent_threat_sync: actualizaciones del catálogo -------------------- */
IF OBJECT_ID(N'[dbo].[agent_threat_sync]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_threat_sync] (
    [id_sync]        INT            IDENTITY(1,1) NOT NULL,
    [origen]         NVARCHAR(20)   NOT NULL,
    [status]         NVARCHAR(20)   NOT NULL,
    [requested_by]   NVARCHAR(200)  NULL,
    [requested_at]   DATETIME2      NOT NULL CONSTRAINT [agent_threat_sync_requested_at_df] DEFAULT sysutcdatetime(),
    [started_at]     DATETIME2      NULL,
    [finished_at]    DATETIME2      NULL,
    [progreso]       NVARCHAR(200)  NULL,
    [kev]            INT            NULL,
    [nvd]            INT            NULL,
    [cves]           INT            NULL,
    [resumen]        NVARCHAR(2000) NULL,
    [error_summary]  NVARCHAR(1000) NULL,
    CONSTRAINT [agent_threat_sync_pkey] PRIMARY KEY CLUSTERED ([id_sync]),
    CONSTRAINT [CK_agent_threat_sync_status] CHECK ([status] IN (N'pendiente', N'en_curso', N'terminado', N'fallido')),
    CONSTRAINT [CK_agent_threat_sync_origen] CHECK ([origen] IN (N'manual', N'programado'))
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_threat_sync_estado' AND object_id = OBJECT_ID(N'[dbo].[agent_threat_sync]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_threat_sync_estado] ON [dbo].[agent_threat_sync]([status], [requested_at] DESC);');

/* ---- dbo.agent_threat_cve: caché de CVE (KEV + NVD + EPSS) ------------------ */
IF OBJECT_ID(N'[dbo].[agent_threat_cve]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_threat_cve] (
    [cve_id]          NVARCHAR(30)   NOT NULL,
    [titulo_en]       NVARCHAR(300)  NULL,
    [descripcion]     NVARCHAR(2000) NULL,
    [cwes]            NVARCHAR(200)  NULL,
    [cvss]            DECIMAL(3,1)   NULL,
    [severidad]       NVARCHAR(12)   NOT NULL,
    [publicada]       DATETIME2      NULL,
    [modificada]      DATETIME2      NULL,
    [kev]             BIT            NOT NULL CONSTRAINT [agent_threat_cve_kev_df] DEFAULT 0,
    [kev_agregada]    DATETIME2      NULL,
    [kev_vence]       DATETIME2      NULL,
    [kev_ransomware]  BIT            NOT NULL CONSTRAINT [agent_threat_cve_kev_ransomware_df] DEFAULT 0,
    [kev_fabricante]  NVARCHAR(150)  NULL,
    [kev_producto]    NVARCHAR(200)  NULL,
    [epss]            DECIMAL(6,5)   NULL,
    [cpes]            NVARCHAR(MAX)  NULL,
    [nvd_at]          DATETIME2      NULL,
    [updated_at]      DATETIME2      NOT NULL CONSTRAINT [agent_threat_cve_updated_at_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [agent_threat_cve_pkey] PRIMARY KEY CLUSTERED ([cve_id]),
    CONSTRAINT [CK_agent_threat_cve_severidad] CHECK ([severidad] IN (N'critica', N'alta', N'media', N'baja', N'desconocida'))
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_threat_cve_fechas' AND object_id = OBJECT_ID(N'[dbo].[agent_threat_cve]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_threat_cve_fechas] ON [dbo].[agent_threat_cve]([publicada] DESC, [kev_agregada] DESC);');

/* ---- dbo.agent_threat_inventory: software de terceros (sin IP ni servidor) -- */
IF OBJECT_ID(N'[dbo].[agent_threat_inventory]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_threat_inventory] (
    [id_item]      INT            IDENTITY(1,1) NOT NULL,
    [producto]     NVARCHAR(150)  NOT NULL,
    [fabricante]   NVARCHAR(100)  NOT NULL,
    [version]      NVARCHAR(80)   NULL,
    [rol]          NVARCHAR(100)  NOT NULL,
    [cpe]          NVARCHAR(400)  NOT NULL,
    [palabras]     NVARCHAR(300)  NULL,
    [notas]        NVARCHAR(500)  NULL,
    [activo]       BIT            NOT NULL CONSTRAINT [agent_threat_inventory_activo_df] DEFAULT 1,
    [created_at]   DATETIME2      NOT NULL CONSTRAINT [agent_threat_inventory_created_at_df] DEFAULT sysutcdatetime(),
    [updated_by]   NVARCHAR(200)  NULL,
    [updated_at]   DATETIME2      NOT NULL CONSTRAINT [agent_threat_inventory_updated_at_df] DEFAULT sysutcdatetime(),
    CONSTRAINT [agent_threat_inventory_pkey] PRIMARY KEY CLUSTERED ([id_item])
  );
END;
/* BLOQUE-DDL-FIN */

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.agent_threat_sync', N'U') AS tabla_actualizaciones,
       OBJECT_ID(N'dbo.agent_threat_cve', N'U') AS tabla_cve,
       OBJECT_ID(N'dbo.agent_threat_inventory', N'U') AS tabla_inventario;
