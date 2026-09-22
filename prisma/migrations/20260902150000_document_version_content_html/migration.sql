/*
  Migración: document_version_content_html
  Módulo Gestión Documental — Sprint 8. Editor de documentos (Tiptap) dentro
  de la plataforma, sobre plantilla HTML, exportando a PDF con Chrome
  headless (Puppeteer) — decisión confirmada por Nicolás el 2026-09-02.

  ATENCIÓN: esta migración se generó MANUALMENTE (sin permiso de shadow
  database en este entorno — P3014, CREATE DATABASE denegado en 'master'),
  mismo patrón que 20260629000000_add_organigrama_cargos,
  20260821000000_add_document_management, 20260821120000_document_management_workflow
  y 20260902130000_document_process_categories. El SQL se extrajo verbatim
  de un diff ESQUEMA-CONTRA-ESQUEMA (no contra la base viva, para no
  arrastrar el drift de las tablas del motor de solicitudes/workflow que
  intencionalmente NO están modeladas en Prisma — ver notas de
  requests_general/process_category en el modelo Document más arriba):

    git show HEAD:prisma/schema.prisma > prisma/schema.prisma.before
    npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma.before \
      --to-schema-datamodel prisma/schema.prisma --script

  Qué agrega (100% ADITIVA — una sola columna nullable, sin tocar nada más):
    - document_version.content_html (NVARCHAR(MAX) NULL): contenido editable
      en HTML de esa versión, escrito por el editor Tiptap
      (app/(hub)/process/document-management/generador/[id]/editar). NULL =
      versión aún sin editar desde el editor (cargada por archivo). Al
      guardar desde el editor se persiste aquí Y se regenera el PDF de la
      MISMA versión (no se crea versión nueva ni se dispara el flujo de 14
      estados — ver lib/document-management/editor.ts).

  Para registrar esta migración como aplicada en una base que YA tiene este
  cambio (p.ej. tras aplicarla a mano), use:
    npx prisma migrate resolve --applied 20260902150000_document_version_content_html
*/

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[document_version] ADD [content_html] NVARCHAR(max);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
