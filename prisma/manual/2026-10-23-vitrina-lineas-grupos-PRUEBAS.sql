/*
  PASE MANUAL (PRUEBAS). Vitrina Comercial: líneas comerciales y grupos terapéuticos (2026-10-23).
  NO lo corre el agente que hizo el PR: se corre con el visto bueno de Nicolás.

  PRERREQUISITO: prisma/manual/2026-10-22-vitrina-comercial-PRUEBAS.sql (tablas de la Vitrina).
  Si faltan, el script se detiene sin escribir nada.

  QUÉ HACE (idempotente; solo crea o inserta lo que falta, no toca datos existentes):
    1. El MISMO bloque DDL de prisma/migrations/20261023120000_vitrina_lineas_grupos/migration.sql:
       3 tablas NUEVAS (vitrina_linea_comercial, vitrina_grupo_terapeutico, vitrina_presentacion_grupo)
       y 2 columnas NUEVAS NULL (vitrina_presentacion.id_linea, vitrina_codigo_sap.items_group_name).
    2. Semilla de ejemplo (los administradores la ajustan en Gestión, pestaña Clasificación):
       grupos terapéuticos comunes: Antibióticos, Analgésicos, Sedación y anestesia, Cardiovasculares,
       Corticoides, Soluciones y electrolitos, Vitaminas;
       líneas comerciales: Farmalógica (empresa 1) «Antibióticos inyectables» y
       Ryan (empresa 2) «Inyectables hospitalarios».
       No asigna líneas ni grupos a ninguna presentación.

  ORDEN: ANTES del código (las rutas de la Vitrina leen estas tablas y columnas).
  CÓMO CORRERLO: script Node con mssql o SSMS, con respaldo COPY_ONLY antes. Después:
    npx prisma migrate resolve --applied 20261023120000_vitrina_lineas_grupos
  REVERSA: prisma/manual/2026-10-23-vitrina-lineas-grupos-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51612, N'Base no esperada: este script es solo para la base de PRUEBAS (o la efímera de la CI).', 1;
IF OBJECT_ID(N'dbo.vitrina_presentacion', N'U') IS NULL OR OBJECT_ID(N'dbo.vitrina_codigo_sap', N'U') IS NULL
  THROW 51611, N'Faltan las tablas de la Vitrina: corra antes 2026-10-22-vitrina-comercial-PRUEBAS.sql.', 1;

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

-- Semilla (idempotente por nombre). Por SQL dinámico: las tablas pueden haberse creado en este mismo lote.
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;

  EXEC sp_executesql N'
    DECLARE @Grupos TABLE (nombre NVARCHAR(100), orden INT);
    INSERT INTO @Grupos (nombre, orden) VALUES
      (N''Antibióticos'', 10), (N''Analgésicos'', 20), (N''Sedación y anestesia'', 30), (N''Cardiovasculares'', 40),
      (N''Corticoides'', 50), (N''Soluciones y electrolitos'', 60), (N''Vitaminas'', 70);
    INSERT INTO [dbo].[vitrina_grupo_terapeutico] (nombre, orden, activo)
    SELECT g.nombre, g.orden, 1 FROM @Grupos g
    WHERE NOT EXISTS (SELECT 1 FROM [dbo].[vitrina_grupo_terapeutico] t WHERE t.nombre = g.nombre);

    DECLARE @Lineas TABLE (id_company INT, nombre NVARCHAR(100), orden INT);
    INSERT INTO @Lineas (id_company, nombre, orden) VALUES
      (1, N''Antibióticos inyectables'', 10), (2, N''Inyectables hospitalarios'', 10);
    INSERT INTO [dbo].[vitrina_linea_comercial] (id_company, nombre, orden, activa)
    SELECT l.id_company, l.nombre, l.orden, 1 FROM @Lineas l
    WHERE EXISTS (SELECT 1 FROM [dbo].[company] c WHERE c.id_company = l.id_company)
      AND NOT EXISTS (SELECT 1 FROM [dbo].[vitrina_linea_comercial] t WHERE t.id_company = l.id_company AND t.nombre = l.nombre);';

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, t.name AS tabla
FROM sys.tables t WHERE t.name IN (N'vitrina_linea_comercial', N'vitrina_grupo_terapeutico', N'vitrina_presentacion_grupo') ORDER BY t.name;
SELECT DB_NAME() AS base, COL_LENGTH(N'dbo.vitrina_presentacion', N'id_linea') AS id_linea, COL_LENGTH(N'dbo.vitrina_codigo_sap', N'items_group_name') AS items_group_name;
EXEC sp_executesql N'SELECT DB_NAME() AS base, id_grupo, nombre, orden, activo FROM [dbo].[vitrina_grupo_terapeutico] ORDER BY orden, id_grupo;
  SELECT DB_NAME() AS base, id_linea, id_company, nombre, orden, activa FROM [dbo].[vitrina_linea_comercial] ORDER BY id_company, orden, id_linea;';
