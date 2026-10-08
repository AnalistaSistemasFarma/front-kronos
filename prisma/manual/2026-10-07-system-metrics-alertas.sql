/*
  PASE MANUAL — Monitor del sistema: ALERTAS TEMPRANAS.

  QUÉ ES: una tabla nueva, sin tocar ninguna existente.
    - dbo.system_metric_alert  una fila por cada alerta temprana que se disparó (memoria que se
                               llena, CPU sostenida, congelamientos de la máquina, Kronos duplicado,
                               reinicios, minutos sin datos, SQL bloqueado…), con el texto que se
                               envió: qué pasa, por qué, qué puede pasar y qué hacer.

  Sirve para dos cosas: no repetir el mismo aviso cada minuto (cada alerta espera 30 min si es
  crítica o 2 h si es advertencia antes de repetirse, salvo que empeore) y mostrar el historial
  en la pantalla del monitor. Se notifica (campana + push) a quienes tienen el subproceso
  '/process/system-metrics'.

  Requiere haber corrido antes 2026-10-05-system-metrics.sql (mismo módulo).
  Si esta tabla no existe, NO se envían alertas (para no repetirlas sin control); el resto del
  monitor sigue funcionando y la pantalla avisa.

  VOLUMEN ESPERADO: decenas de filas por semana en un día normal. El colector borra las de más
  de 90 días.

  CÓMO CORRERLO: primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.
  Es idempotente. Reversa: 2026-10-07-system-metrics-alertas-reversa.sql
*/

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.system_metric_alert', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.system_metric_alert (
      id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_system_metric_alert PRIMARY KEY NONCLUSTERED,
      raised_at   DATETIME2(0)   NOT NULL,              -- UTC
      host        NVARCHAR(128)  NOT NULL,
      alert_key   NVARCHAR(120)  NOT NULL,              -- regla + detalle (p. ej. 'sin-datos-2026-10-06T12:30')
      [rule]      NVARCHAR(40)   NOT NULL,
      severity    VARCHAR(10)    NOT NULL,              -- 'warning' | 'critical'
      title       NVARCHAR(300)  NOT NULL,
      happening   NVARCHAR(1000) NOT NULL,
      why         NVARCHAR(1000) NOT NULL,
      risk        NVARCHAR(1000) NOT NULL,
      action      NVARCHAR(1000) NOT NULL,
      notified    INT            NOT NULL               -- personas a las que se envió
    );
    CREATE CLUSTERED INDEX IX_system_metric_alert_raised ON dbo.system_metric_alert (raised_at);
  END

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT name AS tabla FROM sys.tables WHERE name = 'system_metric_alert';
