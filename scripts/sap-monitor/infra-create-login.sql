/*
  INFRAESTRUCTURA (Ing. Cristian) — login de SOLO LECTURA para el Monitor SAP de SynerLink.
  Se corre UNA VEZ en el SQL Server de SAP (instancia MSSQLSERVER de serfarma07) con un usuario sysadmin.

  QUÉ DA:
    - VIEW SERVER STATE      → leer las vistas del sistema (sys.dm_exec_requests, dm_tran_*, dm_os_wait_stats, dm_exec_query_stats).
    - VIEW ANY DEFINITION    → ver la definición de las vistas *B1SLQuery (metadatos, no datos).
    - CONNECT ANY DATABASE   → (opcional) listar las vistas *B1SLQuery de cada base de empresa. NO da permiso de leer
                               tablas ni vistas: sin SELECT, el login no puede consultar datos de SAP.
  QUÉ NO DA: ningún rol de base (ni db_datareader), ningún permiso de escritura, nada sobre SBO-COMMON.

  DESPUÉS: entregar la cadena a quien administra el .env de SynerLink (testing primero) como
    SAP_SQL_MONITOR_URL=sqlserver://<host>:1433;database=master;user=synerlink_monitor;password=<clave>;encrypt=true;trustServerCertificate=true
  Nunca por chat ni correo en claro.

  REVERSA:
    DROP LOGIN [synerlink_monitor];
*/
SET NOCOUNT ON;
USE [master];

IF SUSER_ID(N'synerlink_monitor') IS NULL
  -- Reemplace la clave (mínimo 20 caracteres) antes de correr. CHECK_POLICY aplica la política de Windows.
  CREATE LOGIN [synerlink_monitor] WITH PASSWORD = N'<<CAMBIAR-CLAVE-LARGA>>',
    DEFAULT_DATABASE = [master], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;

GRANT VIEW SERVER STATE TO [synerlink_monitor];
GRANT VIEW ANY DEFINITION TO [synerlink_monitor];
-- Opcional (SQL Server 2014+): inventario de vistas *B1SLQuery por base. Si prefiere no darlo, el monitor
-- igual ve el costo de las vistas por la caché de planes y por el log del Service Layer.
GRANT CONNECT ANY DATABASE TO [synerlink_monitor];

-- Verificación: debe dar 1, 1, 1 y 0 en la última columna (no puede leer datos).
EXECUTE AS LOGIN = N'synerlink_monitor';
SELECT HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW SERVER STATE')   AS view_server_state,
       HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW ANY DEFINITION') AS view_any_definition,
       HAS_PERMS_BY_NAME(NULL, NULL, 'CONNECT ANY DATABASE') AS connect_any_database,
       IS_SRVROLEMEMBER('sysadmin')                          AS es_sysadmin;
REVERT;
