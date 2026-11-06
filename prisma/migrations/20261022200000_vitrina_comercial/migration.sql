/*
  Migración: VITRINA COMERCIAL (sprint V2) — ADITIVA. 2026-10-22.

  Catálogo comercial de Farmalógica (id_company 1) y Ryan (id_company 2), aprobado por
  Nicolás Rivera el 22-oct («listo, dale, iniciemos»). Brief: brief-desarrollo-vitrina-v2.md.
  Equivale al borrador validado el 22-oct en KRONOSDB_PRUEBAS (transacción con ROLLBACK), con
  los nombres de restricción de Prisma y estos agregados:
    - vitrina_codigo_sap.visibilidad_canal (los canales institucional/comercial empiezan INTERNA);
    - vitrina_codigo_sap.sug_* (sugerencias de la carga inicial CSV; no activan nada);
    - vitrina_codigo_sap.creado_en, vitrina_exclusividad.actualizado_por/_en;
    - CHECK de canal y de vigencia en vitrina_exclusividad e índices de historial y exclusividad.

  Crea 8 tablas NUEVAS en dbo (no toca ninguna tabla existente):
    1. vitrina_presentacion       presentación comercial por empresa (terceros ⇒ visibilidad INTERNA, CHECK).
    2. vitrina_codigo_sap         códigos leídos del SAP de la empresa (SOLO LECTURA); id_presentacion NULL = bandeja.
    3. vitrina_area               áreas asistenciales (lista cerrada).
    4. vitrina_presentacion_area  presentación × área.
    5. vitrina_exclusividad       exclusividades con vigencia.
    6. vitrina_imagen             imágenes de empaque (la carga queda para el V3).
    7. vitrina_documento          vínculo con sgc.document.id_document (sin FK entre esquemas; V3).
    8. vitrina_historial          historial de la Gestión y de la lectura de SAP.

  Generada MANUALMENTE (producción no está baselined: P3005). Se corre A MANO con respaldo
  COPY_ONLY: prisma/manual/2026-10-22-vitrina-comercial-PRUEBAS.sql y luego -PROD.sql (repiten el
  bloque DDL tal cual; lib/vitrina/__tests__/vitrina-sql.test.ts verifica que no se separen).
  IDEMPOTENTE (también corre sobre el esquema que deja `prisma db push` en la CI: agrega los CHECK).
  ⚠️ ORDEN: ANTES del código. Después: prisma/manual/2026-10-22-vitrina-subprocesos-PRUEBAS.sql / -PROD.sql.
  REVERSA: prisma/manual/2026-10-22-vitrina-comercial-reversa.sql
*/

SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51600, N'Base no esperada: esta migración solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

