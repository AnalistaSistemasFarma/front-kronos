/*
  PASE MANUAL (PRODUCCIÓN) — Indicador de automatizaciones: ocurrencias por semana (2026-10-30).
  QUÉ HACE (idempotente): agrega dbo.agent_automation_case.semanas_json (NULL), con las veces que se
  pidió cada caso en cada semana: [{"inicio":"2026-09-07","ocurrencias":3}, …]. Alimenta el mapa de
  calor de % de mejora por departamento y semana. Solo aditivo.
  ORDEN: después de 2026-10-30-indicador-automatizaciones-*.sql. REVERSA: …-indicador-semanas-reversa.sql
*/
SET NOCOUNT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() <> N'KRONOSDB'
  THROW 51595, N'Base no esperada: este script es solo para KRONOSDB.', 1;
IF COL_LENGTH(N'dbo.agent_automation_case', N'semanas_json') IS NULL
  ALTER TABLE [dbo].[agent_automation_case] ADD [semanas_json] NVARCHAR(MAX) NULL;
SELECT DB_NAME() AS base, COL_LENGTH(N'dbo.agent_automation_case', N'semanas_json') AS semanas_json;
