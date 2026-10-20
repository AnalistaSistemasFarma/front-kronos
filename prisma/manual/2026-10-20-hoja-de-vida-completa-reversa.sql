/*
  REVERSA de la hoja de vida completa (incremento 1, 2026-10-20).
  Sirve para KRONOSDB_PRUEBAS y KRONOSDB.

  Quita SOLO lo que agregó este incremento:
    - las 4 tablas nuevas (agent_inventory_runtime, agent_external_finding,
      agent_cv_case, agent_governance), si existen;
    - las entradas de la línea de tiempo que nacieron de los datos nuevos
      y de las ediciones nuevas (kind reinicio, rotacion, gobierno,
      credencial, personalidad, caso, hallazgo_externo).
  No toca agent, agent_profile, agent_inventory ni ninguna tabla de F1/F2.

  Antes de correrla en producción: respaldo y autorización de Nicolás.
  En una transacción: si algo falla, no queda a medias.
*/
IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS')
  THROW 50001, N'Base inesperada.', 1;

SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_cv_entry')
  DELETE FROM [dbo].[agent_cv_entry]
  WHERE kind IN (N'reinicio', N'rotacion', N'gobierno', N'credencial', N'personalidad', N'caso', N'hallazgo_externo');

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_inventory_runtime') DROP TABLE [dbo].[agent_inventory_runtime];
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_external_finding')  DROP TABLE [dbo].[agent_external_finding];
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_cv_case')           DROP TABLE [dbo].[agent_cv_case];
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_governance')        DROP TABLE [dbo].[agent_governance];

COMMIT TRANSACTION;

SELECT name FROM sys.tables WHERE name IN (N'agent_inventory_runtime', N'agent_external_finding', N'agent_cv_case', N'agent_governance');
