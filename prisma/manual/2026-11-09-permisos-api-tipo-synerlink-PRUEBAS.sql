/*
  PASE MANUAL (PRUEBAS) — Permisos API: tipo de cliente «SynerLink» (2026-11-09).

  QUÉ ES: nuevo tipo de cliente de API para las integraciones internas de SynerLink (Orion,
  programador, SAPSEND…). La pantalla agrupa los clientes por tipo y el código ya acepta
  'synerlink' (lib/api-permissions/constants.ts), pero la tabla api_client lo limita con el CHECK
  api_client_client_type_ck, que en la primera versión solo admitía agente, portal_terceros,
  mexico y otro.

  QUÉ HACE (idempotente): si el CHECK no incluye 'synerlink', lo reemplaza (DROP + ADD con el mismo
  nombre) por uno con los 5 tipos. Si ya lo incluye, no hace nada. No toca datos: todas las filas
  existentes cumplen el CHECK nuevo (es un superconjunto del anterior).
  Instalaciones nuevas no lo necesitan: 2026-11-09-permisos-api-PRUEBAS.sql ya crea el CHECK nuevo.

  ORDEN: ANTES de crear clientes tipo «SynerLink» (sin él, guardarlos falla con error del servidor).
  CÓMO CORRERLO: script Node con `mssql` o SSMS.
  REVERSA: volver al CHECK anterior solo si no hay clientes con client_type = 'synerlink'
  (cámbielos de tipo antes); la reversa completa de las tablas es -reversa.sql.
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51744, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.api_client', N'U') IS NULL
  THROW 51745, N'Falta la tabla api_client: corra primero 2026-11-09-permisos-api (ya trae el tipo synerlink).', 1;

BEGIN TRANSACTION;

IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID(N'dbo.api_client')
    AND name = N'api_client_client_type_ck'
    AND definition LIKE N'%synerlink%'
)
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.api_client')
      AND name = N'api_client_client_type_ck'
  )
    ALTER TABLE [dbo].[api_client] DROP CONSTRAINT [api_client_client_type_ck];

  ALTER TABLE [dbo].[api_client] WITH CHECK
    ADD CONSTRAINT [api_client_client_type_ck]
    CHECK ([client_type] IN (N'agente', N'mexico', N'portal_terceros', N'synerlink', N'otro'));
END;

COMMIT TRANSACTION;

SELECT DB_NAME() AS base,
       (SELECT definition
          FROM sys.check_constraints
         WHERE parent_object_id = OBJECT_ID(N'dbo.api_client')
           AND name = N'api_client_client_type_ck') AS check_tipo;
