/*
  REVERSA de la migración 20261009150000_portal_formulario_evaluacion
  (Portal TH · Formación · formularios tipo evaluación).

  Quita portal_formulario_intento. Las definiciones de evaluaciones siguen en
  portal_formulario_version (JSON); sin el código nuevo se mostrarían como
  encuestas, así que el código debe volver ANTES a la versión anterior.
  Si hay intentos (datos personales), se niega salvo portal_reversa_intentos = 1.

  Idempotente: se puede correr dos veces.
*/

IF OBJECT_ID(N'[dbo].[portal_formulario_intento]', N'U') IS NOT NULL
BEGIN
  DECLARE @intentos INT = 0;
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[portal_formulario_intento]', N'@n INT OUTPUT', @n = @intentos OUTPUT;
  IF @intentos > 0 AND TRY_CAST(SESSION_CONTEXT(N'portal_reversa_intentos') AS INT) IS NULL
    THROW 51203, N'Hay intentos de evaluaciones (datos personales): expórtelos y declare portal_reversa_intentos = 1 antes de la reversa.', 1;
END

DROP TABLE IF EXISTS [dbo].[portal_formulario_intento];

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261009150000_portal_formulario_evaluacion';
