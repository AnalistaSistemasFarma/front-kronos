/*
  SOLO PRUEBAS — Bitácora de Proceso: desactivar la actividad «Fin de lote» (2026-10-15).

  «Terminación de lote» ES el cierre de la bitácora, no una actividad (Nicolás, 2026-10-14).
  En KRONOSDB_PRUEBAS existe la actividad «Fin de lote» (Farmalógica, orden 1010), creada en
  vivo durante una demo; la siembra de producción NO la crea. Este script la DESACTIVA (no se
  borra: los registros que la usaron conservan su nombre).

  GUARDA: solo KRONOSDB_PRUEBAS o la base efímera de la CI (kronos_ci). NUNCA producción.
  Idempotente. Informa antes y después.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51420, N'Base no esperada: este script es SOLO para KRONOSDB_PRUEBAS (o kronos_ci).', 1;
IF OBJECT_ID(N'dbo.ot_actividad', N'U') IS NULL
  THROW 51421, N'Falta la migración 20261013180000_ordenes_trabajo_p0.', 1;

DECLARE @IdCompany INT = 1;   -- FARMALOGICA S.A.

SELECT DB_NAME() AS base, 'antes' AS momento, id_actividad, nombre, orden, activo
FROM [dbo].[ot_actividad] WHERE id_company = @IdCompany AND nombre = N'Fin de lote';

UPDATE [dbo].[ot_actividad] SET activo = 0
WHERE id_company = @IdCompany AND nombre = N'Fin de lote' AND activo = 1;

SELECT DB_NAME() AS base, 'despues' AS momento, id_actividad, nombre, orden, activo
FROM [dbo].[ot_actividad] WHERE id_company = @IdCompany AND nombre = N'Fin de lote';
