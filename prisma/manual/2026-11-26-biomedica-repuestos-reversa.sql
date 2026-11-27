/*
  REVERSA — Ingeniería biomédica · repuestos e insumos (2026-11-26). Primero el CÓDIGO anterior y DESPUÉS esta reversa.
  Si hay repuestos o movimientos, se niega salvo con: EXEC sp_set_session_context N'biomedica_repuestos_reversa_acepta_perdida', 1;
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51599, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @rep INT = 0, @mov INT = 0;
IF OBJECT_ID(N'dbo.biomed_repuesto', N'U') IS NOT NULL EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.biomed_repuesto', N'@n INT OUTPUT', @n = @rep OUTPUT;
IF OBJECT_ID(N'dbo.biomed_repuesto_mov', N'U') IS NOT NULL EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.biomed_repuesto_mov', N'@n INT OUTPUT', @n = @mov OUTPUT;
SELECT DB_NAME() AS base, 'antes' AS momento, @rep AS repuestos, @mov AS movimientos;
IF (@rep > 0 OR @mov > 0) AND ISNULL(CAST(SESSION_CONTEXT(N'biomedica_repuestos_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51600, N'Hay repuestos o movimientos: use la bandera biomedica_repuestos_reversa_acepta_perdida para confirmar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.biomed_repuesto_mov_solo_insercion', N'TR') IS NOT NULL DROP TRIGGER [dbo].[biomed_repuesto_mov_solo_insercion];
  IF OBJECT_ID(N'dbo.biomed_repuesto_mov', N'U') IS NOT NULL DROP TABLE [dbo].[biomed_repuesto_mov];
  IF OBJECT_ID(N'dbo.biomed_repuesto', N'U') IS NOT NULL DROP TABLE [dbo].[biomed_repuesto];
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
SELECT DB_NAME() AS base, 'despues' AS momento, OBJECT_ID(N'dbo.biomed_repuesto', N'U') AS biomed_repuesto;
