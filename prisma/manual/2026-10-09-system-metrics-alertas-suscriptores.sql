/*
  PASE MANUAL — Monitor del sistema: QUIÉN RECIBE LAS ALERTAS.

  QUÉ ES: una tabla nueva, sin tocar ninguna existente.
    - dbo.system_metric_alert_subscriber  una fila por persona que activó «Recibir alertas» en el
                                          monitor. Solo ellas reciben las alertas tempranas por
                                          campana y push.

  Antes las alertas llegaban a TODOS los que tienen el subproceso '/process/system-metrics'.
  Ahora nadie las recibe hasta que cada persona encienda el interruptor en la sección
  «Alertas tempranas». Las alertas se siguen viendo dentro de la página para todos.

  Si esta tabla no existe, NO se envía ninguna notificación (el interruptor avisa que falta la
  tabla); el resto del monitor y el historial de alertas siguen funcionando.

  VOLUMEN ESPERADO: una fila por persona suscrita (unas pocas).

  CÓMO CORRERLO: primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.
  Es idempotente. Reversa: 2026-10-09-system-metrics-alertas-suscriptores-reversa.sql
*/

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.system_metric_alert_subscriber', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.system_metric_alert_subscriber (
      email          NVARCHAR(320) NOT NULL CONSTRAINT PK_system_metric_alert_subscriber PRIMARY KEY, -- en minúsculas
      subscribed_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_system_metric_alert_subscriber_at DEFAULT (SYSUTCDATETIME())
    );
  END

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT name AS tabla FROM sys.tables WHERE name = 'system_metric_alert_subscriber';
