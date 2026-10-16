/*
  Migración: ÓRDENES DE TRABAJO (P0) — ADITIVA. 2026-10-13.

  Bitácora de proceso de planta pedida por Farmalógica (Amanda Casiano) para
  cerrar la desviación de auditoría «no se evidencia registro de las
  intervenciones durante todo el proceso». Plan: proyectos/bitacora-proceso-synerlink.md
  (vault de horus).

  Crea 4 tablas NUEVAS en dbo (no toca ninguna tabla existente):
    1. ot_actividad        catálogo de actividades por empresa (no se borran: se desactivan).
    2. ot_orden_trabajo    una orden de trabajo = un turno (producto, lote, turno, OP de SAP opcional).
    3. ot_orden_operario   operarios que pueden registrar en la orden.
    4. ot_registro         cada intervención; hora del SERVIDOR (SYSUTCDATETIME()).

  Integridad (ALCOA+), además de que la aplicación no tiene rutas de edición ni de borrado:
    - TR_ot_registro_inmutable         impide UPDATE y DELETE de registros.
    - TR_ot_orden_operario_inmutable   impide UPDATE y DELETE de operarios.
    - TR_ot_orden_trabajo_sin_borrar   impide DELETE de órdenes.
    - TR_ot_orden_trabajo_cerrada      impide modificar una orden ya CERRADA.
    - CHECK de turno (MANANA|TARDE|NOCHE) y estado (ABIERTA|CERRADA).
  Los triggers son de UPDATE/DELETE, nunca de INSERT: Prisma inserta con OUTPUT
  sin INTO, que SQL Server no admite si la tabla tiene trigger de INSERT.

  Generada MANUALMENTE (producción no está baselined: P3005). Se corre A MANO
  antes del pase, primero en KRONOSDB_PRUEBAS y luego en KRONOSDB en ventana
  controlada. IDEMPOTENTE: cada objeto se crea solo si no existe (también corre
  sobre el esquema que deja `prisma db push` en la CI).
  Permisos y catálogo inicial: prisma/manual/2026-10-13-bitacora-proceso-p0-farmalogica.sql (luego se renombró el módulo a «Bitácora de Proceso»)
  REVERSA: prisma/manual/2026-10-13-bitacora-proceso-p0-reversa.sql
*/

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.ot_actividad', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[ot_actividad] (
      [id_actividad]      INT IDENTITY(1,1) NOT NULL,
      [id_company]        INT            NOT NULL,
      [nombre]            NVARCHAR(120)  NOT NULL,
      [exige_observacion] BIT            NOT NULL CONSTRAINT [ot_actividad_exige_observacion_df] DEFAULT 0,
      [orden]             INT            NOT NULL CONSTRAINT [ot_actividad_orden_df] DEFAULT 0,
      [activo]            BIT            NOT NULL CONSTRAINT [ot_actividad_activo_df] DEFAULT 1,
      [created_by]        NVARCHAR(50)   NOT NULL,
      [created_at]        DATETIME2      NOT NULL CONSTRAINT [ot_actividad_created_at_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [ot_actividad_pkey] PRIMARY KEY CLUSTERED ([id_actividad]),
      CONSTRAINT [ot_actividad_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION
    );
    CREATE NONCLUSTERED INDEX [IX_ot_actividad_company] ON [dbo].[ot_actividad]([id_company], [activo], [orden]);
  END

  IF OBJECT_ID(N'dbo.ot_orden_trabajo', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[ot_orden_trabajo] (
      [id_orden_trabajo]   INT IDENTITY(1,1) NOT NULL,
      [id_company]         INT            NOT NULL,
      [consecutivo]        INT            NOT NULL,
      [producto]           NVARCHAR(200)  NOT NULL,
      [item_code]          NVARCHAR(50)   NULL,
      [lote]               NVARCHAR(50)   NOT NULL,
      [turno]              NVARCHAR(10)   NOT NULL,
      [area]               NVARCHAR(100)  NULL,
      [sap_op_absentry]    INT            NULL,
      [sap_op_docnum]      INT            NULL,
      [sap_op_snapshot]    NVARCHAR(MAX)  NULL,
      [estado]             NVARCHAR(10)   NOT NULL CONSTRAINT [ot_orden_trabajo_estado_df] DEFAULT 'ABIERTA',
      [abierta_por]        NVARCHAR(50)   NOT NULL,
      [abierta_en]         DATETIME2      NOT NULL CONSTRAINT [ot_orden_trabajo_abierta_en_df] DEFAULT sysutcdatetime(),
      [cerrada_por]        NVARCHAR(50)   NULL,
      [cerrada_en]         DATETIME2      NULL,
      [observacion_cierre] NVARCHAR(1000) NULL,
      CONSTRAINT [ot_orden_trabajo_pkey] PRIMARY KEY CLUSTERED ([id_orden_trabajo]),
      CONSTRAINT [UQ_ot_orden_trabajo_consecutivo] UNIQUE NONCLUSTERED ([id_company], [consecutivo]),
      CONSTRAINT [ot_orden_trabajo_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION
    );
    CREATE NONCLUSTERED INDEX [IX_ot_orden_trabajo_estado] ON [dbo].[ot_orden_trabajo]([id_company], [estado]);
    CREATE NONCLUSTERED INDEX [IX_ot_orden_trabajo_lote] ON [dbo].[ot_orden_trabajo]([id_company], [lote]);
  END

  IF OBJECT_ID(N'dbo.ot_orden_operario', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[ot_orden_operario] (
      [id_orden_operario] INT IDENTITY(1,1) NOT NULL,
      [id_orden_trabajo]  INT           NOT NULL,
      [id_user]           NVARCHAR(50)  NOT NULL,
      CONSTRAINT [ot_orden_operario_pkey] PRIMARY KEY CLUSTERED ([id_orden_operario]),
      CONSTRAINT [UQ_ot_orden_operario] UNIQUE NONCLUSTERED ([id_orden_trabajo], [id_user]),
      CONSTRAINT [ot_orden_operario_id_orden_trabajo_fkey] FOREIGN KEY ([id_orden_trabajo]) REFERENCES [dbo].[ot_orden_trabajo]([id_orden_trabajo]) ON DELETE NO ACTION ON UPDATE NO ACTION
    );
  END

  IF OBJECT_ID(N'dbo.ot_registro', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[ot_registro] (
      [id_registro]      BIGINT IDENTITY(1,1) NOT NULL,
      [id_orden_trabajo] INT            NOT NULL,
      [id_actividad]     INT            NOT NULL,
      [actividad_nombre] NVARCHAR(120)  NOT NULL,
      [id_user]          NVARCHAR(50)   NOT NULL,
      [registrado_en]    DATETIME2      NOT NULL CONSTRAINT [ot_registro_registrado_en_df] DEFAULT sysutcdatetime(),
      [observacion]      NVARCHAR(500)  NULL,
      [ip]               NVARCHAR(64)   NULL,
      CONSTRAINT [ot_registro_pkey] PRIMARY KEY CLUSTERED ([id_registro]),
      CONSTRAINT [ot_registro_id_orden_trabajo_fkey] FOREIGN KEY ([id_orden_trabajo]) REFERENCES [dbo].[ot_orden_trabajo]([id_orden_trabajo]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [ot_registro_id_actividad_fkey] FOREIGN KEY ([id_actividad]) REFERENCES [dbo].[ot_actividad]([id_actividad]) ON DELETE NO ACTION ON UPDATE NO ACTION
    );
    CREATE NONCLUSTERED INDEX [IX_ot_registro_orden] ON [dbo].[ot_registro]([id_orden_trabajo], [registrado_en]);
  END

  /* Restricciones CHECK (db push no las crea: se agregan aquí también sobre su esquema). */
  IF OBJECT_ID(N'dbo.CK_ot_orden_trabajo_turno', N'C') IS NULL
    EXEC (N'ALTER TABLE [dbo].[ot_orden_trabajo] ADD CONSTRAINT [CK_ot_orden_trabajo_turno] CHECK ([turno] IN (N''MANANA'', N''TARDE'', N''NOCHE''))');
  IF OBJECT_ID(N'dbo.CK_ot_orden_trabajo_estado', N'C') IS NULL
    EXEC (N'ALTER TABLE [dbo].[ot_orden_trabajo] ADD CONSTRAINT [CK_ot_orden_trabajo_estado] CHECK ([estado] IN (N''ABIERTA'', N''CERRADA''))');
  IF OBJECT_ID(N'dbo.CK_ot_orden_trabajo_cierre', N'C') IS NULL
    EXEC (N'ALTER TABLE [dbo].[ot_orden_trabajo] ADD CONSTRAINT [CK_ot_orden_trabajo_cierre] CHECK ([estado] = N''ABIERTA'' OR ([cerrada_por] IS NOT NULL AND [cerrada_en] IS NOT NULL))');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Triggers de integridad (CREATE OR ALTER: idempotentes). */
EXEC (N'CREATE OR ALTER TRIGGER [dbo].[TR_ot_registro_inmutable] ON [dbo].[ot_registro]
INSTEAD OF UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted)
    THROW 51300, N''Los registros de una orden de trabajo no se pueden editar ni borrar (ALCOA+).'', 1;
END');

EXEC (N'CREATE OR ALTER TRIGGER [dbo].[TR_ot_orden_operario_inmutable] ON [dbo].[ot_orden_operario]
INSTEAD OF UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted)
    THROW 51301, N''Los operarios de una orden de trabajo no se pueden editar ni borrar.'', 1;
END');

EXEC (N'CREATE OR ALTER TRIGGER [dbo].[TR_ot_orden_trabajo_sin_borrar] ON [dbo].[ot_orden_trabajo]
INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted)
    THROW 51302, N''Las órdenes de trabajo no se pueden borrar.'', 1;
END');

EXEC (N'CREATE OR ALTER TRIGGER [dbo].[TR_ot_orden_trabajo_cerrada] ON [dbo].[ot_orden_trabajo]
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted WHERE estado = N''CERRADA'')
    THROW 51303, N''Una orden de trabajo cerrada no se puede modificar.'', 1;
END');
