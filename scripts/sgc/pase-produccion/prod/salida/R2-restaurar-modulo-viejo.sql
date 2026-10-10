/*
  PASE SGC · R2 · RESTAURAR EL MÓDULO DOCUMENTAL VIEJO (solo con reversa del CÓDIGO)
  Generado por scripts/sgc/pase-produccion/prod/armar-consolidado.mjs el 2026-10-10.
  Base esperada: KRONOSDB en SERFARMA03 (cada lote empieza con una guardia que hace THROW si no coincide).
  Correr SOLO con aplicar-sql.mjs (se detiene en el primer error) y con la autorización del pase.
  El código anterior de main hace JOIN a dbo.document_version en «Ver actividades»: correr R2 ANTES de arrancar el código anterior.
*/
SET NOCOUNT ON;
GO
/* GUARDIA · prisma/migrations/20260821000000_add_document_management/migration.sql (solo si OBJECT_ID(N'dbo.document', N'U') IS NULL) */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20260821000000_add_document_management/migration.sql (solo si OBJECT_ID(N'dbo.document', N'U') IS NULL) ===== */
IF OBJECT_ID(N'dbo.document', N'U') IS NULL
  EXEC sp_executesql N'/*
  Migración: add_document_management
  Módulo Gestión Documental (Fase 1) — infraestructura para la carga inicial
  histórica de documentos, directo en estado "Vigente" (sin flujo de
  aprobación todavía; eso es Fase 2, ver comentario en schema.prisma junto a
  estos modelos).

  ATENCIÓN: esta migración se generó MANUALMENTE (sin base de datos accesible
  en el entorno donde se creó), igual que 20260629000000_add_organigrama_cargos.
  El SQL se extrajo verbatim de:
    npx prisma migrate diff --from-schema-datamodel <schema SIN estos modelos> \
      --to-schema-datamodel <schema CON estos modelos> --script
  Solo contiene las tablas NUEVAS (document_type, document, document_version)
  y sus índices/llaves foráneas. No hay DROP ni ALTER sobre tablas existentes.

  Tablas creadas: document_type, document, document_version.

  Para registrar esta migración como aplicada en una base que YA tiene las
  tablas (p.ej. tras aplicarlas a mano), use:
    npx prisma migrate resolve --applied 20260821000000_add_document_management
