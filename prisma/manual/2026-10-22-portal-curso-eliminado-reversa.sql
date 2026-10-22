/*
  REVERSA — Formación · «Eliminar curso» (2026-10-22). Deshace
  prisma/migrations/20261022140000_portal_curso_eliminado y los scripts -PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa.

  QUÉ HACE (idempotente): quita las columnas eliminado_at y eliminado_por de dbo.portal_course.

  ⚠️ EFECTO: los cursos que se hubieran eliminado VUELVEN a aparecer para los formadores (en
  borrador: al eliminarlos también quedaron con active = 0, así que los estudiantes no los ven).
  Se pierde el registro de quién y cuándo los eliminó. Si hay cursos eliminados, el script se
  DETIENE salvo que la sesión declare que acepta perderlo:
      EXEC sp_set_session_context N'portal_curso_eliminado_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51553, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF COL_LENGTH(N'dbo.portal_course', N'eliminado_at') IS NOT NULL
   AND ISNULL(CONVERT(INT, SESSION_CONTEXT(N'portal_curso_eliminado_reversa_acepta_perdida')), 0) <> 1
BEGIN
  DECLARE @n INT = 0;
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.portal_course WHERE eliminado_at IS NOT NULL', N'@n INT OUTPUT', @n = @n OUTPUT;
  IF @n > 0
    THROW 51554, N'Hay cursos eliminados. Respalde id, eliminado_at y eliminado_por de portal_course y declare portal_curso_eliminado_reversa_acepta_perdida = 1 en la sesión.', 1;
END;

BEGIN TRY
BEGIN TRAN;
IF COL_LENGTH(N'dbo.portal_course', N'eliminado_por') IS NOT NULL ALTER TABLE [dbo].[portal_course] DROP COLUMN [eliminado_por];
IF COL_LENGTH(N'dbo.portal_course', N'eliminado_at')  IS NOT NULL ALTER TABLE [dbo].[portal_course] DROP COLUMN [eliminado_at];
COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, COL_LENGTH(N'dbo.portal_course', N'eliminado_at') AS eliminado_at;
