/*
  REVERSA: BITÁCORA DE PROCESO — actividades de TEXTO LIBRE (2026-10-17).

  Quita ot_actividad.texto_libre y ot_registro.es_texto_libre (y sus DEFAULT). Sin ellas, el
  código de esta versión NO funciona: se corre solo si se devuelve también el código (pase
  anterior). Los TEXTOS ya escritos NO se pierden (están en ot_registro.observacion); se pierde
  solo la marca de que eran texto libre. Por eso, si hay actividades marcadas o registros de
  texto libre, se niega salvo con la bandera de sesión:
    EXEC sp_set_session_context N'ot_texto_libre_reversa_acepta_perdida', 1;
  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51485, N'Base no esperada: este script solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @marcadas INT = 0, @registros INT = 0;
IF COL_LENGTH(N'dbo.ot_actividad', N'texto_libre') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[ot_actividad] WHERE texto_libre = 1', N'@n INT OUTPUT', @n = @marcadas OUTPUT;
IF COL_LENGTH(N'dbo.ot_registro', N'es_texto_libre') IS NOT NULL
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[ot_registro] WHERE es_texto_libre = 1', N'@n INT OUTPUT', @n = @registros OUTPUT;
SELECT DB_NAME() AS base, 'antes' AS momento, @marcadas AS actividades_texto_libre, @registros AS registros_texto_libre;

IF (@marcadas > 0 OR @registros > 0)
   AND ISNULL(CAST(SESSION_CONTEXT(N'ot_texto_libre_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51486, N'Hay actividades o registros de texto libre: use la bandera ot_texto_libre_reversa_acepta_perdida para confirmar.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  IF OBJECT_ID(N'dbo.ot_actividad_texto_libre_df', N'D') IS NOT NULL
    ALTER TABLE [dbo].[ot_actividad] DROP CONSTRAINT [ot_actividad_texto_libre_df];
  IF COL_LENGTH(N'dbo.ot_actividad', N'texto_libre') IS NOT NULL
    ALTER TABLE [dbo].[ot_actividad] DROP COLUMN [texto_libre];
  IF OBJECT_ID(N'dbo.ot_registro_es_texto_libre_df', N'D') IS NOT NULL
    ALTER TABLE [dbo].[ot_registro] DROP CONSTRAINT [ot_registro_es_texto_libre_df];
  IF COL_LENGTH(N'dbo.ot_registro', N'es_texto_libre') IS NOT NULL
    ALTER TABLE [dbo].[ot_registro] DROP COLUMN [es_texto_libre];
  COMMIT;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, 'despues' AS momento,
       COL_LENGTH(N'dbo.ot_actividad', N'texto_libre') AS actividad_texto_libre,
       COL_LENGTH(N'dbo.ot_registro', N'es_texto_libre') AS registro_es_texto_libre;
