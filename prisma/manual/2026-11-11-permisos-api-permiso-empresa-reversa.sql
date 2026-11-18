/*
  REVERSA — Permisos API: permisos por empresa. 2026-11-11.
  Sirve para KRONOSDB_PRUEBAS o KRONOSDB. Borra la tabla: los permisos que estaban limitados a
  algunas empresas pasan a valer en TODAS las empresas del cliente. OJO: el código del 2026-11-11
  EXIGE la tabla; revertir solo junto con el código. ANTES: respaldo COPY_ONLY.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci', N'KRONOSDB')
  THROW 51796, N'Base no esperada.', 1;

IF OBJECT_ID(N'dbo.api_client_permission_company', N'U') IS NOT NULL
  DROP TABLE [dbo].[api_client_permission_company];

SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.api_client_permission_company', N'U') AS tabla_permiso_empresa;
