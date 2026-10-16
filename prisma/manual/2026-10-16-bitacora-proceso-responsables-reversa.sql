/*
  REVERSA: BITÁCORA DE PROCESO — responsables por empresa (2026-10-16).

  Quita la tabla ot_responsable. Sin ella, el código de esta versión NO funciona: se corre
  solo si se devuelve también el código (pase anterior). Si la tabla tiene filas, se niega
  salvo con la bandera de sesión:
    EXEC sp_set_session_context N'ot_responsables_reversa_acepta_perdida', 1;
  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51450, N'Base no esperada: este script solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

IF OBJECT_ID(N'dbo.ot_responsable', N'U') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM [dbo].[ot_responsable])
     AND ISNULL(CAST(SESSION_CONTEXT(N'ot_responsables_reversa_acepta_perdida') AS INT), 0) <> 1
    THROW 51451, N'ot_responsable tiene filas: use la bandera ot_responsables_reversa_acepta_perdida para confirmar.', 1;
  SELECT DB_NAME() AS base, 'antes' AS momento, COUNT(*) AS responsables FROM [dbo].[ot_responsable];
  DROP TABLE [dbo].[ot_responsable];
END

SELECT DB_NAME() AS base, 'despues' AS momento, OBJECT_ID(N'dbo.ot_responsable', N'U') AS tabla;
