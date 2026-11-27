/*
  MANUAL MIGRATION (PROD) — Annual calendar of a flow (2026-11-26; Calidad OLP: «cronograma de auditorías: un calendario
  donde se programan las auditorías por área; Calidad abre el cronograma de cada año»).
  Requested by: Nicolás Rivera (project «Migración SGD → SynerLink», conversation 129).

  WHAT IT DOES (idempotent, additive): dbo.process_category.calendar_field (date field that places each request in the
  calendar) and calendar_group_field (list field for the rows, e.g. «Área o proceso auditado»). NULL = no calendar.
  Locks: ADD of NULL columns is metadata-only. ORDER: before the code.
  REVERSAL: prisma/manual/2026-11-26-flujos-cronograma-reversa.sql
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() <> N'KRONOSDB'
  THROW 51851, N'Unexpected database: this script is only for KRONOSDB (production).', 1;

IF COL_LENGTH(N'dbo.process_category', N'calendar_field') IS NULL
  ALTER TABLE dbo.process_category ADD calendar_field INT NULL, calendar_group_field INT NULL;

SELECT DB_NAME() AS db, COL_LENGTH(N'dbo.process_category', N'calendar_field') AS calendar_field, COL_LENGTH(N'dbo.process_category', N'calendar_group_field') AS calendar_group_field;
