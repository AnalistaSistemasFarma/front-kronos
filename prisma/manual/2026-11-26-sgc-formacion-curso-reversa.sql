/*
  REVERSA — SGC · capacitación con un curso de Formación (2026-11-26). Primero el CÓDIGO anterior.
  Si hay vínculos, se niega salvo con: EXEC sp_set_session_context N'sgc_formacion_reversa_acepta_perdida', 1;
  (Las inscripciones creadas en Formación NO se borran: son de los colaboradores.)
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51872, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @n INT = 0;
IF OBJECT_ID(N'dbo.sgc_training_course', N'U') IS NOT NULL EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.sgc_training_course', N'@n INT OUTPUT', @n = @n OUTPUT;
IF @n > 0 AND ISNULL(CAST(SESSION_CONTEXT(N'sgc_formacion_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51873, N'Hay capacitaciones ligadas a cursos: use la bandera sgc_formacion_reversa_acepta_perdida para confirmar.', 1;
IF OBJECT_ID(N'dbo.sgc_training_course', N'U') IS NOT NULL DROP TABLE [dbo].[sgc_training_course];
SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.sgc_training_course', N'U') AS sgc_training_course;
