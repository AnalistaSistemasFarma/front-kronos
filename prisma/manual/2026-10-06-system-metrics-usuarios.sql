/*
  PASE MANUAL — Monitor del sistema: CONSUMO POR USUARIO.

  QUÉ ES: una tabla nueva, sin tocar ninguna existente.
    - dbo.system_metric_user   resumen cada 5 minutos por usuario (por proceso de Kronos):
                               peticiones, errores, tiempo de servidor total / máximo / p95 y el
                               módulo donde más tiempo gastó. El usuario sale de su sesión de Kronos.

  Requiere haber corrido antes 2026-10-05-system-metrics.sql (mismo módulo).
  Si esta tabla no existe, el resto del monitor sigue funcionando y la pantalla avisa.

  VOLUMEN ESPERADO: una fila por usuario activo cada 5 minutos por instancia
  (p. ej. 60 usuarios activos en horario laboral ≈ 6.000–12.000 filas/día).
  El colector borra lo que tenga más de 14 días, igual que las otras tablas.

  CÓMO CORRERLO: primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.
  Es idempotente. Reversa: 2026-10-06-system-metrics-usuarios-reversa.sql
*/

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.system_metric_user', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.system_metric_user (
      id           BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_system_metric_user PRIMARY KEY NONCLUSTERED,
      bucket_at    DATETIME2(0)   NOT NULL,              -- UTC, inicio de la ventana de 5 min
      host         NVARCHAR(128)  NOT NULL,
      instance     NVARCHAR(16)   NOT NULL,
      user_email   NVARCHAR(320)  NOT NULL,
      user_name    NVARCHAR(200)  NULL,
      requests     INT            NOT NULL,
      errors       INT            NOT NULL,
      total_ms     BIGINT         NOT NULL,              -- tiempo de servidor que generó en la ventana
      max_ms       INT            NOT NULL,
      p95_ms       INT            NOT NULL,
      top_module   NVARCHAR(80)   NULL                   -- módulo donde más tiempo gastó
    );
    CREATE CLUSTERED INDEX IX_system_metric_user_bucket ON dbo.system_metric_user (bucket_at);
  END

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT name AS tabla FROM sys.tables WHERE name = 'system_metric_user';
