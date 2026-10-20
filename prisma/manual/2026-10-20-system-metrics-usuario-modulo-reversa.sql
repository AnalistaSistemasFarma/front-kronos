/*
  REVERSA de prisma/manual/2026-10-20-system-metrics-usuario-modulo.sql.

  Borra dbo.system_metric_user_module (el reparto por módulo de cada persona). Con el código
  nuevo en pie, la pestaña Usuarios vuelve al reparto aproximado (módulo principal por ventana)
  y el resto del monitor sigue igual. Idempotente.
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.system_metric_user_module', N'U') IS NOT NULL
BEGIN
  DROP TABLE dbo.system_metric_user_module;
END;

SELECT name AS tabla FROM sys.tables WHERE name = 'system_metric_user_module';
