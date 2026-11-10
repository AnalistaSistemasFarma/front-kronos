/*
  Migración: document_process_categories
  Módulo Gestión Documental — Sprint 9. Catálogo de categorías de proceso
  documental (Auditorías y Autoinspecciones / No Conformidades / Ingeniería
  Biomédica) con sus sub-procesos, y el enlace real desde `document`.

  ATENCIÓN: esta migración se generó MANUALMENTE (sin permiso de shadow
  database en este entorno — P3014, CREATE DATABASE denegado en 'master'),
  igual que 20260629000000_add_organigrama_cargos, 20260821000000_add_document_management
  y 20260821120000_document_management_workflow. El SQL se extrajo verbatim de:
    npx prisma migrate diff --from-schema-datamodel <schema SIN estos cambios> \
      --to-schema-datamodel <schema CON estos cambios> --script

  Contexto (Sprint 7 → Sprint 9): `document.id_process` es una referencia
  BLANDA a `process_category` (motor de workflow SQL crudo, ver
  lib/document-management/workflowEngine.ts). Ese campo identifica que un
  documento "pasó por el flujo de aprobación de 14 estados" (todos comparten
  el mismo id_process, el de "Gestión Documental — Ciclo de vida del
  documento"), NO a qué proceso de NEGOCIO pertenece. Los documentos de
  carga histórica (Fase 1) quedan con id_process NULL. Ninguno de los dos
  casos distinguía Auditorías de No Conformidades de Ingeniería Biomédica —
  ver el hallazgo documentado en app/api/document-management/generator/route.ts.

  Qué agrega (100% ADITIVA — sin DROP, sin ALTER destructivo, no toca
  `id_process` ni ninguna otra columna existente):
    - document_process_category (tabla NUEVA): catálogo de categorías de
      negocio, con display_order e is_active. Diseñado como DATO (pedido
      explícito de Nicolás — "esos procesos deben tener su propia tableta
      para poder añadir más en el futuro"): agregar una categoría nueva es
      un INSERT, no un despliegue de código.
    - document_process_subprocess (tabla NUEVA): sub-procesos de cada
      categoría (FK real a document_process_category, ON DELETE CASCADE),
      mismo criterio de diseño como dato.
    - document.id_document_process_subprocess (INT NULL, FK real a
      document_process_subprocess, ON DELETE NO ACTION): el enlace real de
      un documento a su categoría/sub-proceso de negocio. A diferencia de
      id_process/id_request_general (blandas, apuntan al motor SQL crudo
      preexistente que este repo no crea), esta SÍ es una FK real porque
      document_process_category/subprocess son tablas nuevas de este repo.
      NULL = documento aún sin clasificar en el catálogo de negocio.

  Los datos semilla (3 categorías + sus sub-procesos, valores EXACTOS dados
  por Nicolás) se siembran en
  prisma/seeds/document-management-process-categories.sql (idempotente,
  APPEND-ONLY), NO en esta migración.

  Para registrar esta migración como aplicada en una base que YA tiene estos
  cambios (p.ej. tras aplicarla a mano), use:
    npx prisma migrate resolve --applied 20260902130000_document_process_categories
*/

BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[document] ADD [id_document_process_subprocess] INT;

-- CreateTable
CREATE TABLE [dbo].[document_process_category] (
    [id] INT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(200) NOT NULL,
    [display_order] INT NOT NULL CONSTRAINT [document_process_category_display_order_df] DEFAULT 0,
    [is_active] BIT NOT NULL CONSTRAINT [document_process_category_is_active_df] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [document_process_category_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [document_process_category_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [document_process_category_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[document_process_subprocess] (
    [id] INT NOT NULL IDENTITY(1,1),
    [id_document_process_category] INT NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [display_order] INT NOT NULL CONSTRAINT [document_process_subprocess_display_order_df] DEFAULT 0,
    [is_active] BIT NOT NULL CONSTRAINT [document_process_subprocess_is_active_df] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [document_process_subprocess_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [document_process_subprocess_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [document_process_subprocess_id_document_process_category_name_key] UNIQUE NONCLUSTERED ([id_document_process_category],[name])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [document_id_document_process_subprocess_idx] ON [dbo].[document]([id_document_process_subprocess]);

-- AddForeignKey
ALTER TABLE [dbo].[document_process_subprocess] ADD CONSTRAINT [document_process_subprocess_id_document_process_category_fkey] FOREIGN KEY ([id_document_process_category]) REFERENCES [dbo].[document_process_category]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[document] ADD CONSTRAINT [document_id_document_process_subprocess_fkey] FOREIGN KEY ([id_document_process_subprocess]) REFERENCES [dbo].[document_process_subprocess]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
