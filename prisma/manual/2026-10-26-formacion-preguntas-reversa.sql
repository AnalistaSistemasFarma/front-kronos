/*
  REVERSA — Formación · preguntas y respuestas (2026-10-26). Quita las 2 tablas (se pierden las
  preguntas, respuestas y «me gusta»: respaldarlas antes si hace falta). DESPUÉS de revertir el código.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51573, N'Base no esperada.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.formacion_pregunta_like', N'U') IS NOT NULL DROP TABLE [dbo].[formacion_pregunta_like];
  IF OBJECT_ID(N'dbo.formacion_pregunta', N'U') IS NOT NULL DROP TABLE [dbo].[formacion_pregunta];
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
