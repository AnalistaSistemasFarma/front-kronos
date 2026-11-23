/*
  REVERSA — Permisos API: un correo de México = un cliente. 2026-11-10.
  Sirve para KRONOSDB_PRUEBAS o KRONOSDB. Quita el índice UX_api_client_mexico_subject;
  SynerLink sigue revisando el correo antes de guardar, pero sin la barrera de la base.
  ANTES: respaldo COPY_ONLY.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci', N'KRONOSDB')
  THROW 51491, N'Base no esperada.', 1;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_api_client_mexico_subject' AND object_id = OBJECT_ID(N'dbo.api_client'))
  DROP INDEX [UX_api_client_mexico_subject] ON [dbo].[api_client];

SELECT DB_NAME() AS base, (SELECT COUNT(*) FROM sys.indexes WHERE name = N'UX_api_client_mexico_subject') AS indice_creado;