*/

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[document_type] (
    [id_document_type] INT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(150) NOT NULL,
    [code_prefix] NVARCHAR(20) NOT NULL,
    [ggc_process] NVARCHAR(150),
    [is_active] BIT NOT NULL CONSTRAINT [document_type_is_active_df] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [document_type_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [document_type_pkey] PRIMARY KEY CLUSTERED ([id_document_type]),
    CONSTRAINT [document_type_code_prefix_key] UNIQUE NONCLUSTERED ([code_prefix])
);

-- CreateTable
CREATE TABLE [dbo].[document] (
    [id_document] INT NOT NULL IDENTITY(1,1),
    [code] NVARCHAR(50) NOT NULL,
    [title] NVARCHAR(300) NOT NULL,
    [id_document_type] INT NOT NULL,
    [id_company] INT NOT NULL,
    [id_process] INT,
    [owner_user_id] NVARCHAR(1000) NOT NULL,
    [due_review_date] DATETIME2,
    [is_restricted] BIT NOT NULL CONSTRAINT [document_is_restricted_df] DEFAULT 0,
    [current_status] NVARCHAR(30) NOT NULL CONSTRAINT [document_current_status_df] DEFAULT ''Vigente'',
    [current_version_id] INT,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [document_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [document_pkey] PRIMARY KEY CLUSTERED ([id_document]),
    CONSTRAINT [document_id_company_code_key] UNIQUE NONCLUSTERED ([id_company],[code])
);

-- CreateTable
CREATE TABLE [dbo].[document_version] (
    [id_document_version] INT NOT NULL IDENTITY(1,1),
    [id_document] INT NOT NULL,
    [version_number] INT NOT NULL,
    [status] NVARCHAR(30) NOT NULL CONSTRAINT [document_version_status_df] DEFAULT ''Vigente'',
    [onedrive_item_id] NVARCHAR(300),
    [onedrive_path] NVARCHAR(1000) NOT NULL,
    [created_by] NVARCHAR(1000) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [document_version_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [comments] NVARCHAR(1000),
    CONSTRAINT [document_version_pkey] PRIMARY KEY CLUSTERED ([id_document_version]),
    CONSTRAINT [document_version_id_document_version_number_key] UNIQUE NONCLUSTERED ([id_document],[version_number])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [document_id_company_current_status_idx] ON [dbo].[document]([id_company], [current_status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [document_id_document_type_idx] ON [dbo].[document]([id_document_type]);

-- AddForeignKey
ALTER TABLE [dbo].[document] ADD CONSTRAINT [document_id_document_type_fkey] FOREIGN KEY ([id_document_type]) REFERENCES [dbo].[document_type]([id_document_type]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[document] ADD CONSTRAINT [document_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[document] ADD CONSTRAINT [document_owner_user_id_fkey] FOREIGN KEY ([owner_user_id]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[document_version] ADD CONSTRAINT [document_version_id_document_fkey] FOREIGN KEY ([id_document]) REFERENCES [dbo].[document]([id_document]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
';
ELSE PRINT N'20260821000000_add_document_management: ya aplicada, se omite.';
GO
/* GUARDIA · prisma/migrations/20260821120000_document_management_workflow/migration.sql (solo si COL_LENGTH(N'dbo.document_version', N'id_request_general') IS NULL) */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== prisma/migrations/20260821120000_document_management_workflow/migration.sql (solo si COL_LENGTH(N'dbo.document_version', N'id_request_general') IS NULL) ===== */
IF COL_LENGTH(N'dbo.document_version', N'id_request_general') IS NULL
  EXEC sp_executesql N'/*
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
';
ELSE PRINT N'20260821120000_document_management_workflow: ya aplicada, se omite.';
GO
/* GUARDIA · scripts/sgc/pase-produccion/sql/01-retiro-modulo-viejo-reversa.sql */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== scripts/sgc/pase-produccion/sql/01-retiro-modulo-viejo-reversa.sql ===== */
/*
  REVERSA del PASO 7 (retiro del módulo documental viejo en KRONOSDB).

  1. Recrear las tablas vacías: aplicar, EN ESTE ORDEN y antes de este archivo,
     las dos migraciones originales que producción ya tenía:
        prisma/migrations/20260821000000_add_document_management/migration.sql
        prisma/migrations/20260821120000_document_management_workflow/migration.sql
     (con aplicar-sql.mjs --confirmo-produccion). Quedan vacías, como estaban.
  2. Este archivo restaura los 2 subprocesos (mismos ids 40 y 41), su
     asignación y sus notificaciones desde dbo.bk_sgc_pase_*.
  Solo tiene sentido si también se revierte el CÓDIGO a la versión anterior
  (el código nuevo ya no usa estas tablas). Idempotente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
IF OBJECT_ID(N'dbo.bk_sgc_pase_subprocess', N'U') IS NULL
  THROW 50612, N'No existe el respaldo dbo.bk_sgc_pase_subprocess: no hay nada que restaurar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  SET IDENTITY_INSERT dbo.subprocess ON;
  INSERT INTO dbo.subprocess (id_subprocess, subprocess, id_process, subprocess_url)
  SELECT b.id_subprocess, b.subprocess, b.id_process, b.subprocess_url FROM dbo.bk_sgc_pase_subprocess b
  WHERE NOT EXISTS (SELECT 1 FROM dbo.subprocess s WHERE s.id_subprocess = b.id_subprocess);
  SET IDENTITY_INSERT dbo.subprocess OFF;

  INSERT INTO dbo.subprocess_user_company (id_subprocess, id_company_user)
  SELECT b.id_subprocess, b.id_company_user FROM dbo.bk_sgc_pase_subprocess_user_company b
  WHERE NOT EXISTS (SELECT 1 FROM dbo.subprocess_user_company x WHERE x.id_subprocess = b.id_subprocess AND x.id_company_user = b.id_company_user);
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
-- Notificaciones: al momento de la verificación previa había 0; si el respaldo
-- tiene filas, restaurarlas con IDENTITY_INSERT sobre dbo.notifications.
SELECT 'despues' AS q,
  (SELECT COUNT(*) FROM dbo.subprocess WHERE subprocess_url LIKE N'/process/document-management%') AS subprocesos,
  (SELECT COUNT(*) FROM dbo.bk_sgc_pase_notifications) AS notificaciones_en_respaldo,
  (SELECT COUNT(*) FROM sys.tables WHERE schema_id = SCHEMA_ID(N'dbo') AND name IN (N'document', N'document_type', N'document_version')) AS tablas_recreadas;
GO
/* GUARDIA · registro-migraciones (retiro, reversa) */
IF DB_NAME() <> N'KRONOSDB' OR CAST(@@SERVERNAME AS NVARCHAR(128)) <> N'SERFARMA03'
  THROW 50900, N'GUARDIA: este script del pase del SGC solo corre en KRONOSDB de SERFARMA03. No se ejecutó nada.', 1;
GO
/* ===== registro-migraciones (retiro, reversa) ===== */
DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name = N'20260930100000_sgc_s0_retiro_gestion_documental';
SELECT OBJECT_ID(N'dbo.document_version', N'U') AS document_version, (SELECT COUNT(*) FROM dbo.subprocess WHERE subprocess_url LIKE N'/process/document-management%') AS subprocesos_viejos;
GO
