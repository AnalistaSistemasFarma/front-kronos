/*
  REVERSA de 2026-10-09-system-metrics-alertas-suscriptores.sql: borra la lista de quién recibe
  las alertas. Sin ella el monitor no envía alertas a nadie; lo demás sigue funcionando.
*/

IF OBJECT_ID(N'dbo.system_metric_alert_subscriber', N'U') IS NOT NULL
  DROP TABLE dbo.system_metric_alert_subscriber;
