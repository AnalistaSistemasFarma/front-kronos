/*
  Migración: BITÁCORA DE PROCESO — operarios sin usuario y áreas predefinidas — ADITIVA. 2026-10-14.

  Revisión con Farmalógica (Amanda Casiano, 2026-10-14; nota
  reuniones/2026-10-14-ajustes-bitacora-proceso-farmalogica.md, A1 y A5):
    - Los operarios NO tienen usuario de SynerLink: hay un MAESTRO de operarios por
      empresa que administra el supervisor. En la tablet (sesión compartida de planta)
      el operario elige su nombre y la actividad; el registro guarda el OPERARIO
      elegido y, aparte, el USUARIO de la sesión (trazabilidad).
    - El área deja de ser texto libre: catálogo de áreas por empresa (hoy solo
      «Envase y agrafado»).

  Objetos NUEVOS (no toca tablas de SynerLink fuera del módulo):
    1. ot_operador         maestro de operarios por empresa (nombre, documento, activo).
                           No se borra (se desactiva): TR_ot_operador_sin_borrar.
    2. ot_area             catálogo de áreas por empresa. No se borra: TR_ot_area_sin_borrar.
    3. ot_orden_operador   operarios programados en la bitácora (solo se agregan):
                           TR_ot_orden_operador_inmutable.
    4. ot_registro.id_operador     INT NULL (FK ot_operador) — NULL en registros anteriores.
       ot_registro.operador_nombre NVARCHAR(120) NULL — copia del nombre al registrar.
    5. ot_orden_trabajo.id_area    INT NULL (FK ot_area). `area` (texto) se conserva como copia.

  Requiere 20261013180000, 20261013220000 y 20261013233000. IDEMPOTENTE (también corre
  sobre el esquema de `prisma db push` en la CI). Se corre A MANO, primero en
  KRONOSDB_PRUEBAS. Siembra: prisma/manual/2026-10-14-bitacora-proceso-ajustes-farmalogica.sql
  REVERSA: prisma/manual/2026-10-14-bitacora-proceso-ajustes-reversa.sql
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.ot_orden_trabajo', N'U') IS NULL
  THROW 51380, N'Falta la migración 20261013180000_ordenes_trabajo_p0.', 1;
IF OBJECT_ID(N'dbo.ot_firma', N'U') IS NULL
  THROW 51381, N'Falta la migración 20261013233000_bitacora_proceso_firmas.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.ot_operador', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[ot_operador] (
      [id_operador] INT IDENTITY(1,1) NOT NULL,
      [id_company]  INT            NOT NULL,
      [nombre]      NVARCHAR(120)  NOT NULL,
      [documento]   NVARCHAR(30)   NULL,
      [activo]      BIT            NOT NULL CONSTRAINT [ot_operador_activo_df] DEFAULT 1,
      [created_by]  NVARCHAR(50)   NOT NULL,
      [created_at]  DATETIME2      NOT NULL CONSTRAINT [ot_operador_created_at_df] DEFAULT sysutcdatetime(),
      [updated_by]  NVARCHAR(50)   NULL,
      [updated_at]  DATETIME2      NULL,
      CONSTRAINT [ot_operador_pkey] PRIMARY KEY CLUSTERED ([id_operador]),
      CONSTRAINT [UQ_ot_operador_nombre] UNIQUE NONCLUSTERED ([id_company], [nombre]),
      CONSTRAINT [ot_operador_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION
    );
  END

  IF OBJECT_ID(N'dbo.ot_area', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[ot_area] (
      [id_area]    INT IDENTITY(1,1) NOT NULL,
      [id_company] INT            NOT NULL,
      [nombre]     NVARCHAR(100)  NOT NULL,
      [orden]      INT            NOT NULL CONSTRAINT [ot_area_orden_df] DEFAULT 0,
      [activo]     BIT            NOT NULL CONSTRAINT [ot_area_activo_df] DEFAULT 1,
      [created_by] NVARCHAR(50)   NOT NULL,
      [created_at] DATETIME2      NOT NULL CONSTRAINT [ot_area_created_at_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [ot_area_pkey] PRIMARY KEY CLUSTERED ([id_area]),
      CONSTRAINT [UQ_ot_area_nombre] UNIQUE NONCLUSTERED ([id_company], [nombre]),
      CONSTRAINT [ot_area_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION
    );
  END

  IF OBJECT_ID(N'dbo.ot_orden_operador', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[ot_orden_operador] (
      [id_orden_operador] INT IDENTITY(1,1) NOT NULL,
      [id_orden_trabajo]  INT           NOT NULL,
      [id_operador]       INT           NOT NULL,
      [agregado_por]      NVARCHAR(50)  NOT NULL,
      [agregado_en]       DATETIME2     NOT NULL CONSTRAINT [ot_orden_operador_agregado_en_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [ot_orden_operador_pkey] PRIMARY KEY CLUSTERED ([id_orden_operador]),
      CONSTRAINT [UQ_ot_orden_operador] UNIQUE NONCLUSTERED ([id_orden_trabajo], [id_operador]),
      CONSTRAINT [ot_orden_operador_id_orden_trabajo_fkey] FOREIGN KEY ([id_orden_trabajo]) REFERENCES [dbo].[ot_orden_trabajo]([id_orden_trabajo]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [ot_orden_operador_id_operador_fkey] FOREIGN KEY ([id_operador]) REFERENCES [dbo].[ot_operador]([id_operador]) ON DELETE NO ACTION ON UPDATE NO ACTION
    );
  END

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Columnas nuevas (NULL) en tablas del módulo. Van fuera de la transacción de arriba
   porque se agregan con SQL dinámico y luego se referencian en la FK. */
