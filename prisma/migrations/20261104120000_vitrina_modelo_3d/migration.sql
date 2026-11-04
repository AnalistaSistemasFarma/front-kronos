/*
  Migración: VITRINA COMERCIAL, modelo 3D de cada presentación. ADITIVA. 2026-11-04.

  Pedido de Comercial: que la ficha muestre el MODELO 3D interactivo de la presentación (girar,
  acercar, Realidad Aumentada en el celular). Formato estándar: GLB (glTF 2.0 binario), el que
  exportan Blender y Adobe Dimension. La Vitrina no lee archivos .dn.

  Crea 1 tabla NUEVA en dbo (no cambia ni borra nada existente; no toca la CHECK de vitrina_imagen):
    vitrina_modelo_3d   un GLB por carga. El archivo vive en el almacenamiento de adjuntos de
                        SynerLink (el mismo de las imágenes: OneDrive, carpeta VITRINA); ruta_archivo
                        guarda su id. Una carga nueva deja la anterior como no vigente (historial).
                        ancho_cm, alto_cm y profundo_cm son opcionales (para el comparador futuro).
  Con 2 CHECK (tamaño positivo; dimensiones NULL o entre 0 y 1000 cm), índice por presentación y
  llave foránea a vitrina_presentacion.

  Generada MANUALMENTE (producción no está baselined: P3005). Se corre A MANO con respaldo
  COPY_ONLY: prisma/manual/2026-11-04-vitrina-modelo-3d-PRUEBAS.sql y luego -PROD.sql (repiten
  el bloque DDL tal cual; lib/vitrina/__tests__/vitrina-sql.test.ts lo verifica).
  IDEMPOTENTE (también corre sobre el esquema que deja la sincronización de Prisma en la CI).
  ORDEN: después de 20261023120000_vitrina_lineas_grupos y ANTES del código.
  REVERSA: prisma/manual/2026-11-04-vitrina-modelo-3d-reversa.sql
*/

SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51620, N'Base no esperada: esta migración solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;
IF OBJECT_ID(N'dbo.vitrina_presentacion', N'U') IS NULL OR OBJECT_ID(N'dbo.vitrina_historial', N'U') IS NULL
  THROW 51621, N'Faltan las tablas de la Vitrina: aplique antes 20261022200000_vitrina_comercial.', 1;

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
