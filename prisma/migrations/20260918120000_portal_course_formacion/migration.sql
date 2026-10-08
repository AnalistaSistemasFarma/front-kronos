/*
  Migración: portal_course + portal_course_material + portal_course_enrollment
             + portal_material_progress + portal_certificate
  FORMACIÓN — Portal de Talento Humano.

  Pedido de Cristian Baldión (2026-09-18): una sección "tipo Moodle" al final
  del portal — cursos con materiales (documento o enlace), una barra de
  progreso que ve el formador Y el estudiante, y un certificado de GSS al
  llegar al 100%.

  POR QUÉ LOS DOCUMENTOS VAN EN LA BASE (VARBINARY) Y NO EN SHAREPOINT: mismo
  criterio que `portal_banner` (ver esa migración). El conector de SharePoint
  que usa el portal es de SOLO LECTURA a propósito — darle escritura sería
  ampliar permisos de una credencial que ya tiene más de los que debería (ver
  revisión de la app de Entra, 2026-09-09). `portal_course_material` es
  multi-fila por curso, pero es exactamente el mismo patrón que
  `portal_banner`, solo que ahora agrupado bajo un curso.

  ATENCIÓN: generada MANUALMENTE (sin permiso de shadow database — P3014,
  igual que las migraciones anteriores del portal).

  ⚠️ NO SE APLICÓ contra ninguna base de datos. Este entorno no tiene
  credenciales de conexión a KRONOSDB_PRUEBAS (server .230) ni forma segura de
  llegar allá — queda pendiente que alguien con acceso la corra contra
  TESTING. NUNCA contra KRONOSDB de producción (serfarma05).

  Idempotente: se puede re-correr sin efecto.
*/

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'portal_course')
BEGIN
  CREATE TABLE [dbo].[portal_course] (
    [id]          INT IDENTITY(1,1) NOT NULL,
    [title]       NVARCHAR(255)  NOT NULL,
    [description] NVARCHAR(MAX)  NULL,
    [active]      BIT            NOT NULL CONSTRAINT [DF_portal_course_active] DEFAULT 1,
    -- Correo del formador que lo creó. Texto, no FK a `user`: la mayoría de
    -- quienes entran al portal no tiene usuario en SynerLink.
    [created_by]  NVARCHAR(255)  NOT NULL,
    [created_at]  DATETIME2      NOT NULL CONSTRAINT [DF_portal_course_created] DEFAULT SYSDATETIME(),
    [updated_at]  DATETIME2      NOT NULL CONSTRAINT [DF_portal_course_updated] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_portal_course] PRIMARY KEY CLUSTERED ([id] ASC)
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_course]') AND name = N'portal_course_active_idx'
)
BEGIN
  CREATE NONCLUSTERED INDEX [portal_course_active_idx]
    ON [dbo].[portal_course]([active] ASC, [id] DESC);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'portal_course_material')
BEGIN
  CREATE TABLE [dbo].[portal_course_material] (
    [id]          INT IDENTITY(1,1) NOT NULL,
    [course_id]   INT            NOT NULL,
    -- 'DOCUMENT' | 'LINK'. Texto y no CHECK/enum: mismo criterio del resto
    -- del esquema (ver `kind`, `status`, `role`, etc. en otras tablas —
    -- SQL Server/Prisma no maneja bien los enums nativos en este proyecto).
    [type]        NVARCHAR(20)   NOT NULL,
    [title]       NVARCHAR(255)  NOT NULL,
    -- Orden dentro del curso, lo define el formador.
    [orden]       INT            NOT NULL CONSTRAINT [DF_portal_course_material_orden] DEFAULT 0,
    -- Solo si type = 'LINK'.
    [url]         NVARCHAR(1000) NULL,
    -- Solo si type = 'DOCUMENT' — mismos tres campos que `portal_banner`.
    [file_name]   NVARCHAR(255)  NULL,
    [mime]        NVARCHAR(100)  NULL,
    [contenido]   VARBINARY(MAX) NULL,
    -- Si hace falta marcarlo como completado para llegar al 100% del curso.
    [required]    BIT            NOT NULL CONSTRAINT [DF_portal_course_material_required] DEFAULT 1,
    [created_at]  DATETIME2      NOT NULL CONSTRAINT [DF_portal_course_material_created] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_portal_course_material] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_portal_course_material_course] FOREIGN KEY ([course_id])
      REFERENCES [dbo].[portal_course] ([id]) ON DELETE CASCADE
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_course_material]') AND name = N'portal_course_material_course_orden_idx'
)
BEGIN
  CREATE NONCLUSTERED INDEX [portal_course_material_course_orden_idx]
    ON [dbo].[portal_course_material]([course_id] ASC, [orden] ASC);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'portal_course_enrollment')
