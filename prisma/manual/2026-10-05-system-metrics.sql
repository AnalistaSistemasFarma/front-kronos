/*
  PASE MANUAL — Módulo "Monitor del sistema" (consumo de servidor y base de datos de SynerLink).

  QUÉ ES: tres tablas nuevas, sin tocar ninguna existente.
    - dbo.system_metric_sample  una fila por proceso de Kronos (instancia pm2) por minuto:
                                CPU, memoria, event loop, peticiones, pool SQL, CPU/RAM del servidor.
    - dbo.system_metric_route   resumen cada 5 minutos por ruta (peticiones que entran a Kronos)
                                y por servicio externo (Graph, Orion, SAP…): cantidad, tiempos,
                                errores y 429.
    - dbo.system_metric_db      foto de SQL Server cada 5 minutos (solo la instancia 0):
                                CPU de SQL, conexiones, consultas activas y bloqueadas, tamaño.

  No hay modelo Prisma: lib/system-metrics/store.ts usa withMssqlPool, así que el código NO
  falla si las tablas aún no existen (el colector se pausa y la pantalla avisa).

  VOLUMEN ESPERADO (2 instancias pm2): ~2.900 filas/día en sample, ~10.000–25.000 en route,
  ~290 en db. El colector borra lo que tenga más de 14 días (en lotes pequeños, una vez al día).

  CÓMO CORRERLO: primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.
  Es idempotente: cada objeto se crea solo si no existe. Reversa: 2026-10-05-system-metrics-reversa.sql
*/

SET XACT_ABORT ON;

SELECT 'antes' AS momento, name AS tabla FROM sys.tables
WHERE name IN ('system_metric_sample', 'system_metric_route', 'system_metric_db');

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.system_metric_sample', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.system_metric_sample (
      id                 BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_system_metric_sample PRIMARY KEY NONCLUSTERED,
      sampled_at         DATETIME2(0)   NOT NULL,          -- UTC
      host               NVARCHAR(128)  NOT NULL,
      instance           NVARCHAR(16)   NOT NULL,
      pid                INT            NOT NULL,
      cpu_pct            DECIMAL(6,2)   NULL,              -- % del servidor completo usado por este proceso
      rss_mb             INT            NULL,
      heap_used_mb       INT            NULL,
      event_loop_p50_ms  DECIMAL(9,2)   NULL,
      event_loop_p99_ms  DECIMAL(9,2)   NULL,
      event_loop_max_ms  DECIMAL(9,2)   NULL,
      host_cpu_pct       DECIMAL(6,2)   NULL,
      host_mem_used_pct  DECIMAL(5,2)   NULL,
      host_mem_total_mb  INT            NULL,
      http_requests      INT            NOT NULL CONSTRAINT DF_system_metric_sample_http_requests DEFAULT 0,
      http_errors        INT            NOT NULL CONSTRAINT DF_system_metric_sample_http_errors DEFAULT 0,
      http_p95_ms        INT            NULL,
      out_requests       INT            NOT NULL CONSTRAINT DF_system_metric_sample_out_requests DEFAULT 0,
      out_errors         INT            NOT NULL CONSTRAINT DF_system_metric_sample_out_errors DEFAULT 0,
      out_throttled      INT            NOT NULL CONSTRAINT DF_system_metric_sample_out_throttled DEFAULT 0,
      pool_size          SMALLINT       NULL,
      pool_available     SMALLINT       NULL,
      pool_borrowed      SMALLINT       NULL,
      pool_pending       SMALLINT       NULL
    );
    CREATE CLUSTERED INDEX IX_system_metric_sample_sampled_at ON dbo.system_metric_sample (sampled_at);
  END

  IF OBJECT_ID(N'dbo.system_metric_route', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.system_metric_route (
      id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_system_metric_route PRIMARY KEY NONCLUSTERED,
      bucket_at       DATETIME2(0)   NOT NULL,             -- UTC, inicio de la ventana de 5 min
      host            NVARCHAR(128)  NOT NULL,
      instance        NVARCHAR(16)   NOT NULL,
      direction       CHAR(3)        NOT NULL,             -- 'in' (entra a Kronos) / 'out' (servicio externo)
      route_key       NVARCHAR(300)  NOT NULL,
      module          NVARCHAR(80)   NOT NULL,
      requests        INT            NOT NULL,
      errors          INT            NOT NULL,
      client_errors   INT            NOT NULL,
      throttled       INT            NOT NULL,
      total_ms        BIGINT         NOT NULL,
      max_ms          INT            NOT NULL,
      p95_ms          INT            NOT NULL
    );
    CREATE CLUSTERED INDEX IX_system_metric_route_bucket ON dbo.system_metric_route (bucket_at, direction);
  END

  IF OBJECT_ID(N'dbo.system_metric_db', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.system_metric_db (
      id                 BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_system_metric_db PRIMARY KEY NONCLUSTERED,
      sampled_at         DATETIME2(0)   NOT NULL,
      has_server_state   BIT            NOT NULL,          -- 0 = sin permiso VIEW SERVER STATE (datos parciales)
      sql_cpu_pct        DECIMAL(6,2)   NULL,              -- CPU del servidor usada por SQL Server
      other_cpu_pct      DECIMAL(6,2)   NULL,              -- CPU usada por otros programas del servidor SQL
      user_connections   INT            NULL,              -- conexiones de usuario en todo el servidor SQL
      db_sessions        INT            NULL,              -- sesiones conectadas a ESTA base
      active_requests    INT            NULL,              -- consultas ejecutándose en esta base
      blocked_requests   INT            NULL,              -- consultas esperando por un bloqueo
      longest_wait_ms    INT            NULL,
      db_size_mb         INT            NULL,
      log_used_pct       DECIMAL(5,2)   NULL
    );
    CREATE CLUSTERED INDEX IX_system_metric_db_sampled_at ON dbo.system_metric_db (sampled_at);
  END

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT 'despues' AS momento, name AS tabla FROM sys.tables
WHERE name IN ('system_metric_sample', 'system_metric_route', 'system_metric_db');

/*
  OPCIONAL (lo corre el DBA, no la app): para ver CPU de SQL, conexiones de todo el servidor,
  bloqueos y consultas más pesadas, el usuario SQL de Kronos necesita leer las vistas del sistema.
  Es SOLO LECTURA. Sin esto el monitor funciona, pero la sección de base de datos queda parcial.

    USE master;
    GRANT VIEW SERVER STATE TO [<login_de_kronos>];          -- SQL Server 2019 o anterior
    -- GRANT VIEW SERVER PERFORMANCE STATE TO [<login_de_kronos>];  -- alternativa más acotada en SQL Server 2022
*/
