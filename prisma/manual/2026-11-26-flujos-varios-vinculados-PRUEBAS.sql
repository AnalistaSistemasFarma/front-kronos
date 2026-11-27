/*
  MANUAL MIGRATION (PRUEBAS) — Several linked requests from one task (2026-11-26; Calidad OLP: «una auditoría genera
  varias no conformidades»). Requested by: Nicolás Rivera (project «Migración SGD → SynerLink», conversation 129).

  WHAT IT DOES (idempotent, additive): dbo.task_process_category.linked_multiple BIT NOT NULL DEFAULT 0.
    0 = today's behaviour (one linked request; the task closes when it closes).
    1 = the task can create several linked requests and its assignee closes it when done.
  Locks: ADD of a NOT NULL column with a constant DEFAULT is metadata-only. LOCK_TIMEOUT 5000 aborts.
  ORDER: before the code. REVERSAL: prisma/manual/2026-11-26-flujos-varios-vinculados-reversa.sql
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51830, N'Unexpected database: this script is only for KRONOSDB_PRUEBAS.', 1;

IF COL_LENGTH(N'dbo.task_process_category', N'linked_multiple') IS NULL
  ALTER TABLE dbo.task_process_category ADD linked_multiple BIT NOT NULL CONSTRAINT DF_task_process_category_linked_multiple DEFAULT 0;

SELECT DB_NAME() AS db, COL_LENGTH(N'dbo.task_process_category', N'linked_multiple') AS linked_multiple;
