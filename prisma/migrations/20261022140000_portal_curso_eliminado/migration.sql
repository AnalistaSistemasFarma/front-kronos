/*
  Migración: FORMACIÓN · «ELIMINAR CURSO» — ADITIVA. 2026-10-22.

  Pedido de Cristian Baldión (2026-10-22 08:29 COT): «un botón en la sección de Formación,
  dentro de cada curso creado, que me permita eliminar el curso».

  Borrado LÓGICO: agrega DOS columnas NULLABLES a dbo.portal_course (no toca datos existentes,
  no borra filas, no toca SharePoint):
    eliminado_at    cuándo se eliminó (NULL = curso vigente)
    eliminado_por   correo del formador que lo eliminó (auditoría)

  Las inscripciones, el progreso, los intentos y los certificados del curso se conservan.

  Generada MANUALMENTE (producción no está baselined: P3005). Se corre A MANO con respaldo
  COPY_ONLY: prisma/manual/2026-10-22-portal-curso-eliminado-PRUEBAS.sql y luego -PROD.sql
  (repiten el bloque DDL tal cual; lib/portal/__tests__/eliminar-curso-sql.test.ts verifica que no
  se separen). IDEMPOTENTE (también corre sobre el esquema que deja `prisma db push` en la CI).
  ⚠️ ORDEN: ANTES del código (Prisma lee todas las columnas de portal_course).
  REVERSA: prisma/manual/2026-10-22-portal-curso-eliminado-reversa.sql
*/

SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51550, N'Base no esperada: esta migración solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

/* BLOQUE-DDL-INICIO */
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF COL_LENGTH(N'dbo.portal_course', N'eliminado_at') IS NULL
    ALTER TABLE [dbo].[portal_course] ADD [eliminado_at] DATETIME2 NULL;

  IF COL_LENGTH(N'dbo.portal_course', N'eliminado_por') IS NULL
    ALTER TABLE [dbo].[portal_course] ADD [eliminado_por] NVARCHAR(255) NULL;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
/* BLOQUE-DDL-FIN */
