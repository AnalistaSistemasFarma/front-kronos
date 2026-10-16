/*
  Migración: sgc_s0_retiro_gestion_documental
  SGC documental — Sprint 0 (2026-09-30). Retiro del módulo de Gestión
  Documental anterior (fases 1 y 2 + extensiones), aprobado por Nicolás Rivera
  el 2026-09-30: lo reemplaza el SGC documental aislado (esquema `sgc`).

  Qué hace: DROP de las 5 tablas del módulo retirado, que solo usaba ese
  módulo (ningún otro código las lee después de este PR):
    document_version, document, document_process_subprocess,
    document_process_category, document_type.

  NO borra las carpetas de migración 20260821000000, 20260821120000,
  20260902130000 ni 20260902150000: ya están aplicadas y quitarlas rompería el
  historial de Prisma. Esta migración las revierte hacia adelante.

  ⚠️ ORDEN DEL PASE: esta migración va DESPUÉS de desplegar el código que ya
  no usa estas tablas (el código viejo hace JOIN a document_version desde
  view-activities). Los DATOS ligados (solicitudes del proceso documental,
  subprocesos /process/document-management*, notificaciones) se retiran con
  prisma/manual/2026-09-30-sgc-s0-retiro-datos.sql, que corre ANTES de este
  DROP y deja respaldo.

  Idempotente: cada DROP solo corre si el objeto existe.

  REVERSA: volver a aplicar, en orden, las 4 migraciones originales
  (20260821000000_add_document_management, 20260821120000_document_management_workflow,
  20260902130000_document_process_categories, 20260902150000_document_version_content_html)
  y restaurar los datos desde el respaldo bk_20260930_* (ver el script de
  reversa del pase).

  Para registrarla como aplicada en una base donde ya se corrió a mano:
    npx prisma migrate resolve --applied 20260930100000_sgc_s0_retiro_gestion_documental
*/

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[dbo].[document_version]', N'U') IS NOT NULL
  DROP TABLE [dbo].[document_version];

IF OBJECT_ID(N'[dbo].[document]', N'U') IS NOT NULL
  DROP TABLE [dbo].[document];

IF OBJECT_ID(N'[dbo].[document_process_subprocess]', N'U') IS NOT NULL
  DROP TABLE [dbo].[document_process_subprocess];

IF OBJECT_ID(N'[dbo].[document_process_category]', N'U') IS NOT NULL
  DROP TABLE [dbo].[document_process_category];

IF OBJECT_ID(N'[dbo].[document_type]', N'U') IS NOT NULL
  DROP TABLE [dbo].[document_type];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
