/*
  REVERSA de 2026-10-06-system-metrics-usuarios.sql: borra la tabla de consumo por usuario
  (y su histórico). El resto del Monitor del sistema sigue funcionando.
*/

IF OBJECT_ID(N'dbo.system_metric_user', N'U') IS NOT NULL
  DROP TABLE dbo.system_metric_user;
