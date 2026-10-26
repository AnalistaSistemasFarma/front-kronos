/*
  PASE MANUAL — Monitor del sistema: REPARTO REAL POR MÓDULO DE CADA PERSONA.

  QUÉ ES: una tabla nueva, sin tocar ninguna existente.
    - dbo.system_metric_user_module   cada 5 minutos, por persona y por módulo de Kronos:
                                      peticiones y tiempo de servidor.

  POR QUÉ: system_metric_user solo guarda el módulo PRINCIPAL de cada ventana, y la pantalla
  le asignaba todo el tiempo a ese módulo. Quien usaba 55 % Solicitudes y 45 % Compras salía
  "100 % en Solicitudes". Con esta tabla la pestaña Usuarios muestra el reparto real.

  Requiere haber corrido antes 2026-10-06-system-metrics-usuarios.sql (mismo módulo).
  Si esta tabla no existe, el resto del monitor sigue funcionando y la pestaña Usuarios usa
  el reparto aproximado de antes.

  VOLUMEN ESPERADO: 1 a 4 filas por persona activa cada 5 minutos por instancia
  (p. ej. 60 personas activas ≈ 15.000–40.000 filas/día). El colector borra lo que tenga más
  de 14 días, igual que las otras tablas del monitor.

  CÓMO CORRERLO: primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.
  Es idempotente. Reversa: 2026-10-20-system-metrics-usuario-modulo-reversa.sql
*/

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.system_metric_user_module', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.system_metric_user_module (
      id           BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_system_metric_user_module PRIMARY KEY NONCLUSTERED,
      bucket_at    DATETIME2(0)   NOT NULL,              -- UTC, inicio de la ventana de 5 min
      host         NVARCHAR(128)  NOT NULL,
      instance     NVARCHAR(16)   NOT NULL,
      user_email   NVARCHAR(320)  NOT NULL,
      module       NVARCHAR(80)   NOT NULL,
      requests     INT            NOT NULL,
      total_ms     BIGINT         NOT NULL               -- tiempo de servidor en ese módulo
    );
    CREATE CLUSTERED INDEX IX_system_metric_user_module_bucket ON dbo.system_metric_user_module (bucket_at);
  END

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT name AS tabla FROM sys.tables WHERE name = 'system_metric_user_module';

/*
  ESTADO POR AMBIENTE
  - KRONOSDB_PRUEBAS: pendiente.
  - KRONOSDB (producción): solo con autorización.
*/
