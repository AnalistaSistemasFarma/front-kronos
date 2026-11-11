/*
  PASE MANUAL (PROD) — Permisos API: un correo de México = un cliente. 2026-11-10.
  BASE: KRONOSDB (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; no borra ni modifica datos):
    Crea en dbo.api_client el índice único filtrado UX_api_client_mexico_subject sobre
    subject_ref, solo para client_type = 'mexico'. Es la última barrera contra dos personas
    de México con el mismo correo, incluso con dos guardados al mismo tiempo (SynerLink ya lo
    revisa antes de guardar y responde «Ya existe un cliente de México con ese correo»).
    Si ya hay correos repetidos, el script se detiene y los lista: hay que corregirlos primero.

  ANTES: respaldo COPY_ONLY de la base y el script de sujetos (2026-11-09-permisos-api-sujetos).
  CÓMO CORRERLO: SSMS (F5). SOLO en la ventana autorizada del pase, después de validarlo en PRUEBAS.
  REVERSA: prisma/manual/2026-11-10-permisos-api-correo-mexico-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51488, N'Base no esperada: este script es solo para KRONOSDB.', 1;

IF COL_LENGTH(N'dbo.api_client', N'subject_ref') IS NULL
  THROW 51489, N'No existe dbo.api_client.subject_ref: primero el script 2026-11-09-permisos-api-sujetos.', 1;

IF EXISTS (SELECT subject_ref FROM [dbo].[api_client]
            WHERE client_type = N'mexico' AND subject_ref IS NOT NULL
            GROUP BY subject_ref HAVING COUNT(*) > 1)
BEGIN
  SELECT subject_ref AS correo_repetido, COUNT(*) AS clientes
    FROM [dbo].[api_client]
   WHERE client_type = N'mexico' AND subject_ref IS NOT NULL
   GROUP BY subject_ref HAVING COUNT(*) > 1;
  THROW 51490, N'Hay correos de México repetidos (ver la lista): corríjalos en Permisos API y vuelva a correr el script.', 1;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_api_client_mexico_subject' AND object_id = OBJECT_ID(N'dbo.api_client'))
  CREATE UNIQUE NONCLUSTERED INDEX [UX_api_client_mexico_subject]
    ON [dbo].[api_client] ([subject_ref])
    WHERE [client_type] = N'mexico' AND [subject_ref] IS NOT NULL;

/* Diagnóstico */
SELECT DB_NAME() AS base,
       (SELECT COUNT(*) FROM sys.indexes WHERE name = N'UX_api_client_mexico_subject') AS indice_creado,
       (SELECT COUNT(*) FROM [dbo].[api_client] WHERE client_type = N'mexico') AS clientes_mexico;