IF COL_LENGTH(N'dbo.ot_registro', N'id_operador') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_registro] ADD [id_operador] INT NULL');
IF COL_LENGTH(N'dbo.ot_registro', N'operador_nombre') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_registro] ADD [operador_nombre] NVARCHAR(120) NULL');
IF OBJECT_ID(N'dbo.ot_registro_id_operador_fkey', N'F') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_registro] ADD CONSTRAINT [ot_registro_id_operador_fkey] FOREIGN KEY ([id_operador]) REFERENCES [dbo].[ot_operador]([id_operador]) ON DELETE NO ACTION ON UPDATE NO ACTION');

IF COL_LENGTH(N'dbo.ot_orden_trabajo', N'id_area') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_orden_trabajo] ADD [id_area] INT NULL');
IF OBJECT_ID(N'dbo.ot_orden_trabajo_id_area_fkey', N'F') IS NULL
  EXEC (N'ALTER TABLE [dbo].[ot_orden_trabajo] ADD CONSTRAINT [ot_orden_trabajo_id_area_fkey] FOREIGN KEY ([id_area]) REFERENCES [dbo].[ot_area]([id_area]) ON DELETE NO ACTION ON UPDATE NO ACTION');

/* Triggers de integridad (CREATE OR ALTER: idempotentes). Nunca de INSERT (Prisma usa OUTPUT). */
EXEC (N'CREATE OR ALTER TRIGGER [dbo].[TR_ot_operador_sin_borrar] ON [dbo].[ot_operador]
INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted)
    THROW 51382, N''Los operarios de la bitácora no se borran: se desactivan.'', 1;
END');

EXEC (N'CREATE OR ALTER TRIGGER [dbo].[TR_ot_area_sin_borrar] ON [dbo].[ot_area]
INSTEAD OF DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted)
    THROW 51383, N''Las áreas de la bitácora no se borran: se desactivan.'', 1;
END');

EXEC (N'CREATE OR ALTER TRIGGER [dbo].[TR_ot_orden_operador_inmutable] ON [dbo].[ot_orden_operador]
INSTEAD OF UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted)
    THROW 51384, N''Los operarios programados en una bitácora no se pueden editar ni borrar.'', 1;
END');
