/*
  PASE MANUAL (PROD). Vitrina Comercial: modelo 3D de cada presentación (2026-11-04).
  NO lo corre el agente que hizo el PR: se corre con el visto bueno de Nicolás.

  PRERREQUISITO: prisma/manual/2026-10-22-vitrina-comercial-PROD.sql (tablas de la Vitrina) y, por orden de
  despliegue, prisma/manual/2026-10-23-vitrina-lineas-grupos-PROD.sql.
  Si faltan las tablas de la Vitrina, el script se detiene sin escribir nada.

  QUÉ HACE (idempotente; solo crea lo que falta, no toca datos existentes):
    El MISMO bloque DDL de prisma/migrations/20261104120000_vitrina_modelo_3d/migration.sql:
    1 tabla NUEVA (vitrina_modelo_3d) con su índice, su llave foránea a vitrina_presentacion
    y 2 CHECK (tamaño y versión positivos; dimensiones en cm NULL o entre 0 y 1000).
    Sin semilla: los modelos los carga Diseño en Gestión, pestaña «Imágenes y documentos».
    No cambia ninguna tabla existente (ni la CHECK de vitrina_imagen).

  ORDEN: ANTES del código (la ficha y la Gestión leen esta tabla). El código además AGREGA la
  dependencia npm @google/model-viewer: en producción se despliega en ventana controlada.
  CÓMO CORRERLO: script Node con mssql o SSMS, con respaldo COPY_ONLY antes. Después:
    npx prisma migrate resolve --applied 20261104120000_vitrina_modelo_3d
  REVERSA: prisma/manual/2026-11-04-vitrina-modelo-3d-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51623, N'Base no esperada: este script es solo para KRONOSDB (producción).', 1;
IF OBJECT_ID(N'dbo.vitrina_presentacion', N'U') IS NULL OR OBJECT_ID(N'dbo.vitrina_historial', N'U') IS NULL
  THROW 51621, N'Faltan las tablas de la Vitrina: corra antes 2026-10-22-vitrina-comercial-PROD.sql.', 1;

/* BLOQUE-DDL-INICIO */
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.vitrina_modelo_3d', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[vitrina_modelo_3d] (
      [id_modelo] INT NOT NULL IDENTITY(1,1),
      [id_presentacion] INT NOT NULL,
      [ruta_archivo] NVARCHAR(500) NOT NULL,
      [nombre_original] NVARCHAR(255) NOT NULL,
      [tamano_bytes] INT NOT NULL,
      [version] INT NOT NULL,
      [vigente] BIT NOT NULL CONSTRAINT [vitrina_modelo_3d_vigente_df] DEFAULT 1,
      [ancho_cm] DECIMAL(7,2) NULL,
      [alto_cm] DECIMAL(7,2) NULL,
      [profundo_cm] DECIMAL(7,2) NULL,
      [cargado_por] NVARCHAR(50) NOT NULL,
      [cargado_en] DATETIME2 NOT NULL CONSTRAINT [vitrina_modelo_3d_cargado_en_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [vitrina_modelo_3d_pkey] PRIMARY KEY CLUSTERED ([id_modelo])
    );
  END

  -- Índice, llave foránea y CHECK por separado (con su guarda): la sincronización de Prisma crea la tabla sin los CHECK.
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_vitrina_modelo_3d_presentacion' AND object_id = OBJECT_ID(N'dbo.vitrina_modelo_3d'))
    EXEC(N'CREATE NONCLUSTERED INDEX [IX_vitrina_modelo_3d_presentacion] ON [dbo].[vitrina_modelo_3d]([id_presentacion], [vigente])');
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'vitrina_modelo_3d_id_presentacion_fkey' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_modelo_3d'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_modelo_3d] ADD CONSTRAINT [vitrina_modelo_3d_id_presentacion_fkey] FOREIGN KEY ([id_presentacion]) REFERENCES [dbo].[vitrina_presentacion]([id_presentacion]) ON DELETE NO ACTION ON UPDATE NO ACTION');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_vitrina_modelo_3d_tamano' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_modelo_3d'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_modelo_3d] ADD CONSTRAINT [CK_vitrina_modelo_3d_tamano] CHECK ([tamano_bytes] > 0 AND [version] > 0)');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_vitrina_modelo_3d_dimensiones' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_modelo_3d'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_modelo_3d] ADD CONSTRAINT [CK_vitrina_modelo_3d_dimensiones] CHECK (([ancho_cm] IS NULL OR ([ancho_cm] > 0 AND [ancho_cm] <= 1000)) AND ([alto_cm] IS NULL OR ([alto_cm] > 0 AND [alto_cm] <= 1000)) AND ([profundo_cm] IS NULL OR ([profundo_cm] > 0 AND [profundo_cm] <= 1000)))');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
/* BLOQUE-DDL-FIN */

SELECT DB_NAME() AS base, t.name AS tabla FROM sys.tables t WHERE t.name = N'vitrina_modelo_3d';
SELECT DB_NAME() AS base, c.name AS restriccion FROM sys.check_constraints c WHERE c.parent_object_id = OBJECT_ID(N'dbo.vitrina_modelo_3d') ORDER BY c.name;
