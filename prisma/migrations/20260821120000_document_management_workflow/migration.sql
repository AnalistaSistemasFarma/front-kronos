/*
  Migración: document_management_workflow
  Módulo Gestión Documental (Fase 2) — flujo de aprobación de 14 estados.

  ATENCIÓN: esta migración se generó MANUALMENTE (sin base de datos accesible
  en el entorno donde se creó), igual que 20260629000000_add_organigrama_cargos
  y 20260821000000_add_document_management. El SQL se extrajo verbatim de:
    npx prisma migrate diff --from-schema-datamodel <schema SIN esta columna> \
      --to-schema-datamodel <schema CON esta columna> --script

  Es 100% ADITIVA: agrega UNA columna NULLABLE a una tabla ya creada por la
  migración de Fase 1 (document_version). No hay DROP, ALTER destructivo, ni
  cambios sobre ninguna otra tabla (ni de este módulo ni del resto del repo).

  Qué agrega:
    - document_version.id_request_general (INT NULL): referencia BLANDA (sin
      FOREIGN KEY) al id de `requests_general`, la tabla del motor de
      "solicitudes generales" (SQL crudo, no modelada en Prisma — ver
      comentario junto a los modelos DocumentType/Document/DocumentVersion en
      schema.prisma). Cada versión que arranca el flujo de aprobación de
      14 estados queda ligada a UNA fila de requests_general (la "instancia"
      de ese flujo); el resto de la mecánica (task_process_category,
      task_request_general, user_task_request_general, notes) se maneja
      enteramente por código en lib/document-management/workflowEngine.ts,
      sin más cambios de esquema.

  El flujo NO agrega tablas nuevas: reutiliza process_category /
  task_process_category / requests_general / task_request_general /
  user_task_request_general (todas preexistentes, fuera de Prisma). La
  definición del flujo en sí (el proceso "Gestión Documental — Ciclo de vida
  del documento" + sus 14 tareas) se siembra con
  prisma/seeds/document-management-workflow.sql (idempotente, APPEND-ONLY,
  mismo patrón que document-management-permisos.sql), NO con esta migración.

  Para registrar esta migración como aplicada en una base que YA tiene la
  columna (p.ej. tras aplicarla a mano), use:
    npx prisma migrate resolve --applied 20260821120000_document_management_workflow
*/

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[document_version] ADD [id_request_general] INT;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
