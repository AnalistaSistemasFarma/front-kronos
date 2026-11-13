/*
  PASE MANUAL (PRUEBAS) — Permisos API: «sujeto» de cada cliente y lista de sistemas (2026-11-09).

  QUÉ ES: cada tipo de cliente de API elige a quién representa de una lista:
    - Proveedor o cliente (portal_terceros): la EMPRESA del tercero (NIT), de la lista del portal.
    - Usuario SynerLink (synerlink): un USUARIO activo de SynerLink ([user].id).
    - Otro (otro): un SISTEMA de la tabla nueva api_external_system (Power Automate, n8n…).
    - Agente de IA y México: sin sujeto (el agente sigue en agent_code).
  El servidor confirma el sujeto y guarda su nombre visible. Doc: docs/permisos-api.md.

  QUÉ HACE (idempotente; se puede volver a correr):
    1. api_client: agrega subject_ref NVARCHAR(120) NULL y subject_label NVARCHAR(200) NULL
       si no existen (columnas nulas: no toca filas existentes).
    2. Crea la tabla api_external_system si no existe (nombre único).
    3. Semilla opcional: Power Automate, n8n, Orion, SAPSEND y Programador de tareas, solo los
       nombres que falten (WHERE NOT EXISTS; no pisa los que se hayan renombrado o desactivado).
  Los cambios de sistemas se auditan en api_client_audit con id_api_client NULL
  (acciones sistema_crear / sistema_editar), sin tabla nueva de auditoría.
  Instalaciones nuevas no lo necesitan: 2026-11-09-permisos-api-PRUEBAS.sql ya trae todo esto.

  ORDEN: ANTES del código que usa los sujetos (sin las columnas, la pestaña «Permisos API» avisa
  que falta este script). Requiere 2026-11-09-permisos-api-PRUEBAS.sql aplicado antes.
  CÓMO CORRERLO: script Node con `mssql` o SSMS.
  REVERSA: prisma/manual/2026-11-09-permisos-api-reversa.sql (borra también api_external_system).
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51746, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.api_client', N'U') IS NULL
  THROW 51747, N'Falta la tabla api_client: corra primero 2026-11-09-permisos-api (ya trae los sujetos).', 1;

BEGIN TRANSACTION;

IF COL_LENGTH(N'dbo.api_client', N'subject_ref') IS NULL
  ALTER TABLE [dbo].[api_client] ADD [subject_ref] NVARCHAR(120) NULL;

IF COL_LENGTH(N'dbo.api_client', N'subject_label') IS NULL
  ALTER TABLE [dbo].[api_client] ADD [subject_label] NVARCHAR(200) NULL;

IF OBJECT_ID(N'dbo.api_external_system', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[api_external_system] (
    [id_api_external_system] INT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(120) NOT NULL,
    [description] NVARCHAR(500) NULL,
    [active] BIT NOT NULL CONSTRAINT [api_external_system_active_df] DEFAULT 1,
    [created_by] NVARCHAR(320) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [api_external_system_created_at_df] DEFAULT SYSUTCDATETIME(),
    [updated_by] NVARCHAR(320) NULL,
    [updated_at] DATETIME2 NULL,
    CONSTRAINT [api_external_system_pkey] PRIMARY KEY CLUSTERED ([id_api_external_system]),
    CONSTRAINT [api_external_system_name_key] UNIQUE NONCLUSTERED ([name])
  );
END;

/* Semilla opcional de sistemas: solo los nombres que falten. */
INSERT INTO [dbo].[api_external_system] ([name], [description], [active], [created_by])
SELECT v.name, v.description, 1, N'script 2026-11-09-permisos-api-sujetos'
FROM (VALUES
  (N'Power Automate',        N'Flujos de Microsoft Power Automate.'),
  (N'n8n',                   N'Flujos de automatización en n8n.'),
  (N'Orion',                 N'Plataforma de firma electrónica de GSS.'),
  (N'SAPSEND',               N'Integración SAPSEND con SAP Business One.'),
  (N'Programador de tareas', N'Tareas programadas del servidor.')
) AS v(name, description)
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[api_external_system] s WHERE s.[name] = v.name);

COMMIT TRANSACTION;

SELECT DB_NAME() AS base,
       COL_LENGTH(N'dbo.api_client', N'subject_ref') AS subject_ref_bytes,
       COL_LENGTH(N'dbo.api_client', N'subject_label') AS subject_label_bytes,
       OBJECT_ID(N'dbo.api_external_system', N'U') AS api_external_system;
