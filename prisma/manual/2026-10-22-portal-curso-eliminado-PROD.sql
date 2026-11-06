/*
  PASE MANUAL (PROD) — Formación · «Eliminar curso» (2026-10-22).
  NO lo corre el agente que hizo el PR: se corre con el visto bueno de Nicolás.

  QUÉ HACE (idempotente; solo agrega lo que falta, no toca ni copia datos existentes):
    el MISMO bloque DDL de prisma/migrations/20261022140000_portal_curso_eliminado/migration.sql:
    dos columnas NULLABLES en dbo.portal_course (eliminado_at, eliminado_por).

  ⚠️ ORDEN: ANTES del código. Prisma lee todas las columnas de portal_course: si el código
  llega primero, la lista de cursos de Formación falla (502) hasta correr este script.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos») o SSMS,
  con respaldo COPY_ONLY antes. Después: npx prisma migrate resolve --applied 20261022140000_portal_curso_eliminado
  REVERSA: prisma/manual/2026-10-22-portal-curso-eliminado-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51552, N'Base no esperada: este script es solo para KRONOSDB (producción).', 1;

/* BLOQUE-DDL-INICIO */
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF COL_LENGTH(N'dbo.portal_course', N'eliminado_at') IS NULL
    ALTER TABLE [dbo].[portal_course] ADD [eliminado_at] DATETIME2 NULL;

  IF COL_LENGTH(N'dbo.portal_course', N'eliminado_por') IS NULL
    ALTER TABLE [dbo].[portal_course] ADD [eliminado_por] NVARCHAR(255) NULL;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
/* BLOQUE-DDL-FIN */

SELECT DB_NAME() AS base,
       COL_LENGTH(N'dbo.portal_course', N'eliminado_at')  AS eliminado_at,
       COL_LENGTH(N'dbo.portal_course', N'eliminado_por') AS eliminado_por;
