/*
  REVERSA — Tareas ejecutoras SAP + historial (2026-10-22-workflow-sap-PRUEBAS.sql / -PROD.sql).
  Borra dbo.workflow_execution_log y dbo.task_sap_action CON SUS DATOS y quita
  task_process_category.task_kind.

  PÉRDIDA DE DATOS: el historial es evidencia del proceso. Si hay filas, el script se DETIENE
  salvo que la sesión declare que acepta perderlas:
      EXEC sp_set_session_context N'workflow_sap_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51492, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF ISNULL(CONVERT(INT, SESSION_CONTEXT(N'workflow_sap_reversa_acepta_perdida')), 0) <> 1
   AND ((OBJECT_ID(N'dbo.workflow_execution_log', N'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.workflow_execution_log))
     OR (OBJECT_ID(N'dbo.task_sap_action', N'U') IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.task_sap_action)))
  THROW 51493, N'Hay historial o acciones SAP configuradas. Respáldelos y declare workflow_sap_reversa_acepta_perdida = 1.', 1;

BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.workflow_execution_log', N'U') IS NOT NULL DROP TABLE dbo.workflow_execution_log;
  IF OBJECT_ID(N'dbo.task_sap_action', N'U') IS NOT NULL DROP TABLE dbo.task_sap_action;
  IF OBJECT_ID(N'dbo.CK_task_process_category_task_kind', N'C') IS NOT NULL
    ALTER TABLE dbo.task_process_category DROP CONSTRAINT CK_task_process_category_task_kind;
  IF OBJECT_ID(N'dbo.task_process_category_task_kind_df', N'D') IS NOT NULL
    ALTER TABLE dbo.task_process_category DROP CONSTRAINT task_process_category_task_kind_df;
  IF COL_LENGTH(N'dbo.task_process_category', N'task_kind') IS NOT NULL
    ALTER TABLE dbo.task_process_category DROP COLUMN task_kind;
COMMIT TRANSACTION;
PRINT N'Reversa de tareas ejecutoras SAP aplicada.';
