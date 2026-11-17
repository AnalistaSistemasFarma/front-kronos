/*
  PASE MANUAL (PROD) — Permisos API: vencimiento de llaves. 2026-11-10.
  BASE: KRONOSDB (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; no borra ni modifica datos):
    Agrega a dbo.api_client_key la columna expires_at DATETIME2 NULL.
      - NULL = la llave no vence (todas las llaves que ya existen quedan así).
      - Con fecha = desde ese momento Kronos y el servidor MCP la ignoran; hay que generar otra.
    La fecha la pone SynerLink al generar la llave (Permisos API → «Vigencia de la llave nueva»).

  OBLIGATORIO antes de desplegar el código de Permisos API del 2026-11-10: Kronos y el MCP
  leen expires_at con columnas explícitas y, si falta, NIEGAN todas las llaves de la base
  (falla cerrado) y el panel muestra «Falta aplicar … vencimiento de llaves».
  ANTES: respaldo COPY_ONLY de la base. CÓMO CORRERLO: SSMS (F5). SOLO en la ventana autorizada del pase, después de validarlo en PRUEBAS.
  REVERSA: prisma/manual/2026-11-10-permisos-api-vencimiento-llaves-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51482, N'Base no esperada: este script es solo para KRONOSDB.', 1;

IF OBJECT_ID(N'dbo.api_client_key', N'U') IS NULL
  THROW 51483, N'No existe dbo.api_client_key: primero el script 2026-11-09-permisos-api.', 1;

IF COL_LENGTH(N'dbo.api_client_key', N'expires_at') IS NULL
  ALTER TABLE [dbo].[api_client_key] ADD [expires_at] DATETIME2 NULL;

/* Diagnóstico */
SELECT DB_NAME() AS base,
       COL_LENGTH(N'dbo.api_client_key', N'expires_at') AS expires_at_bytes,
       (SELECT COUNT(*) FROM [dbo].[api_client_key] WHERE revoked_at IS NULL) AS llaves_activas;
