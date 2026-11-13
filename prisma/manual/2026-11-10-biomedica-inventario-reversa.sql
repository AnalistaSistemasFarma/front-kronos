/*
  REVERSA — Ingeniería biomédica · inventario de equipos (2026-11-10). Deshace
  prisma/migrations/20261110150000_biomedica_inventario y los scripts -PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: primero se despliega el CÓDIGO anterior y DESPUÉS esta reversa.

  QUÉ HACE (idempotente): quita las tablas biomed_equipo, biomed_valor_unitario y biomed_equipo_evento.
  Si hay equipos, valores o historial, se niega salvo con la bandera de sesión:
    EXEC sp_set_session_context N'biomedica_inventario_reversa_acepta_perdida', 1;

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51584, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @equipos INT = 0;
DECLARE @valores INT = 0;
DECLARE @eventos INT = 0;
IF OBJECT_ID(N'dbo.biomed_equipo', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[biomed_equipo]', N'@n INT OUTPUT', @n = @equipos OUTPUT;
IF OBJECT_ID(N'dbo.biomed_valor_unitario', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[biomed_valor_unitario]', N'@n INT OUTPUT', @n = @valores OUTPUT;
IF OBJECT_ID(N'dbo.biomed_equipo_evento', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[biomed_equipo_evento]', N'@n INT OUTPUT', @n = @eventos OUTPUT;
SELECT DB_NAME() AS base, 'antes' AS momento, @equipos AS equipos, @valores AS valores, @eventos AS eventos;

IF (@equipos > 0 OR @valores > 0 OR @eventos > 0)
   AND ISNULL(CAST(SESSION_CONTEXT(N'biomedica_inventario_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51585, N'Hay equipos, valores o historial: use la bandera biomedica_inventario_reversa_acepta_perdida para confirmar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.biomed_equipo_evento_solo_insercion', N'TR') IS NOT NULL DROP TRIGGER [dbo].[biomed_equipo_evento_solo_insercion];
  IF OBJECT_ID(N'dbo.biomed_equipo_evento', N'U') IS NOT NULL DROP TABLE [dbo].[biomed_equipo_evento];
  IF OBJECT_ID(N'dbo.biomed_valor_unitario', N'U') IS NOT NULL DROP TABLE [dbo].[biomed_valor_unitario];
  IF OBJECT_ID(N'dbo.biomed_equipo', N'U') IS NOT NULL DROP TABLE [dbo].[biomed_equipo];
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento, OBJECT_ID(N'dbo.biomed_equipo', N'U') AS biomed_equipo;
