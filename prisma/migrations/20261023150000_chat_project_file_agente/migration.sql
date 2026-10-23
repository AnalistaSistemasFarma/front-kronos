/*
  Migración: ARCHIVOS DEL AGENTE en los Archivos del proyecto (2026-10-23).
  Requisito de Nicolás Rivera (2026-10-23, 14:12 COT): «todos los documentos que genere desde el chat
  de un proyecto deben archivarse en los Archivos del proyecto». Ruta nueva:
  POST /api/chat/agent/projects/files (llave del puente, scope "projects").

  SOLO ADITIVO e IDEMPOTENTE, se puede aplicar en caliente. Agrega DOS columnas NULL a
  chat_project_file y no toca ni copia ningún dato existente:

    - uploaded_by_agent  INT NULL  agente que generó el archivo (las filas de personas quedan NULL).
    - id_conversation    INT NULL  conversación del proyecto donde lo generó.

  Sin FK a propósito: la conversación ya cae en cascada con el proyecto por otro camino y SQL Server
  no admite dos caminos de cascada; el agente se resuelve por nombre al pintar la pestaña.

  ⚠️ ORDEN: ANTES del código. El código nuevo lee estas columnas al pintar el proyecto.

  BLOQUE-DDL-INICIO (los scripts manuales de PRUEBAS y PROD repiten este bloque tal cual;
  lib/proyectos/__tests__/archivos-agente.test.ts verifica que no se separen).
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.chat_project_file', N'U') IS NULL
  THROW 51560, N'Falta la tabla chat_project_file (módulo de Proyectos).', 1;

IF COL_LENGTH(N'dbo.chat_project_file', N'uploaded_by_agent') IS NULL
  ALTER TABLE [dbo].[chat_project_file] ADD [uploaded_by_agent] INT NULL;

IF COL_LENGTH(N'dbo.chat_project_file', N'id_conversation') IS NULL
  ALTER TABLE [dbo].[chat_project_file] ADD [id_conversation] INT NULL;

/* BLOQUE-DDL-FIN */
