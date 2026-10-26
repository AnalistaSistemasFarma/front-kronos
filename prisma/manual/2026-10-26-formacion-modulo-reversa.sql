/*
  REVERSA — Formación como módulo propio (2026-10-26).
  Quita las 5 tablas nuevas, la columna portal_course.id_company_owner y el módulo /process/formacion
  (con sus permisos). Se pierden las divulgaciones, alcances, colaboradores y departamentos por
  empresa cargados desde el pase: respaldarlos antes si hace falta. Los cursos no se tocan.
  ⚠️ ORDEN: DESPUÉS de revertir el código.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51563, N'Base no esperada.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  DELETE suc FROM [dbo].[subprocess_user_company] suc
    JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
    WHERE s.subprocess_url = N'/process/formacion';
  DELETE FROM [dbo].[subprocess] WHERE subprocess_url = N'/process/formacion';

  IF OBJECT_ID(N'dbo.formacion_divulgacion_destinatario', N'U') IS NOT NULL DROP TABLE [dbo].[formacion_divulgacion_destinatario];
  IF OBJECT_ID(N'dbo.formacion_divulgacion', N'U') IS NOT NULL DROP TABLE [dbo].[formacion_divulgacion];
  IF OBJECT_ID(N'dbo.formacion_curso_alcance', N'U') IS NOT NULL DROP TABLE [dbo].[formacion_curso_alcance];
  IF OBJECT_ID(N'dbo.formacion_colaborador', N'U') IS NOT NULL DROP TABLE [dbo].[formacion_colaborador];
  IF OBJECT_ID(N'dbo.formacion_empresa_departamento', N'U') IS NOT NULL DROP TABLE [dbo].[formacion_empresa_departamento];
  IF COL_LENGTH(N'dbo.portal_course', N'id_company_owner') IS NOT NULL
    ALTER TABLE [dbo].[portal_course] DROP COLUMN [id_company_owner];

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
