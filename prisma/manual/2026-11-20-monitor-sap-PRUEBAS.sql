/*
  PASE MANUAL (PRUEBAS) — Monitor del sistema → Base de datos SAP, Vistas SAP y Service Layer. 2026-11-20.
  Pedido de Nicolás Rivera (SynerLink prod, conv. 1, msgs 37106/37107/37126): monitorear el SQL de SAP
  y el Service Layer, y saber si las vistas *B1SLQuery «nos están impactando».
  BASE: KRONOSDB_PRUEBAS (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; solo crea; no toca tablas existentes):
    1. dbo.sap_monitor_sample          — foto cada minuto del SQL de SAP (bloqueos, consultas largas, transacciones).
    2. dbo.sap_monitor_incident        — un registro por incidente (bloqueo / consulta larga / transacción abierta).
    3. dbo.sap_monitor_view_stat       — costo de cada vista *B1SLQuery según la caché de planes (cada 15 min).
    4. dbo.sap_monitor_view_inventory  — vistas *B1SLQuery que existen en cada base de SAP.
    5. dbo.sap_monitor_sl_view         — llamadas a vistas por el Service Layer (access log), por IP y empresa, en ventanas de 5 min.
    6. dbo.sap_monitor_sl_node         — handles y memoria de cada nodo del Service Layer.
    7. dbo.sap_monitor_sl_session      — logins / logouts del Service Layer por hora, IP, empresa y usuario.
  Las alertas reutilizan dbo.system_metric_alert y sus suscriptores (no se crean tablas de alertas).
  Sin modelo Prisma: lib/sap-monitor/store.ts. Retención: 30 días (la limpia el propio monitor).

  ORDEN: antes o después del código. Sin las tablas, la pantalla dice «aún no habilitado» y el monitor se pausa.
  REVERSA: prisma/manual/2026-11-20-monitor-sap-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51701, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

BEGIN TRY
BEGIN TRAN;

/* BLOQUE-DDL-INICIO */
IF OBJECT_ID(N'dbo.sap_monitor_sample', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.sap_monitor_sample (
    id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sap_monitor_sample PRIMARY KEY NONCLUSTERED,
    sampled_at      DATETIME2(0)   NOT NULL,             -- UTC
    probe_ms        INT            NULL,                 -- lo que tardó la lectura en el SQL de SAP
    user_sessions   INT            NULL,
    active_requests INT            NULL,
    blocked         INT            NULL,
    max_block_s     INT            NULL,
    long_requests   INT            NULL,
    max_request_s   INT            NULL,
    open_tx         INT            NULL,
    max_tx_s        INT            NULL,
    waits_json      NVARCHAR(2000) NULL,                 -- esperas del último minuto (delta), top 8
    detail_json     NVARCHAR(MAX)  NULL,                 -- listas en vivo (solo si hay algo que mostrar)
    error           NVARCHAR(300)  NULL
  );
  CREATE CLUSTERED INDEX IX_sap_monitor_sample_at ON dbo.sap_monitor_sample (sampled_at);
END;

IF OBJECT_ID(N'dbo.sap_monitor_incident', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.sap_monitor_incident (
    id             BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sap_monitor_incident PRIMARY KEY NONCLUSTERED,
    incident_key   NVARCHAR(120)  NOT NULL,
    kind           VARCHAR(20)    NOT NULL,              -- 'bloqueo' | 'consulta' | 'transaccion'
    first_seen     DATETIME2(0)   NOT NULL,
    last_seen      DATETIME2(0)   NOT NULL,
    max_seconds    INT            NOT NULL,
    max_blocked    INT            NULL,
    session_id     INT            NULL,
    database_name  NVARCHAR(128)  NULL,
    host_name      NVARCHAR(128)  NULL,
    login_name     NVARCHAR(128)  NULL,
    program_name   NVARCHAR(128)  NULL,
    wait_resource  NVARCHAR(256)  NULL,
    statement      NVARCHAR(400)  NULL,
    CONSTRAINT CK_sap_monitor_incident_kind CHECK (kind IN ('bloqueo', 'consulta', 'transaccion'))
  );
  CREATE CLUSTERED INDEX IX_sap_monitor_incident_seen ON dbo.sap_monitor_incident (last_seen);
  CREATE UNIQUE NONCLUSTERED INDEX UX_sap_monitor_incident_key ON dbo.sap_monitor_incident (incident_key);
END;

IF OBJECT_ID(N'dbo.sap_monitor_view_stat', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.sap_monitor_view_stat (
    id                 BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sap_monitor_view_stat PRIMARY KEY NONCLUSTERED,
    sampled_at         DATETIME2(0)  NOT NULL,
    database_name      NVARCHAR(128) NOT NULL,
    view_name          NVARCHAR(128) NOT NULL,
    plans              INT           NOT NULL,
    executions         BIGINT        NOT NULL,           -- acumulado según la caché de planes
    total_elapsed_ms   BIGINT        NOT NULL,
    total_cpu_ms       BIGINT        NOT NULL,
    total_reads        BIGINT        NOT NULL,
    max_elapsed_ms     BIGINT        NOT NULL,
    last_execution_at  DATETIME2(0)  NULL,
    delta_executions   BIGINT        NULL,               -- desde la foto anterior (NULL en la primera)
    delta_elapsed_ms   BIGINT        NULL,
    delta_cpu_ms       BIGINT        NULL,
    delta_reads        BIGINT        NULL
  );
  CREATE CLUSTERED INDEX IX_sap_monitor_view_stat_at ON dbo.sap_monitor_view_stat (sampled_at);
END;

IF OBJECT_ID(N'dbo.sap_monitor_view_inventory', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.sap_monitor_view_inventory (
    database_name  NVARCHAR(128) NOT NULL,
    view_name      NVARCHAR(128) NOT NULL,
    modified_at    DATETIME2(0)  NULL,
    first_seen     DATETIME2(0)  NOT NULL,
    last_seen      DATETIME2(0)  NOT NULL,
    CONSTRAINT PK_sap_monitor_view_inventory PRIMARY KEY CLUSTERED (database_name, view_name)
  );
END;

IF OBJECT_ID(N'dbo.sap_monitor_sl_view', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.sap_monitor_sl_view (
    id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sap_monitor_sl_view PRIMARY KEY NONCLUSTERED,
    bucket_at   DATETIME2(0)  NOT NULL,                  -- inicio de la ventana de 5 min (UTC)
    view_name   NVARCHAR(128) NOT NULL,
    source_ip   VARCHAR(45)   NOT NULL,
    company     NVARCHAR(128) NULL,
    calls       INT           NOT NULL,
    errors      INT           NOT NULL,                  -- 4xx/5xx
    timeouts    INT           NOT NULL,                  -- 502/504 o >= 290 s
    total_ms    BIGINT        NOT NULL,
    max_ms      INT           NOT NULL,
    bytes       BIGINT        NOT NULL
  );
  CREATE CLUSTERED INDEX IX_sap_monitor_sl_view_bucket ON dbo.sap_monitor_sl_view (bucket_at);
END;

IF OBJECT_ID(N'dbo.sap_monitor_sl_node', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.sap_monitor_sl_node (
    id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sap_monitor_sl_node PRIMARY KEY NONCLUSTERED,
    sampled_at  DATETIME2(0)  NOT NULL,
    service     NVARCHAR(40)  NOT NULL,                  -- b1s50000 … b1s50010
    pid         INT           NOT NULL,
    handles     INT           NOT NULL,
    mem_mb      INT           NOT NULL,
    threads     INT           NULL,
    started_at  DATETIME2(0)  NULL
  );
  CREATE CLUSTERED INDEX IX_sap_monitor_sl_node_at ON dbo.sap_monitor_sl_node (sampled_at);
END;

IF OBJECT_ID(N'dbo.sap_monitor_sl_session', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.sap_monitor_sl_session (
    id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sap_monitor_sl_session PRIMARY KEY NONCLUSTERED,
    bucket_at   DATETIME2(0)  NOT NULL,                  -- inicio de la hora (UTC)
    source_ip   VARCHAR(45)   NOT NULL,
    company     NVARCHAR(128) NOT NULL,
    sl_user     NVARCHAR(128) NOT NULL,
    logins      INT           NOT NULL,
    logouts     INT           NOT NULL,
    restores    INT           NOT NULL,
    failures    INT           NOT NULL
  );
  CREATE CLUSTERED INDEX IX_sap_monitor_sl_session_bucket ON dbo.sap_monitor_sl_session (bucket_at);
END;
/* BLOQUE-DDL-FIN */

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT name, create_date FROM sys.tables WHERE name LIKE N'sap[_]monitor[_]%' ORDER BY name;
