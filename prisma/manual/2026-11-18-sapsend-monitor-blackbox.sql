/*
  PASE MANUAL — Caja negra del Monitor SAPSEND / Service Layer.

  QUÉ ES: tablas nuevas en la base de Kronos (KRONOSDB / KRONOSDB_PRUEBAS), sin tocar
  ninguna existente ni datos de negocio de SAPSEND/SBO.
    - dbo.sapsend_monitor_sample   foto cada ~15 s: concurrencia por empresa/base,
                                   semáforo y latencia de pulso Service Layer.
    - dbo.sapsend_monitor_block    bloqueos activos en esa misma foto (cadena
                                   bloqueador → bloqueado, espera, consulta).
    - dbo.sapsend_monitor_heavy    consultas > 5 s vistas en esa foto.

  Solo lectura hacia DMVs del SQL Server (VIEW SERVER STATE). El colector escribe
  aquí; la pantalla lee. Si las tablas no existen, el monitor en vivo sigue
  funcionando y avisa que falta la caja negra.

  VOLUMEN: ~5.700 filas/día en sample (si corre 24×7), bloques/heavies solo cuando
  hay algo que guardar. Retención sugerida: 14 días (el colector limpia).

  CÓMO CORRERLO: primero KRONOSDB_PRUEBAS; luego KRONOSDB con autorización.
  Idempotente. Reversa: 2026-11-18-sapsend-monitor-blackbox-reversa.sql
*/

SET XACT_ABORT ON;

SELECT 'antes' AS momento, name AS tabla
FROM sys.tables
WHERE name IN (
  'sapsend_monitor_sample',
  'sapsend_monitor_block',
  'sapsend_monitor_heavy'
);

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.sapsend_monitor_sample', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.sapsend_monitor_sample (
      id                  BIGINT IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_sapsend_monitor_sample PRIMARY KEY NONCLUSTERED,
      sampled_at          DATETIME2(0)  NOT NULL,           -- UTC
      host                NVARCHAR(128) NOT NULL,           -- hostname Kronos
      instance            NVARCHAR(16)  NOT NULL,           -- instancia pm2
      id_company          INT           NULL,
      company_name        NVARCHAR(200) NULL,
      sapsend_db          NVARCHAR(128) NULL,               -- ej. SAPSEND_GSS
      sap_db              NVARCHAR(128) NULL,               -- si aplica en este SQL
      -- Concurrencia SAPSEND (DMV)
      ss_sessions         INT           NULL,
      ss_running          INT           NULL,
      ss_blocked          INT           NULL,
      -- Concurrencia SAP / SBO en este SQL (si la base está aquí)
      sap_sessions        INT           NULL,
      sap_running         INT           NULL,
      sap_blocked         INT           NULL,
      sap_sl_sessions     INT           NULL,               -- program Service Layer
      sap_sapsend_sessions INT          NULL,               -- program SAPSEND
      sap_client_sessions INT           NULL,               -- cliente SAP B1
      -- Pulso HTTP Service Layer (ms); null = no probado / falló
      sl_pulse_ms         INT           NULL,
      sl_pulse_ok         BIT           NULL,
      -- SynerLink → SAPSEND (esta instancia)
      syn_inflight        INT           NULL,
      syn_open_sessions   INT           NULL,
      syn_errors_5m       INT           NULL,
      -- Semáforo calculado: ok | warning | critical | idle | unknown
      status              NVARCHAR(16)  NOT NULL
        CONSTRAINT DF_sapsend_monitor_sample_status DEFAULT N'unknown',
      note                NVARCHAR(400) NULL
    );
    CREATE CLUSTERED INDEX IX_sapsend_monitor_sample_sampled_at
      ON dbo.sapsend_monitor_sample (sampled_at);
    CREATE NONCLUSTERED INDEX IX_sapsend_monitor_sample_company
      ON dbo.sapsend_monitor_sample (id_company, sampled_at);
  END

  IF OBJECT_ID(N'dbo.sapsend_monitor_block', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.sapsend_monitor_block (
      id                    BIGINT IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_sapsend_monitor_block PRIMARY KEY NONCLUSTERED,
      sampled_at            DATETIME2(0)  NOT NULL,
      host                  NVARCHAR(128) NOT NULL,
      instance              NVARCHAR(16)  NOT NULL,
      database_name         NVARCHAR(128) NULL,
      blocked_session_id    INT           NOT NULL,
      blocking_session_id   INT           NOT NULL,
      wait_type             NVARCHAR(120) NULL,
      wait_ms               INT           NULL,
      blocked_program       NVARCHAR(256) NULL,
      blocking_program      NVARCHAR(256) NULL,
      blocked_login         NVARCHAR(128) NULL,
      blocking_login        NVARCHAR(128) NULL,
      blocked_sql           NVARCHAR(MAX) NULL,
      blocking_sql          NVARCHAR(MAX) NULL,
      id_company            INT           NULL,
      company_name          NVARCHAR(200) NULL
    );
    CREATE CLUSTERED INDEX IX_sapsend_monitor_block_sampled_at
      ON dbo.sapsend_monitor_block (sampled_at);
  END

  IF OBJECT_ID(N'dbo.sapsend_monitor_heavy', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.sapsend_monitor_heavy (
      id              BIGINT IDENTITY(1,1) NOT NULL
        CONSTRAINT PK_sapsend_monitor_heavy PRIMARY KEY NONCLUSTERED,
      sampled_at      DATETIME2(0)  NOT NULL,
      host            NVARCHAR(128) NOT NULL,
      instance        NVARCHAR(16)  NOT NULL,
      database_name   NVARCHAR(128) NULL,
      session_id      INT           NOT NULL,
      program_name    NVARCHAR(256) NULL,
      login_name      NVARCHAR(128) NULL,
      status          NVARCHAR(60)  NULL,
      wait_type       NVARCHAR(120) NULL,
      elapsed_ms      INT           NULL,
      cpu_ms          INT           NULL,
      sql_text        NVARCHAR(MAX) NULL,
      id_company      INT           NULL,
      company_name    NVARCHAR(200) NULL
    );
    CREATE CLUSTERED INDEX IX_sapsend_monitor_heavy_sampled_at
      ON dbo.sapsend_monitor_heavy (sampled_at);
  END

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT 'despues' AS momento, name AS tabla
FROM sys.tables
WHERE name IN (
  'sapsend_monitor_sample',
  'sapsend_monitor_block',
  'sapsend_monitor_heavy'
);
