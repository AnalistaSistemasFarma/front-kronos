/*
  Migración: BITÁCORA DE PROCESO — responsables por empresa — 2026-10-16.

  Nicolás (2026-10-16 15:21): «desde la app me deja seleccionar más de los que son». Los
  selectores de supervisor (cierre), inspector y jefe de producción listaban a TODOS los
  usuarios activos de la empresa (inspector y jefe) o a todos los que tenían Gestión
  (supervisor, incluida la cuenta compartida de planta). Desde aquí cada selector lista SOLO
  a las personas ASIGNADAS a ese rol en la empresa, y el servidor rechaza a las demás:

    ot_responsable (id_company, id_user, rol, activo)
      rol ∈ SUPERVISOR | INSPECTOR | JEFE_PROD; una fila por persona, empresa y rol.
      No se borran: se desactivan (Catálogo → Responsables).

  Solo agrega una tabla nueva (no toca datos existentes). IDEMPOTENTE (también corre sobre el
  esquema de `prisma db push` en la CI). Se corre A MANO (producción no está baselined),
  primero en KRONOSDB_PRUEBAS.
  Siembra: prisma/manual/2026-10-16-bitacora-proceso-responsables-farmalogica.sql (prod y
  pruebas) y prisma/manual/2026-10-16-bitacora-proceso-pruebas-responsables.sql (solo pruebas).
  REVERSA: prisma/manual/2026-10-16-bitacora-proceso-responsables-reversa.sql
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.ot_orden_trabajo', N'U') IS NULL
  THROW 51410, N'Falta la migración 20261013180000_ordenes_trabajo_p0.', 1;

IF OBJECT_ID(N'dbo.ot_responsable', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ot_responsable] (
    [id_responsable] INT           NOT NULL IDENTITY(1,1),
    [id_company]     INT           NOT NULL,
    -- Sin FK a [user]: user.id es NVARCHAR(1000) y SQL Server exige el mismo largo (igual que
    -- las demás columnas de usuario del módulo, p. ej. ot_orden_trabajo.abierta_por).
    [id_user]        NVARCHAR(50)  NOT NULL,
    [rol]            NVARCHAR(20)  NOT NULL,
    [activo]         BIT           NOT NULL CONSTRAINT [ot_responsable_activo_df] DEFAULT 1,
    [created_by]     NVARCHAR(50)  NOT NULL,
    [created_at]     DATETIME2     NOT NULL CONSTRAINT [ot_responsable_created_at_df] DEFAULT sysutcdatetime(),
    [updated_by]     NVARCHAR(50)  NULL,
    [updated_at]     DATETIME2     NULL,
    CONSTRAINT [ot_responsable_pkey] PRIMARY KEY CLUSTERED ([id_responsable])
  );
END

IF OBJECT_ID(N'dbo.ot_responsable_id_company_fkey', N'F') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_responsable] ADD CONSTRAINT [ot_responsable_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_ot_responsable' AND object_id = OBJECT_ID(N'dbo.ot_responsable'))
  EXEC (N'ALTER TABLE [dbo].[ot_responsable] ADD CONSTRAINT [UQ_ot_responsable] UNIQUE NONCLUSTERED ([id_company], [id_user], [rol])');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ot_responsable_rol' AND object_id = OBJECT_ID(N'dbo.ot_responsable'))
  EXEC (N'CREATE NONCLUSTERED INDEX [IX_ot_responsable_rol] ON [dbo].[ot_responsable]([id_company], [rol], [activo])');

IF OBJECT_ID(N'dbo.CK_ot_responsable_rol', N'C') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_responsable] ADD CONSTRAINT [CK_ot_responsable_rol] CHECK ([rol] IN (N''SUPERVISOR'', N''INSPECTOR'', N''JEFE_PROD''))');
