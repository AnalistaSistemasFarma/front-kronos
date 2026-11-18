/*
  PASE MANUAL (PRUEBAS) — Permisos API: permisos por empresa. 2026-11-11.
  BASE: KRONOSDB_PRUEBAS (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; solo crea una tabla vacía, no toca datos):
    Crea dbo.api_client_permission_company (id_api_client, permission_code, id_company):
      - SIN filas para un permiso = vale en TODAS las empresas del cliente (como hasta hoy).
      - CON filas = ese permiso solo vale en esas empresas.
    Se borra sola con el permiso (FK a api_client_permission ON DELETE CASCADE) y con el cliente.
    Hoy se usa para los permisos de la plataforma «SAP» (Permisos API → cliente → «Empresas» bajo
    cada permiso marcado).

  OBLIGATORIO antes de desplegar el código de Permisos API del 2026-11-11: la lista de clientes la lee
  y, si falta, el panel muestra «Falta aplicar … permisos por empresa».
  ANTES: respaldo COPY_ONLY de la base. CÓMO CORRERLO: SSMS (F5). Primero aquí, en PRUEBAS.
  REVERSA: prisma/manual/2026-11-11-permisos-api-permiso-empresa-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51790, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

IF OBJECT_ID(N'dbo.api_client_permission', N'U') IS NULL
  THROW 51791, N'No existe dbo.api_client_permission: primero el script 2026-11-09-permisos-api.', 1;

IF OBJECT_ID(N'dbo.api_client_permission_company', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[api_client_permission_company] (
    [id_api_client] INT NOT NULL,
    [permission_code] NVARCHAR(100) NOT NULL,
    [id_company] INT NOT NULL,
    CONSTRAINT [api_client_permission_company_pkey] PRIMARY KEY CLUSTERED ([id_api_client], [permission_code], [id_company]),
    CONSTRAINT [api_client_permission_company_permission_fkey] FOREIGN KEY ([id_api_client], [permission_code])
      REFERENCES [dbo].[api_client_permission] ([id_api_client], [permission_code]) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT [api_client_permission_company_company_fkey] FOREIGN KEY ([id_company])
      REFERENCES [dbo].[company] ([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.api_client_permission_company', N'U') AS tabla_permiso_empresa,
       (SELECT COUNT(*) FROM [dbo].[api_client_permission_company]) AS filas;