BEGIN
  CREATE TABLE [dbo].[portal_course_enrollment] (
    [id]             INT IDENTITY(1,1) NOT NULL,
    [course_id]      INT            NOT NULL,
    [student_email]  NVARCHAR(255)  NOT NULL,
    [enrolled_at]    DATETIME2      NOT NULL CONSTRAINT [DF_portal_course_enrollment_enrolled] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_portal_course_enrollment] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_portal_course_enrollment_course] FOREIGN KEY ([course_id])
      REFERENCES [dbo].[portal_course] ([id]) ON DELETE CASCADE
  );
END

-- Autoinscripción: una fila por curso+estudiante, nunca duplicada.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_course_enrollment]') AND name = N'portal_course_enrollment_unq'
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX [portal_course_enrollment_unq]
    ON [dbo].[portal_course_enrollment]([course_id] ASC, [student_email] ASC);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'portal_material_progress')
BEGIN
  CREATE TABLE [dbo].[portal_material_progress] (
    [id]             INT IDENTITY(1,1) NOT NULL,
    [material_id]    INT            NOT NULL,
    [student_email]  NVARCHAR(255)  NOT NULL,
    [completed_at]   DATETIME2      NOT NULL CONSTRAINT [DF_portal_material_progress_completed] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_portal_material_progress] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_portal_material_progress_material] FOREIGN KEY ([material_id])
      REFERENCES [dbo].[portal_course_material] ([id]) ON DELETE CASCADE
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_material_progress]') AND name = N'portal_material_progress_unq'
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX [portal_material_progress_unq]
    ON [dbo].[portal_material_progress]([material_id] ASC, [student_email] ASC);
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_material_progress]') AND name = N'portal_material_progress_student_idx'
)
BEGIN
  CREATE NONCLUSTERED INDEX [portal_material_progress_student_idx]
    ON [dbo].[portal_material_progress]([student_email] ASC);
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'portal_certificate')
BEGIN
  CREATE TABLE [dbo].[portal_certificate] (
    [id]             INT IDENTITY(1,1) NOT NULL,
    -- Código único de verificación (va también en el PDF).
    [code]           NVARCHAR(40)   NOT NULL,
    [course_id]      INT            NOT NULL,
    [student_email]  NVARCHAR(255)  NOT NULL,
    -- `student_name` y `course_title` quedan CONGELADOS al emitir: si el
    -- curso cambia de nombre después, el certificado ya entregado no cambia
    -- con él.
    [student_name]   NVARCHAR(255)  NOT NULL,
    [course_title]   NVARCHAR(255)  NOT NULL,
    [issued_at]      DATETIME2      NOT NULL CONSTRAINT [DF_portal_certificate_issued] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_portal_certificate] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_portal_certificate_course] FOREIGN KEY ([course_id])
      REFERENCES [dbo].[portal_course] ([id])
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_certificate]') AND name = N'portal_certificate_code_unq'
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX [portal_certificate_code_unq]
    ON [dbo].[portal_certificate]([code] ASC);
END

-- Un solo certificado vigente por curso+estudiante: si vuelve a completar el
-- curso no se le emite uno nuevo, se reimprime el mismo (ver la ruta API).
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_certificate]') AND name = N'portal_certificate_course_student_unq'
)
BEGIN
  CREATE UNIQUE NONCLUSTERED INDEX [portal_certificate_course_student_unq]
    ON [dbo].[portal_certificate]([course_id] ASC, [student_email] ASC);
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_certificate]') AND name = N'portal_certificate_student_idx'
)
BEGIN
  CREATE NONCLUSTERED INDEX [portal_certificate_student_idx]
    ON [dbo].[portal_certificate]([student_email] ASC);
END
