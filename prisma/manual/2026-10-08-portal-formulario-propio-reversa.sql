/*
  REVERSA de la migración 20261008160000_portal_formacion_formulario_propio
  (Portal TH · Formación · formulario propio del curso).

  Quita portal_formulario_respuesta, portal_formulario_version,
  portal_formulario y la columna portal_course_material.formulario_id, y borra
  el registro de la migración en _prisma_migrations si existe.

  ⚠️ El código desplegado debe volver ANTES a la versión anterior.
  ⚠️ Si algún material ya es tipo 'FORM', se niega: primero devuélvalo a
  enlace con la reversa de prisma/manual/2026-10-08-portal-pruebas-material-4-a-formulario.sql.
  ⚠️ Si ya hay RESPUESTAS (datos personales, Ley 1581 de 2012), se niega salvo
  que la sesión declare portal_reversa_formularios = 1. Expórtelas antes desde
  el portal (Respuestas → Exportar a Excel) si se necesitan.

  Idempotente: se puede correr dos veces.
*/

IF COL_LENGTH(N'dbo.portal_course_material', N'formulario_id') IS NOT NULL
BEGIN
  DECLARE @formularios INT = 0;
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[portal_course_material] WHERE [type] = N''FORM'' AND [eliminado_at] IS NULL',
    N'@n INT OUTPUT', @n = @formularios OUTPUT;
  IF @formularios > 0
    THROW 51201, N'Hay materiales tipo FORM vigentes: devuélvalos a enlace antes de la reversa.', 1;
END

IF OBJECT_ID(N'[dbo].[portal_formulario_respuesta]', N'U') IS NOT NULL
BEGIN
  DECLARE @respuestas INT = 0;
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[portal_formulario_respuesta]', N'@n INT OUTPUT', @n = @respuestas OUTPUT;
  IF @respuestas > 0 AND TRY_CAST(SESSION_CONTEXT(N'portal_reversa_formularios') AS INT) IS NULL
    THROW 51202, N'Hay respuestas de formularios (datos personales): expórtelas y declare portal_reversa_formularios = 1 antes de la reversa.', 1;
END

-- La FK puede llamarse como la crea la migración o como la crea `prisma db push`.
DECLARE @fk SYSNAME;
DECLARE fks CURSOR LOCAL FAST_FORWARD FOR
  SELECT fk.name FROM sys.foreign_keys fk
  JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id
  JOIN sys.columns c ON c.object_id = fc.parent_object_id AND c.column_id = fc.parent_column_id
  WHERE fk.parent_object_id = OBJECT_ID(N'[dbo].[portal_course_material]') AND c.name = N'formulario_id';
OPEN fks;
FETCH NEXT FROM fks INTO @fk;
WHILE @@FETCH_STATUS = 0
BEGIN
  EXEC (N'ALTER TABLE [dbo].[portal_course_material] DROP CONSTRAINT [' + @fk + N']');
  FETCH NEXT FROM fks INTO @fk;
END
CLOSE fks;
DEALLOCATE fks;

IF COL_LENGTH(N'dbo.portal_course_material', N'formulario_id') IS NOT NULL
  ALTER TABLE [dbo].[portal_course_material] DROP COLUMN [formulario_id];

DROP TABLE IF EXISTS [dbo].[portal_formulario_respuesta];
DROP TABLE IF EXISTS [dbo].[portal_formulario_version];
DROP TABLE IF EXISTS [dbo].[portal_formulario];

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261008160000_portal_formacion_formulario_propio';
