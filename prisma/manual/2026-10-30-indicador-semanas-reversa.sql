/* REVERSA — quita dbo.agent_automation_case.semanas_json. Primero el código anterior. Pérdida: el detalle por semana (se recalcula). */
SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci') THROW 51597, N'Base no esperada.', 1;
IF COL_LENGTH(N'dbo.agent_automation_case', N'semanas_json') IS NOT NULL
  ALTER TABLE [dbo].[agent_automation_case] DROP COLUMN [semanas_json];
SELECT DB_NAME() AS base, COL_LENGTH(N'dbo.agent_automation_case', N'semanas_json') AS semanas_json;
