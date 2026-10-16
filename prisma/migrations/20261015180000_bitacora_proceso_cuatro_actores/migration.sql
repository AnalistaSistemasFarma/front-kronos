/*
  Migración: BITÁCORA DE PROCESO — cuatro actores, cuatro vistos buenos y PIN — 2026-10-15.

  Revisión con Farmalógica (Amanda Casiano, 2026-10-15; nota
  reuniones/2026-10-15-revision-cambios-bitacora-proceso-farmalogica.md, B1 a B3):
    - B1: el INSPECTOR vuelve como actor propio, distinto del JEFE DE PRODUCCIÓN. El
      PR #617 había reutilizado `id_inspector` para el jefe; desde aquí:
        ot_orden_trabajo.id_jefe_produccion  NVARCHAR(50) NULL  (user.id del jefe)
        ot_orden_trabajo.id_inspector        vuelve a ser el inspector.
      MIGRACIÓN DE DATOS: en las bitácoras existentes (todas del modelo del #617)
      `id_inspector` es el jefe de producción: se copia a `id_jefe_produccion` y
      `id_inspector` queda NULL (esas bitácoras no tienen inspector). Para tocar las
      bitácoras CERRADAS se desactiva y reactiva, dentro de la misma transacción, el
      trigger TR_ot_orden_trabajo_cerrada. Idempotente: solo toca filas con
      `id_jefe_produccion IS NULL AND id_inspector IS NOT NULL` (desde esta versión
      toda bitácora nueva nace con jefe).
    - B2: cuatro vistos buenos en ot_firma (solo inserción): OPERARIO, SUPERVISOR
      (= «Cerró», cierra la bitácora), INSPECTOR y JEFE_PROD. La evidencia vieja NO
      se modifica: la fila INSPECTOR con significado «Verificó» se LEE como el visto
      bueno del jefe de producción (lib/bitacora-proceso/firmas.ts → rolVisible).
        ot_firma.id_operador     INT NULL (FK ot_operador): operario que dio el visto bueno.
        ot_firma.id_user_sesion  NVARCHAR(50) NULL: usuario de la sesión desde la que se confirmó.
        CHECK de rol ampliado a OPERARIO | SUPERVISOR | INSPECTOR | JEFE_PROD.
    - B3: confirmación sin contraseña. Desde la sesión propia basta «Sí, confirmo»; desde
      la cuenta compartida de la tablet, la persona elige su nombre y escribe su PIN:
        ot_pin  un PIN de 4 dígitos por usuario (hash bcrypt, nunca el PIN), con
                intentos fallidos y bloqueo a los 5. Lo configura la persona desde su
                sesión; un supervisor (Gestión) o un administrador lo restablece.

  Requiere 20261013180000, 20261013220000, 20261013233000 y 20261014140000.
  IDEMPOTENTE (también corre sobre el esquema de `prisma db push` en la CI). Se corre
  A MANO (producción no está baselined), primero en KRONOSDB_PRUEBAS.
  REVERSA: prisma/manual/2026-10-15-bitacora-proceso-cuatro-actores-reversa.sql
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.ot_orden_trabajo', N'U') IS NULL
  THROW 51400, N'Falta la migración 20261013180000_ordenes_trabajo_p0.', 1;
IF OBJECT_ID(N'dbo.ot_firma', N'U') IS NULL
  THROW 51401, N'Falta la migración 20261013233000_bitacora_proceso_firmas.', 1;
IF OBJECT_ID(N'dbo.ot_operador', N'U') IS NULL
  THROW 51402, N'Falta la migración 20261014140000_bitacora_proceso_operadores_areas.', 1;

/* 1) Columnas nuevas (NULL) en tablas del módulo. */
IF COL_LENGTH(N'dbo.ot_orden_trabajo', N'id_jefe_produccion') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_orden_trabajo] ADD [id_jefe_produccion] NVARCHAR(50) NULL');
IF COL_LENGTH(N'dbo.ot_firma', N'id_operador') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_firma] ADD [id_operador] INT NULL');
IF COL_LENGTH(N'dbo.ot_firma', N'id_user_sesion') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_firma] ADD [id_user_sesion] NVARCHAR(50) NULL');
IF OBJECT_ID(N'dbo.ot_firma_id_operador_fkey', N'F') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_firma] ADD CONSTRAINT [ot_firma_id_operador_fkey] FOREIGN KEY ([id_operador]) REFERENCES [dbo].[ot_operador]([id_operador]) ON DELETE NO ACTION ON UPDATE NO ACTION');

