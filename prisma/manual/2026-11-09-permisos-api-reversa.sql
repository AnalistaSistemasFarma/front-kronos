/*
  REVERSA — Permisos API (2026-11-09). Deshace 2026-11-09-permisos-api-PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa. Con el código nuevo
  y sin tablas, la pestaña «Permisos API» avisa que falta el script y el MCP sigue solo con las
  llaves del archivo (MCP_API_KEYS); nada se rompe, pero los agentes que ya usen una llave de la
  base quedan SIN acceso hasta que se les dé una llave del archivo.

  QUÉ HACE (idempotente): borra las tablas api_client_audit, api_client_permission,
  api_permission, api_client_company, api_client_key, api_client y api_external_system (sistemas
  de los clientes tipo «otro», script de sujetos 2026-11-09). Si hay clientes creados se
  niega salvo con la bandera de sesión:
    EXEC sp_set_session_context N'permisos_api_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51742, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @clientes INT = 0;
IF OBJECT_ID(N'dbo.api_client', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[api_client]', N'@n INT OUTPUT', @n = @clientes OUTPUT;
SELECT DB_NAME() AS base, 'antes' AS momento, @clientes AS clientes_api;

IF @clientes > 0
   AND ISNULL(CAST(SESSION_CONTEXT(N'permisos_api_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51743, N'Hay clientes de API creados: use la bandera permisos_api_reversa_acepta_perdida para confirmar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.api_client_audit', N'U') IS NOT NULL
    DROP TABLE [dbo].[api_client_audit];
  IF OBJECT_ID(N'dbo.api_client_permission', N'U') IS NOT NULL
    DROP TABLE [dbo].[api_client_permission];
  IF OBJECT_ID(N'dbo.api_permission', N'U') IS NOT NULL
    DROP TABLE [dbo].[api_permission];
  IF OBJECT_ID(N'dbo.api_client_company', N'U') IS NOT NULL
    DROP TABLE [dbo].[api_client_company];
  IF OBJECT_ID(N'dbo.api_client_key', N'U') IS NOT NULL
    DROP TABLE [dbo].[api_client_key];
  IF OBJECT_ID(N'dbo.api_client', N'U') IS NOT NULL
    DROP TABLE [dbo].[api_client];
  IF OBJECT_ID(N'dbo.api_external_system', N'U') IS NOT NULL
    DROP TABLE [dbo].[api_external_system];
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento,
       OBJECT_ID(N'dbo.api_client', N'U') AS api_client,
       OBJECT_ID(N'dbo.api_permission', N'U') AS api_permission,
       OBJECT_ID(N'dbo.api_external_system', N'U') AS api_external_system;