/* BLOQUE-DDL-INICIO */
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.vitrina_presentacion', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[vitrina_presentacion] (
      [id_presentacion] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [molecula] NVARCHAR(200) NOT NULL,
      [concentracion] NVARCHAR(100),
      [forma_farmaceutica] NVARCHAR(60),
      [unidades_caja] INT,
      [nombre_comercial] NVARCHAR(200),
      [tall_man] NVARCHAR(200),
      [familia] NVARCHAR(100),
      [estado] NVARCHAR(20) NOT NULL CONSTRAINT [vitrina_presentacion_estado_df] DEFAULT 'PENDIENTE',
      [visibilidad] NVARCHAR(20) NOT NULL CONSTRAINT [vitrina_presentacion_visibilidad_df] DEFAULT 'INTERNA',
      [es_para_terceros] BIT NOT NULL CONSTRAINT [vitrina_presentacion_es_para_terceros_df] DEFAULT 0,
      [destacada] BIT NOT NULL CONSTRAINT [vitrina_presentacion_destacada_df] DEFAULT 0,
      [creado_por] NVARCHAR(50) NOT NULL,
      [creado_en] DATETIME2 NOT NULL CONSTRAINT [vitrina_presentacion_creado_en_df] DEFAULT sysutcdatetime(),
      [actualizado_por] NVARCHAR(50),
      [actualizado_en] DATETIME2,
      CONSTRAINT [vitrina_presentacion_pkey] PRIMARY KEY CLUSTERED ([id_presentacion])
    );
    CREATE NONCLUSTERED INDEX [IX_vitrina_presentacion_company] ON [dbo].[vitrina_presentacion]([id_company], [estado], [visibilidad]);
    ALTER TABLE [dbo].[vitrina_presentacion] ADD CONSTRAINT [vitrina_presentacion_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END

  IF OBJECT_ID(N'dbo.vitrina_codigo_sap', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[vitrina_codigo_sap] (
      [id_codigo_sap] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [item_code] NVARCHAR(50) NOT NULL,
      [item_name] NVARCHAR(200) NOT NULL,
      [items_group_code] INT,
      [id_presentacion] INT,
      [pais] NVARCHAR(60),
      [canal] NVARCHAR(20) NOT NULL CONSTRAINT [vitrina_codigo_sap_canal_df] DEFAULT 'SIN_DATO',
      [visibilidad_canal] NVARCHAR(20) NOT NULL CONSTRAINT [vitrina_codigo_sap_visibilidad_canal_df] DEFAULT 'INTERNA',
      [cliente_marca] NVARCHAR(100),
      [activo_en_sap] BIT NOT NULL CONSTRAINT [vitrina_codigo_sap_activo_en_sap_df] DEFAULT 1,
      [activado_vitrina] BIT NOT NULL CONSTRAINT [vitrina_codigo_sap_activado_vitrina_df] DEFAULT 0,
      [registro_sanitario] NVARCHAR(60),
      [registro_vence_en] DATE,
      [registro_estado] NVARCHAR(20) NOT NULL CONSTRAINT [vitrina_codigo_sap_registro_estado_df] DEFAULT 'SIN_REGISTRO',
      [ultima_lectura] DATETIME2,
      [sug_presentacion] NVARCHAR(200),
      [sug_familia] NVARCHAR(100),
      [sug_tipo] NVARCHAR(100),
      [sug_es_terceros] BIT,
      [sug_unidades] INT,
      [sug_observacion] NVARCHAR(300),
      [creado_en] DATETIME2 NOT NULL CONSTRAINT [vitrina_codigo_sap_creado_en_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [vitrina_codigo_sap_pkey] PRIMARY KEY CLUSTERED ([id_codigo_sap]),
      CONSTRAINT [UQ_vitrina_codigo_sap] UNIQUE NONCLUSTERED ([id_company],[item_code])
    );
    CREATE NONCLUSTERED INDEX [IX_vitrina_codigo_sap_presentacion] ON [dbo].[vitrina_codigo_sap]([id_presentacion]);
    ALTER TABLE [dbo].[vitrina_codigo_sap] ADD CONSTRAINT [vitrina_codigo_sap_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[vitrina_codigo_sap] ADD CONSTRAINT [vitrina_codigo_sap_id_presentacion_fkey] FOREIGN KEY ([id_presentacion]) REFERENCES [dbo].[vitrina_presentacion]([id_presentacion]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END

  IF OBJECT_ID(N'dbo.vitrina_area', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[vitrina_area] (
      [id_area] INT NOT NULL IDENTITY(1,1),
      [nombre] NVARCHAR(80) NOT NULL,
      [activa] BIT NOT NULL CONSTRAINT [vitrina_area_activa_df] DEFAULT 1,
      [orden] INT NOT NULL CONSTRAINT [vitrina_area_orden_df] DEFAULT 0,
      CONSTRAINT [vitrina_area_pkey] PRIMARY KEY CLUSTERED ([id_area]),
      CONSTRAINT [UQ_vitrina_area_nombre] UNIQUE NONCLUSTERED ([nombre])
    );

  END

  IF OBJECT_ID(N'dbo.vitrina_presentacion_area', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[vitrina_presentacion_area] (
      [id_presentacion] INT NOT NULL,
      [id_area] INT NOT NULL,
      CONSTRAINT [vitrina_presentacion_area_pkey] PRIMARY KEY CLUSTERED ([id_presentacion],[id_area])
    );
    ALTER TABLE [dbo].[vitrina_presentacion_area] ADD CONSTRAINT [vitrina_presentacion_area_id_presentacion_fkey] FOREIGN KEY ([id_presentacion]) REFERENCES [dbo].[vitrina_presentacion]([id_presentacion]) ON DELETE NO ACTION ON UPDATE NO ACTION;
    ALTER TABLE [dbo].[vitrina_presentacion_area] ADD CONSTRAINT [vitrina_presentacion_area_id_area_fkey] FOREIGN KEY ([id_area]) REFERENCES [dbo].[vitrina_area]([id_area]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END

  IF OBJECT_ID(N'dbo.vitrina_exclusividad', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[vitrina_exclusividad] (
      [id_exclusividad] INT NOT NULL IDENTITY(1,1),
      [id_presentacion] INT NOT NULL,
      [cliente_beneficiario] NVARCHAR(150) NOT NULL,
      [pais] NVARCHAR(60),
      [canal] NVARCHAR(20),
      [alcance] NVARCHAR(20) NOT NULL,
      [vigente_desde] DATE,
      [vigente_hasta] DATE,
      [observacion] NVARCHAR(500),
      [creado_por] NVARCHAR(50) NOT NULL,
      [creado_en] DATETIME2 NOT NULL CONSTRAINT [vitrina_exclusividad_creado_en_df] DEFAULT sysutcdatetime(),
      [actualizado_por] NVARCHAR(50),
      [actualizado_en] DATETIME2,
      CONSTRAINT [vitrina_exclusividad_pkey] PRIMARY KEY CLUSTERED ([id_exclusividad])
    );
    CREATE NONCLUSTERED INDEX [IX_vitrina_exclusividad_presentacion] ON [dbo].[vitrina_exclusividad]([id_presentacion]);
    ALTER TABLE [dbo].[vitrina_exclusividad] ADD CONSTRAINT [vitrina_exclusividad_id_presentacion_fkey] FOREIGN KEY ([id_presentacion]) REFERENCES [dbo].[vitrina_presentacion]([id_presentacion]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END

  IF OBJECT_ID(N'dbo.vitrina_imagen', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[vitrina_imagen] (
      [id_imagen] INT NOT NULL IDENTITY(1,1),
      [id_presentacion] INT NOT NULL,
      [tipo] NVARCHAR(20) NOT NULL,
      [ruta_archivo] NVARCHAR(500) NOT NULL,
      [version] NVARCHAR(20),
      [vigente] BIT NOT NULL CONSTRAINT [vitrina_imagen_vigente_df] DEFAULT 1,
      [cargado_por] NVARCHAR(50) NOT NULL,
      [cargado_en] DATETIME2 NOT NULL CONSTRAINT [vitrina_imagen_cargado_en_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [vitrina_imagen_pkey] PRIMARY KEY CLUSTERED ([id_imagen])
    );
    ALTER TABLE [dbo].[vitrina_imagen] ADD CONSTRAINT [vitrina_imagen_id_presentacion_fkey] FOREIGN KEY ([id_presentacion]) REFERENCES [dbo].[vitrina_presentacion]([id_presentacion]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END

  IF OBJECT_ID(N'dbo.vitrina_documento', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[vitrina_documento] (
      [id_vitrina_documento] INT NOT NULL IDENTITY(1,1),
      [id_presentacion] INT NOT NULL,
      [id_document] INT NOT NULL,
      [tipo] NVARCHAR(20) NOT NULL,
      [idioma] NVARCHAR(10),
      [pais] NVARCHAR(60),
      [vinculado_por] NVARCHAR(50) NOT NULL,
      [vinculado_en] DATETIME2 NOT NULL CONSTRAINT [vitrina_documento_vinculado_en_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [vitrina_documento_pkey] PRIMARY KEY CLUSTERED ([id_vitrina_documento])
    );
    ALTER TABLE [dbo].[vitrina_documento] ADD CONSTRAINT [vitrina_documento_id_presentacion_fkey] FOREIGN KEY ([id_presentacion]) REFERENCES [dbo].[vitrina_presentacion]([id_presentacion]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END

  IF OBJECT_ID(N'dbo.vitrina_historial', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[vitrina_historial] (
      [id_historial] BIGINT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [entidad] NVARCHAR(40) NOT NULL,
      [id_entidad] INT NOT NULL,
      [accion] NVARCHAR(40) NOT NULL,
      [valor_anterior] NVARCHAR(max),
      [valor_nuevo] NVARCHAR(max),
      [id_user] NVARCHAR(50),
      [registrado_en] DATETIME2 NOT NULL CONSTRAINT [vitrina_historial_registrado_en_df] DEFAULT sysutcdatetime(),
      CONSTRAINT [vitrina_historial_pkey] PRIMARY KEY CLUSTERED ([id_historial])
    );
    CREATE NONCLUSTERED INDEX [IX_vitrina_historial_entidad] ON [dbo].[vitrina_historial]([entidad], [id_entidad]);
    CREATE NONCLUSTERED INDEX [IX_vitrina_historial_company] ON [dbo].[vitrina_historial]([id_company], [registrado_en]);
    ALTER TABLE [dbo].[vitrina_historial] ADD CONSTRAINT [vitrina_historial_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END

  /* Restricciones CHECK (Prisma no las expresa; db push de la CI tampoco las crea). */
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_vitrina_presentacion_estado' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_presentacion'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_presentacion] ADD CONSTRAINT [CK_vitrina_presentacion_estado] CHECK ([estado] IN (''PENDIENTE'',''VALIDADA'',''RETIRADA''))');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_vitrina_presentacion_visibilidad' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_presentacion'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_presentacion] ADD CONSTRAINT [CK_vitrina_presentacion_visibilidad] CHECK ([visibilidad] IN (''INTERNA'',''CLIENTE'',''OFERTABLE''))');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_vitrina_presentacion_terceros' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_presentacion'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_presentacion] ADD CONSTRAINT [CK_vitrina_presentacion_terceros] CHECK ([es_para_terceros] = 0 OR [visibilidad] = ''INTERNA'')');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_vitrina_codigo_sap_canal' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_codigo_sap'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_codigo_sap] ADD CONSTRAINT [CK_vitrina_codigo_sap_canal] CHECK ([canal] IN (''INSTITUCIONAL'',''COMERCIAL'',''SIN_DATO''))');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_vitrina_codigo_sap_visibilidad_canal' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_codigo_sap'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_codigo_sap] ADD CONSTRAINT [CK_vitrina_codigo_sap_visibilidad_canal] CHECK ([visibilidad_canal] IN (''INTERNA'',''CLIENTE'',''OFERTABLE''))');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_vitrina_codigo_sap_reg' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_codigo_sap'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_codigo_sap] ADD CONSTRAINT [CK_vitrina_codigo_sap_reg] CHECK ([registro_estado] IN (''VIGENTE'',''POR_VENCER'',''VENCIDO'',''SIN_REGISTRO'',''SIN_FECHA''))');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_vitrina_exclusividad_alcance' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_exclusividad'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_exclusividad] ADD CONSTRAINT [CK_vitrina_exclusividad_alcance] CHECK ([alcance] IN (''EXHIBIR'',''OFERTAR''))');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_vitrina_exclusividad_canal' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_exclusividad'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_exclusividad] ADD CONSTRAINT [CK_vitrina_exclusividad_canal] CHECK ([canal] IS NULL OR [canal] IN (''INSTITUCIONAL'',''COMERCIAL'',''SIN_DATO''))');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_vitrina_exclusividad_vigencia' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_exclusividad'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_exclusividad] ADD CONSTRAINT [CK_vitrina_exclusividad_vigencia] CHECK ([vigente_desde] IS NULL OR [vigente_hasta] IS NULL OR [vigente_desde] <= [vigente_hasta])');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_vitrina_imagen_tipo' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_imagen'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_imagen] ADD CONSTRAINT [CK_vitrina_imagen_tipo] CHECK ([tipo] IN (''VIAL'',''ETIQUETA'',''PLEGADIZA''))');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_vitrina_documento_tipo' AND parent_object_id = OBJECT_ID(N'dbo.vitrina_documento'))
    EXEC(N'ALTER TABLE [dbo].[vitrina_documento] ADD CONSTRAINT [CK_vitrina_documento_tipo] CHECK ([tipo] IN (''FICHA'',''INSERTO'',''PROSPECTO''))');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
/* BLOQUE-DDL-FIN */