/* 2) CHECK de rol con los cuatro vistos buenos (se reemplaza el de dos roles). */
IF OBJECT_ID(N'dbo.CK_ot_firma_rol', N'C') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_ot_firma_rol' AND definition LIKE N'%JEFE[_]PROD%')
  EXEC (N'ALTER TABLE [dbo].[ot_firma] DROP CONSTRAINT [CK_ot_firma_rol]');
IF OBJECT_ID(N'dbo.CK_ot_firma_rol', N'C') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_firma] ADD CONSTRAINT [CK_ot_firma_rol] CHECK ([rol] IN (N''OPERARIO'', N''SUPERVISOR'', N''INSPECTOR'', N''JEFE_PROD''))');

/* 3) PIN personal de la bitácora (B3). */
IF OBJECT_ID(N'dbo.ot_pin', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ot_pin] (
    [id_user]           NVARCHAR(50)  NOT NULL,
    [pin_hash]          NVARCHAR(100) NULL,
    [intentos_fallidos] INT           NOT NULL CONSTRAINT [ot_pin_intentos_df] DEFAULT 0,
    [bloqueado]         BIT           NOT NULL CONSTRAINT [ot_pin_bloqueado_df] DEFAULT 0,
    [ultimo_fallo_en]   DATETIME2     NULL,
    [configurado_en]    DATETIME2     NULL,
    [restablecido_por]  NVARCHAR(50)  NULL,
    [restablecido_en]   DATETIME2     NULL,
    [created_at]        DATETIME2     NOT NULL CONSTRAINT [ot_pin_created_at_df] DEFAULT sysutcdatetime(),
    [updated_at]        DATETIME2     NOT NULL CONSTRAINT [ot_pin_updated_at_df] DEFAULT sysutcdatetime(),
    -- Sin FK a [user]: user.id es NVARCHAR(1000) y SQL Server exige el mismo largo (igual que
    -- las demás columnas de usuario del módulo, p. ej. ot_orden_trabajo.abierta_por).
    CONSTRAINT [ot_pin_pkey] PRIMARY KEY CLUSTERED ([id_user])
  );
END

/* 4) Datos: en las bitácoras del modelo del #617, id_inspector era el jefe de producción. */
/* (SQL dinámico: la columna se agregó en este mismo lote.) */
DECLARE @Pendientes INT = 0;
EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[ot_orden_trabajo] WHERE [id_jefe_produccion] IS NULL AND [id_inspector] IS NOT NULL',
                   N'@n INT OUTPUT', @n = @Pendientes OUTPUT;
BEGIN TRY
  BEGIN TRANSACTION;
  IF @Pendientes > 0
  BEGIN
    IF OBJECT_ID(N'dbo.TR_ot_orden_trabajo_cerrada', N'TR') IS NOT NULL
      EXEC (N'DISABLE TRIGGER [dbo].[TR_ot_orden_trabajo_cerrada] ON [dbo].[ot_orden_trabajo]');
    EXEC (N'UPDATE [dbo].[ot_orden_trabajo]
             SET [id_jefe_produccion] = [id_inspector], [id_inspector] = NULL
             WHERE [id_jefe_produccion] IS NULL AND [id_inspector] IS NOT NULL');
    IF OBJECT_ID(N'dbo.TR_ot_orden_trabajo_cerrada', N'TR') IS NOT NULL
      EXEC (N'ENABLE TRIGGER [dbo].[TR_ot_orden_trabajo_cerrada] ON [dbo].[ot_orden_trabajo]');
  END
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  IF OBJECT_ID(N'dbo.TR_ot_orden_trabajo_cerrada', N'TR') IS NOT NULL
    EXEC (N'ENABLE TRIGGER [dbo].[TR_ot_orden_trabajo_cerrada] ON [dbo].[ot_orden_trabajo]');
  THROW;
END CATCH;

IF EXISTS (SELECT 1 FROM sys.triggers WHERE name = N'TR_ot_orden_trabajo_cerrada' AND is_disabled = 1)
  THROW 51403, N'El trigger TR_ot_orden_trabajo_cerrada quedó desactivado: revise antes de continuar.', 1;
