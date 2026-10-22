/*
  PASE MANUAL (PROD) — Tareas ejecutoras SAP + historial de ejecuciones (Fase 1). 2026-10-22.
  BASE: KRONOSDB (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; solo agrega, no borra ni modifica datos existentes):
    1. task_process_category.task_kind  NVARCHAR(20) NOT NULL DEFAULT 'normal'
       ('normal' | 'authorization' | 'sap_executor'). Las tareas existentes quedan 'normal'
       o 'authorization' según is_authorization (no cambia su comportamiento).
    2. dbo.task_sap_action: acciones SAP del catálogo por tarea, con su disparador
       (on_execute | on_start | on_approve | on_final_approve | on_reject | on_quote) y el
       mapeo de campos permitidos (JSON).
    3. dbo.workflow_execution_log: historial por solicitud (pasos humanos, ejecuciones SAP,
       reintentos y cambios externos).

  Diseño: trabajo/salida/diseno-tareas-ejecutoras-sap.html (v2).
  REVERSA: prisma/manual/2026-10-22-workflow-sap-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51491, N'Base no esperada: este script es solo para KRONOSDB.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  IF COL_LENGTH(N'dbo.task_process_category', N'task_kind') IS NULL
  BEGIN
    ALTER TABLE [dbo].[task_process_category]
      ADD [task_kind] NVARCHAR(20) NOT NULL
          CONSTRAINT [task_process_category_task_kind_df] DEFAULT N'normal';
    EXEC (N'UPDATE [dbo].[task_process_category] SET task_kind = N''authorization'' WHERE is_authorization = 1;');
    EXEC (N'ALTER TABLE [dbo].[task_process_category] ADD CONSTRAINT [CK_task_process_category_task_kind]
           CHECK ([task_kind] IN (N''normal'', N''authorization'', N''sap_executor''));');
  END

  IF OBJECT_ID(N'dbo.task_sap_action', N'U') IS NULL
    CREATE TABLE [dbo].[task_sap_action] (
      [id]            INT IDENTITY(1,1) NOT NULL,
      [id_task]       INT            NOT NULL,   -- task_process_category.id (plantilla)
      [trigger_event] NVARCHAR(20)   NOT NULL,
      [action_key]    NVARCHAR(50)   NOT NULL,   -- clave del catálogo (lib/workflow-sap/catalog.ts)
      [mapping]       NVARCHAR(MAX)  NULL,       -- JSON de campos permitidos
      [display_order] INT            NOT NULL CONSTRAINT [task_sap_action_order_df] DEFAULT 1,
      [active]        BIT            NOT NULL CONSTRAINT [task_sap_action_active_df] DEFAULT 1,
      [created_at]    DATETIME2      NOT NULL CONSTRAINT [task_sap_action_created_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [task_sap_action_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [CK_task_sap_action_trigger] CHECK ([trigger_event] IN
        (N'on_execute', N'on_start', N'on_approve', N'on_final_approve', N'on_reject', N'on_quote')),
      CONSTRAINT [CK_task_sap_action_mapping_json] CHECK ([mapping] IS NULL OR ISJSON([mapping]) = 1)
    );

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_task_sap_action_task')
    CREATE NONCLUSTERED INDEX [IX_task_sap_action_task] ON [dbo].[task_sap_action]([id_task], [trigger_event]);

  IF OBJECT_ID(N'dbo.workflow_execution_log', N'U') IS NULL
    CREATE TABLE [dbo].[workflow_execution_log] (
      [id]                 BIGINT IDENTITY(1,1) NOT NULL,
      [id_request_general] INT            NOT NULL,
      [id_task_request]    INT            NULL,       -- task_request_general.id (instancia)
      [id_task]            INT            NULL,       -- task_process_category.id (plantilla)
      [step_kind]          NVARCHAR(20)   NOT NULL,   -- human | sap | external | system
      [step_name]          NVARCHAR(200)  NOT NULL,
      [action_key]         NVARCHAR(50)   NULL,
      [trigger_event]      NVARCHAR(20)   NULL,
      [triggered_by]       NVARCHAR(20)   NOT NULL,   -- user | server | retry | sync
      [id_user]            NVARCHAR(50)   NULL,
      [status]             NVARCHAR(20)   NOT NULL,   -- started | ok | error | skipped
      [attempt]            INT            NOT NULL CONSTRAINT [workflow_execution_log_attempt_df] DEFAULT 1,
      [id_company]         INT            NULL,
      [sap_entity]         NVARCHAR(50)   NULL,
      [sap_doc_entry]      INT            NULL,
      [sap_doc_num]        INT            NULL,
      [request_summary]    NVARCHAR(2000) NULL,       -- resumen sin credenciales
      [response_summary]   NVARCHAR(2000) NULL,
      [error]              NVARCHAR(1000) NULL,
      [started_at]         DATETIME2      NOT NULL CONSTRAINT [workflow_execution_log_started_df] DEFAULT sysutcdatetime(),
      [finished_at]        DATETIME2      NULL,
      CONSTRAINT [workflow_execution_log_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [CK_workflow_execution_log_kind] CHECK ([step_kind] IN (N'human', N'sap', N'external', N'system')),
      CONSTRAINT [CK_workflow_execution_log_status] CHECK ([status] IN (N'started', N'ok', N'error', N'skipped')),
      CONSTRAINT [CK_workflow_execution_log_by] CHECK ([triggered_by] IN (N'user', N'server', N'retry', N'sync'))
    );

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_workflow_execution_log_request')
    CREATE NONCLUSTERED INDEX [IX_workflow_execution_log_request]
      ON [dbo].[workflow_execution_log]([id_request_general], [started_at]);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

GO

/* Diagnóstico (lote aparte: task_kind recién creada) */
SELECT DB_NAME() AS base,
       COL_LENGTH(N'dbo.task_process_category', N'task_kind') AS col_task_kind,
       OBJECT_ID(N'dbo.task_sap_action', N'U') AS tabla_acciones,
       OBJECT_ID(N'dbo.workflow_execution_log', N'U') AS tabla_historial,
       (SELECT COUNT(*) FROM dbo.task_process_category WHERE task_kind = N'authorization') AS tareas_autorizacion;
