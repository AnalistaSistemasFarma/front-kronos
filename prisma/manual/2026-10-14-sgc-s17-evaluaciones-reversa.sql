/*
  REVERSA de la migración 20261014120000_sgc_s17_evaluaciones (SGC, Sprints
  17 y 18). Se corre con el código ANTERIOR ya desplegado y ANTES de la
  reversa del S16.

  ⚠️ SE NIEGA (THROW) si hay INTENTOS de evaluación (son evidencia de la
  capacitación: exporte el reporte de resultados) o capacitaciones con la
  evaluación en SynerLink, salvo sgc_reversa_evaluaciones = 1 en la sesión.
  Con la bandera: las capacitaciones «synerlink» pasan a proveedor NULL (el
  código anterior no lo conoce) y se quitan las tablas del banco y de los
  intentos (y sus claves de protección).
  Cambio controlado (trigger del Sprint 6). Idempotente.
*/
SET NOCOUNT ON;

DECLARE @intentos INT = 0;
IF OBJECT_ID(N'[sgc].[training_attempt]', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [sgc].[training_attempt]', N'@n INT OUTPUT', @n = @intentos OUTPUT;
DECLARE @propias INT = (SELECT COUNT(*) FROM [sgc].[training] WHERE [evaluation_provider] = N'synerlink');
IF (@intentos + @propias) > 0 AND TRY_CAST(SESSION_CONTEXT(N'sgc_reversa_evaluaciones') AS INT) IS NULL
  THROW 51172, N'Hay evaluaciones en SynerLink o intentos presentados (evidencia de la capacitación): exporte el reporte de resultados y declare sgc_reversa_evaluaciones = 1.', 1;

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa de 20261014120000_sgc_s17_evaluaciones';

UPDATE [sgc].[training] SET [evaluation_provider] = NULL WHERE [evaluation_provider] = N'synerlink';

IF OBJECT_ID(N'[sgc].[proteccion_registros_training_answer_fk]', N'F') IS NOT NULL
  ALTER TABLE [sgc].[proteccion_registros] DROP CONSTRAINT [proteccion_registros_training_answer_fk];
IF OBJECT_ID(N'[sgc].[proteccion_registros_training_attempt_fk]', N'F') IS NOT NULL
  ALTER TABLE [sgc].[proteccion_registros] DROP CONSTRAINT [proteccion_registros_training_attempt_fk];
IF COL_LENGTH(N'sgc.proteccion_registros', N'id_training_answer') IS NOT NULL
  ALTER TABLE [sgc].[proteccion_registros] DROP COLUMN [id_training_answer];
IF COL_LENGTH(N'sgc.proteccion_registros', N'id_training_attempt') IS NOT NULL
  ALTER TABLE [sgc].[proteccion_registros] DROP COLUMN [id_training_attempt];

IF OBJECT_ID(N'[sgc].[training_answer_solo_insercion]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[training_answer_solo_insercion];
IF OBJECT_ID(N'[sgc].[training_attempt_solo_insercion]', N'TR') IS NOT NULL DROP TRIGGER [sgc].[training_attempt_solo_insercion];
IF OBJECT_ID(N'[sgc].[training_answer]', N'U') IS NOT NULL DROP TABLE [sgc].[training_answer];
IF OBJECT_ID(N'[sgc].[training_attempt]', N'U') IS NOT NULL DROP TABLE [sgc].[training_attempt];
IF OBJECT_ID(N'[sgc].[training_option]', N'U') IS NOT NULL DROP TABLE [sgc].[training_option];
IF OBJECT_ID(N'[sgc].[training_question]', N'U') IS NOT NULL DROP TABLE [sgc].[training_question];

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'training_intentos_proveedor_ck' AND [definition] LIKE N'%synerlink%')
  ALTER TABLE [sgc].[training] DROP CONSTRAINT [training_intentos_proveedor_ck];
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'training_intentos_proveedor_ck')
  ALTER TABLE [sgc].[training] ADD CONSTRAINT [training_intentos_proveedor_ck] CHECK ([max_attempts] BETWEEN 1 AND 5 AND ([evaluation_provider] IS NULL OR [evaluation_provider] IN (N'microsoft', N'google')));

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261014120000_sgc_s17_evaluaciones';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
