/*
  Migración: VITRINA COMERCIAL, líneas comerciales y grupos terapéuticos. ADITIVA. 2026-10-23.

  Pedido de Comercial en la revisión del 23-oct (reunion-2026-10-23-revision-vitrina.md): navegar
  el catálogo por empresa, línea comercial, grupo terapéutico y servicio, y ver en Gestión el
  nombre del grupo de SAP en lugar del número.

  Crea 3 tablas NUEVAS en dbo y 2 columnas NUEVAS NULL (no cambia ni borra nada existente):
    1. vitrina_linea_comercial     línea comercial POR EMPRESA (id_company, nombre, orden, activa).
    2. vitrina_grupo_terapeutico   grupo terapéutico COMÚN a las empresas (nombre, orden, activo).
    3. vitrina_presentacion_grupo  presentación con sus grupos terapéuticos (varios por presentación).
    4. vitrina_presentacion.id_linea           INT NULL, con índice y llave foránea a la línea.
    5. vitrina_codigo_sap.items_group_name     NVARCHAR(100) NULL: nombre del grupo de artículos
                                               de SAP (ItemGroups.GroupName, leído en SOLO LECTURA).
  Que la línea sea de la MISMA empresa de la presentación lo valida el código (lib/vitrina/service.ts).

  Generada MANUALMENTE (producción no está baselined: P3005). Se corre A MANO con respaldo
  COPY_ONLY: prisma/manual/2026-10-23-vitrina-lineas-grupos-PRUEBAS.sql y luego -PROD.sql (repiten
  el bloque DDL tal cual y agregan la semilla; lib/vitrina/__tests__/vitrina-sql.test.ts lo verifica).
  IDEMPOTENTE (también corre sobre el esquema que deja la sincronización de Prisma en la CI).
  ORDEN: después de 20261022200000_vitrina_comercial y ANTES del código.
  REVERSA: prisma/manual/2026-10-23-vitrina-lineas-grupos-reversa.sql
*/

SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51610, N'Base no esperada: esta migración solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;
IF OBJECT_ID(N'dbo.vitrina_presentacion', N'U') IS NULL OR OBJECT_ID(N'dbo.vitrina_codigo_sap', N'U') IS NULL
  THROW 51611, N'Faltan las tablas de la Vitrina: aplique antes 20261022200000_vitrina_comercial.', 1;

/* BLOQUE-DDL-INICIO */
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.vitrina_linea_comercial', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[vitrina_linea_comercial] (
      [id_linea] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [nombre] NVARCHAR(100) NOT NULL,
      [orden] INT NOT NULL CONSTRAINT [vitrina_linea_comercial_orden_df] DEFAULT 0,
      [activa] BIT NOT NULL CONSTRAINT [vitrina_linea_comercial_activa_df] DEFAULT 1,
      [creado_en] DATETIME2 NOT NULL CONSTRAINT [vitrina_linea_comercial_creado_en_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [vitrina_linea_comercial_pkey] PRIMARY KEY CLUSTERED ([id_linea]),
      CONSTRAINT [UQ_vitrina_linea_comercial_nombre] UNIQUE NONCLUSTERED ([id_company],[nombre])
    );
    ALTER TABLE [dbo].[vitrina_linea_comercial] ADD CONSTRAINT [vitrina_linea_comercial_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END

  IF OBJECT_ID(N'dbo.vitrina_grupo_terapeutico', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[vitrina_grupo_terapeutico] (
      [id_grupo] INT NOT NULL IDENTITY(1,1),
      [nombre] NVARCHAR(100) NOT NULL,
      [orden] INT NOT NULL CONSTRAINT [vitrina_grupo_terapeutico_orden_df] DEFAULT 0,
      [activo] BIT NOT NULL CONSTRAINT [vitrina_grupo_terapeutico_activo_df] DEFAULT 1,
      [creado_en] DATETIME2 NOT NULL CONSTRAINT [vitrina_grupo_terapeutico_creado_en_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [vitrina_grupo_terapeutico_pkey] PRIMARY KEY CLUSTERED ([id_grupo]),
      CONSTRAINT [UQ_vitrina_grupo_terapeutico_nombre] UNIQUE NONCLUSTERED ([nombre])
    );
  END

  IF OBJECT_ID(N'dbo.vitrina_presentacion_grupo', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[vitrina_presentacion_grupo] (
      [id_presentacion] INT NOT NULL,
      [id_grupo] INT NOT NULL,
      CONSTRAINT [vitrina_presentacion_grupo_pkey] PRIMARY KEY CLUSTERED ([id_presentacion],[id_grupo])
    );
    CREATE NONCLUSTERED INDEX [IX_vitrina_presentacion_grupo_grupo] ON [dbo].[vitrina_presentacion_grupo]([id_grupo]);
    ALTER TABLE [dbo].[vitrina_presentacion_grupo] ADD CONSTRAINT [vitrina_presentacion_grupo_id_presentacion_fkey] FOREIGN KEY ([id_presentacion]) REFERENCES [dbo].[vitrina_presentacion]([id_presentacion]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[vitrina_presentacion_grupo] ADD CONSTRAINT [vitrina_presentacion_grupo_id_grupo_fkey] FOREIGN KEY ([id_grupo]) REFERENCES [dbo].[vitrina_grupo_terapeutico]([id_grupo]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END

  -- Columnas NUEVAS y NULL en tablas de la Vitrina (no cambian ninguna columna existente).
  IF COL_LENGTH(N'dbo.vitrina_presentacion', N'id_linea') IS NULL
    ALTER TABLE [dbo].[vitrina_presentacion] ADD [id_linea] INT NULL;
  IF COL_LENGTH(N'dbo.vitrina_codigo_sap', N'items_group_name') IS NULL
    ALTER TABLE [dbo].[vitrina_codigo_sap] ADD [items_group_name] NVARCHAR(100) NULL;

  -- Índice y llave foránea de la línea. Por SQL dinámico: la columna puede haberse creado en este mismo lote.
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_vitrina_presentacion_linea' AND object_id = OBJECT_ID(N'dbo.vitrina_presentacion'))
    EXEC(N'CREATE NONCLUSTERED INDEX [IX_vitrina_presentacion_linea] ON [dbo].[vitrina_presentacion]([id_linea])');
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'vitrina_presentacion_id_linea_fkey' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_presentacion'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_presentacion] ADD CONSTRAINT [vitrina_presentacion_id_linea_fkey] FOREIGN KEY ([id_linea]) REFERENCES [dbo].[vitrina_linea_comercial]([id_linea]) ON DELETE NO ACTION ON UPDATE NO ACTION');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
/* BLOQUE-DDL-FIN */
