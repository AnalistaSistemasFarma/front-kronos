/*
  REVERSA — Permisos API: catálogo «SAP». 2026-11-11.
  Sirve para KRONOSDB_PRUEBAS o KRONOSDB. Quita los permisos system = 'sap' y lo que los clientes
  tuvieran marcado de ellos. ANTES: respaldo COPY_ONLY.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci', N'KRONOSDB')
  THROW 51786, N'Base no esperada.', 1;

BEGIN TRANSACTION;

DELETE cp FROM [dbo].[api_client_permission] cp
  INNER JOIN [dbo].[api_permission] p ON p.[code] = cp.[permission_code]
 WHERE p.[system] = N'sap';
DELETE FROM [dbo].[api_permission] WHERE [system] = N'sap';

COMMIT TRANSACTION;

SELECT DB_NAME() AS base, (SELECT COUNT(*) FROM [dbo].[api_permission] WHERE [system] = N'sap') AS permisos_sap;
