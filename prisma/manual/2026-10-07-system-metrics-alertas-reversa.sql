/*
  REVERSA de 2026-10-07-system-metrics-alertas.sql: borra la tabla de alertas tempranas (y su
  historial). Sin ella el monitor deja de enviar alertas; lo demás sigue funcionando.
*/

IF OBJECT_ID(N'dbo.system_metric_alert', N'U') IS NOT NULL
  DROP TABLE dbo.system_metric_alert;
