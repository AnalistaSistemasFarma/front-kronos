/*
  REVERSA — Bitácora de Proceso, cuatro actores, cuatro vistos buenos y PIN (2026-10-15).
  Deshace prisma/migrations/20261015180000_bitacora_proceso_cuatro_actores:
    - devuelve el jefe de producción a `id_inspector` (modelo del #617) en las bitácoras SIN
      inspector propio y quita la columna `id_jefe_produccion`;
    - quita ot_firma.id_operador (y su FK), ot_firma.id_user_sesion y la tabla ot_pin;
    - deja el CHECK de rol como antes (SUPERVISOR | INSPECTOR).

  PÉRDIDA DE DATOS: si hay bitácoras con inspector Y jefe a la vez (modelo nuevo), vistos
  buenos de OPERARIO, INSPECTOR («Visto bueno») o JEFE_PROD, o PINes configurados, el script se
  DETIENE salvo que la sesión declare que acepta perderlos:
      EXEC sp_set_session_context N'ot_cuatro_actores_reversa_acepta_perdida', 1;
  Con la bandera: en esas bitácoras se conserva el JEFE en id_inspector (se pierde el
  inspector) y se BORRAN los vistos buenos del modelo nuevo (que no caben en el CHECK viejo),
  desactivando un momento los triggers de inmutabilidad. Respalde ot_* antes.
  ADVERTENCIA: después de esta reversa la aplicación de esta rama deja de funcionar; se usa
  junto con el regreso del código a la versión del #617.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI. Idempotente.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51410, N'Base no esperada: esta reversa solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

DECLARE @HayDatos BIT = 0;
IF COL_LENGTH(N'dbo.ot_orden_trabajo', N'id_jefe_produccion') IS NOT NULL
  EXEC sp_executesql N'SELECT @h = CASE WHEN EXISTS (SELECT 1 FROM [dbo].[ot_orden_trabajo] WHERE id_jefe_produccion IS NOT NULL AND id_inspector IS NOT NULL)
                                       OR EXISTS (SELECT 1 FROM [dbo].[ot_firma] WHERE rol IN (N''OPERARIO'', N''JEFE_PROD'') OR (rol = N''INSPECTOR'' AND significado <> N''Verificó''))
                                  THEN 1 ELSE 0 END',
                     N'@h BIT OUTPUT', @h = @HayDatos OUTPUT;
IF @HayDatos = 0 AND OBJECT_ID(N'dbo.ot_pin', N'U') IS NOT NULL
  EXEC sp_executesql N'SELECT @h = CASE WHEN EXISTS (SELECT 1 FROM [dbo].[ot_pin] WHERE pin_hash IS NOT NULL) THEN 1 ELSE 0 END',
                     N'@h BIT OUTPUT', @h = @HayDatos OUTPUT;
IF @HayDatos = 1 AND ISNULL(CAST(SESSION_CONTEXT(N'ot_cuatro_actores_reversa_acepta_perdida') AS INT), 0) <> 1
  THROW 51411, N'Hay datos del modelo de cuatro actores (inspector y jefe, vistos buenos nuevos o PIN). Respalde ot_* y declare ot_cuatro_actores_reversa_acepta_perdida = 1.', 1;

SELECT DB_NAME() AS base, 'antes' AS momento,
       COL_LENGTH(N'dbo.ot_orden_trabajo', N'id_jefe_produccion') AS col_jefe,
       COL_LENGTH(N'dbo.ot_firma', N'id_operador') AS col_operador_firma,
       OBJECT_ID(N'dbo.ot_pin') AS tabla_pin;

BEGIN TRY
  BEGIN TRANSACTION;

  IF COL_LENGTH(N'dbo.ot_orden_trabajo', N'id_jefe_produccion') IS NOT NULL
  BEGIN
    EXEC (N'DISABLE TRIGGER [dbo].[TR_ot_orden_trabajo_cerrada] ON [dbo].[ot_orden_trabajo]');
    EXEC (N'UPDATE [dbo].[ot_orden_trabajo] SET [id_inspector] = [id_jefe_produccion] WHERE [id_jefe_produccion] IS NOT NULL');
    EXEC (N'ENABLE TRIGGER [dbo].[TR_ot_orden_trabajo_cerrada] ON [dbo].[ot_orden_trabajo]');
  END

  IF OBJECT_ID(N'dbo.ot_firma', N'U') IS NOT NULL
     AND EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_ot_firma_rol' AND definition LIKE N'%JEFE[_]PROD%')
  BEGIN
    EXEC (N'DISABLE TRIGGER [dbo].[TR_ot_firma_inmutable] ON [dbo].[ot_firma]');
    EXEC (N'DELETE FROM [dbo].[ot_firma] WHERE rol IN (N''OPERARIO'', N''JEFE_PROD'') OR (rol = N''INSPECTOR'' AND significado <> N''Verificó'')');
    EXEC (N'ENABLE TRIGGER [dbo].[TR_ot_firma_inmutable] ON [dbo].[ot_firma]');
    EXEC (N'ALTER TABLE [dbo].[ot_firma] DROP CONSTRAINT [CK_ot_firma_rol]');
    EXEC (N'ALTER TABLE [dbo].[ot_firma] ADD CONSTRAINT [CK_ot_firma_rol] CHECK ([rol] IN (N''SUPERVISOR'', N''INSPECTOR''))');
  END

  IF OBJECT_ID(N'dbo.ot_firma_id_operador_fkey', N'F') IS NOT NULL
    ALTER TABLE [dbo].[ot_firma] DROP CONSTRAINT [ot_firma_id_operador_fkey];
  IF OBJECT_ID(N'dbo.ot_pin', N'U') IS NOT NULL DROP TABLE [dbo].[ot_pin];

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  IF OBJECT_ID(N'dbo.TR_ot_orden_trabajo_cerrada', N'TR') IS NOT NULL EXEC (N'ENABLE TRIGGER [dbo].[TR_ot_orden_trabajo_cerrada] ON [dbo].[ot_orden_trabajo]');
  IF OBJECT_ID(N'dbo.TR_ot_firma_inmutable', N'TR') IS NOT NULL EXEC (N'ENABLE TRIGGER [dbo].[TR_ot_firma_inmutable] ON [dbo].[ot_firma]');
  THROW;
END CATCH;

/* Columnas: fuera de la transacción. */
IF COL_LENGTH(N'dbo.ot_firma', N'id_operador') IS NOT NULL
  EXEC (N'ALTER TABLE [dbo].[ot_firma] DROP COLUMN [id_operador]');
IF COL_LENGTH(N'dbo.ot_firma', N'id_user_sesion') IS NOT NULL
  EXEC (N'ALTER TABLE [dbo].[ot_firma] DROP COLUMN [id_user_sesion]');
IF COL_LENGTH(N'dbo.ot_orden_trabajo', N'id_jefe_produccion') IS NOT NULL
  EXEC (N'ALTER TABLE [dbo].[ot_orden_trabajo] DROP COLUMN [id_jefe_produccion]');

IF EXISTS (SELECT 1 FROM sys.triggers WHERE name IN (N'TR_ot_orden_trabajo_cerrada', N'TR_ot_firma_inmutable') AND is_disabled = 1)
  THROW 51412, N'Quedó desactivado un trigger de integridad: revise antes de continuar.', 1;

SELECT DB_NAME() AS base, 'despues' AS momento,
       COL_LENGTH(N'dbo.ot_orden_trabajo', N'id_jefe_produccion') AS col_jefe,
       COL_LENGTH(N'dbo.ot_firma', N'id_operador') AS col_operador_firma,
       OBJECT_ID(N'dbo.ot_pin') AS tabla_pin;
