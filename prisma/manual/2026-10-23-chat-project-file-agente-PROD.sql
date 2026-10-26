/*
  PASE MANUAL (PROD) — Archivos del agente en los Archivos del proyecto (2026-10-23).

  QUÉ HACE (idempotente; solo agrega lo que falta, no toca ni copia datos existentes):
    el MISMO bloque DDL de prisma/migrations/20261023150000_chat_project_file_agente/migration.sql:
    dos columnas NULL en chat_project_file (uploaded_by_agent, id_conversation).

  ORDEN: ANTES del código. El código nuevo lee estas columnas al pintar la pestaña Archivos; sin
  ellas el detalle del proyecto falla.

  CÓMO CORRERLO: script Node con `mssql` (memoria «correr-sql-servidores-front-kronos») o SSMS,
  con respaldo COPY_ONLY antes. REVERSA: prisma/manual/2026-10-23-chat-project-file-agente-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51562, N'Base no esperada: este script es solo para KRONOSDB (producción).', 1;

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.chat_project_file', N'U') IS NULL
  THROW 51560, N'Falta la tabla chat_project_file (módulo de Proyectos).', 1;

IF COL_LENGTH(N'dbo.chat_project_file', N'uploaded_by_agent') IS NULL
  ALTER TABLE [dbo].[chat_project_file] ADD [uploaded_by_agent] INT NULL;

IF COL_LENGTH(N'dbo.chat_project_file', N'id_conversation') IS NULL
  ALTER TABLE [dbo].[chat_project_file] ADD [id_conversation] INT NULL;

/* BLOQUE-DDL-FIN */

SELECT DB_NAME() AS base,
       COL_LENGTH(N'dbo.chat_project_file', N'uploaded_by_agent') AS uploaded_by_agent,
       COL_LENGTH(N'dbo.chat_project_file', N'id_conversation') AS id_conversation;
