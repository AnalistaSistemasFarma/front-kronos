/*
  Migración: FORMACIÓN como MÓDULO propio (/process/formacion) — ADITIVA. 2026-10-26.

  Pedido de Nicolás Rivera (2026-10-26, proyecto «Portal de capacitaciones»):
    - Formación es un módulo nuevo de /process con permiso por usuario y empresa (módulo Usuarios).
    - Los cursos van por empresa y departamento (departamentos de SynerLink, habilitados por empresa)
      y se activan o desactivan por empresa y departamento.
    - Divulgación de cursos o videos nuevos, con un ícono de pendientes en el header.

  Agrega 1 columna NULLABLE (portal_course.id_company_owner) y 5 tablas nuevas. No toca datos
  existentes: los cursos actuales quedan SIN alcance = para todas las empresas y departamentos.

  Generada MANUALMENTE (producción no está baselined: P3005). Se corre A MANO con respaldo:
  prisma/manual/2026-10-26-formacion-modulo-PRUEBAS.sql y luego -PROD.sql (repiten este bloque;
  lib/formacion/__tests__/formacion-modulo-sql.test.ts verifica que no se separen). IDEMPOTENTE.
  ⚠️ ORDEN: ANTES del código (Prisma lee todas las columnas de portal_course).
  REVERSA: prisma/manual/2026-10-26-formacion-modulo-reversa.sql
*/

SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51560, N'Base no esperada: esta migración solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

/* BLOQUE-DDL-INICIO */
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  -- Empresa dueña del curso (NULL = GSS: lo administra quien tenga Formación en GSS).
  IF COL_LENGTH(N'dbo.portal_course', N'id_company_owner') IS NULL
    ALTER TABLE [dbo].[portal_course] ADD [id_company_owner] INT NULL;

  -- Departamentos de SynerLink que aplican en cada empresa (administrable en el módulo).
  IF OBJECT_ID(N'dbo.formacion_empresa_departamento', N'U') IS NULL
    CREATE TABLE [dbo].[formacion_empresa_departamento] (
      [id]            INT IDENTITY(1,1) NOT NULL CONSTRAINT [formacion_empresa_departamento_pkey] PRIMARY KEY,
      [id_company]    INT NOT NULL,
      [id_department] INT NOT NULL,
      [activo]        BIT NOT NULL CONSTRAINT [formacion_empresa_departamento_activo_df] DEFAULT 1,
      [updated_by]    NVARCHAR(255) NOT NULL,
      [updated_at]    DATETIME2 NOT NULL CONSTRAINT [formacion_empresa_departamento_updated_at_df] DEFAULT SYSUTCDATETIME(),
      CONSTRAINT [formacion_empresa_departamento_uq] UNIQUE ([id_company], [id_department])
    );

  -- Colaborador -> empresa -> departamento (para quien no tiene el departamento en SynerLink).
  IF OBJECT_ID(N'dbo.formacion_colaborador', N'U') IS NULL
    CREATE TABLE [dbo].[formacion_colaborador] (
      [id]            INT IDENTITY(1,1) NOT NULL CONSTRAINT [formacion_colaborador_pkey] PRIMARY KEY,
      [email]         NVARCHAR(255) NOT NULL,
      [nombre]        NVARCHAR(255) NULL,
      [id_company]    INT NOT NULL,
      [id_department] INT NOT NULL,
      [updated_by]    NVARCHAR(255) NOT NULL,
      [updated_at]    DATETIME2 NOT NULL CONSTRAINT [formacion_colaborador_updated_at_df] DEFAULT SYSUTCDATETIME(),
      CONSTRAINT [formacion_colaborador_uq] UNIQUE ([email], [id_company])
    );

  -- Alcance del curso por empresa y departamento (id_department NULL = todos los departamentos de la empresa).
  -- Un curso SIN filas de alcance es para todas las empresas y departamentos (así quedan los cursos existentes).
  IF OBJECT_ID(N'dbo.formacion_curso_alcance', N'U') IS NULL
    CREATE TABLE [dbo].[formacion_curso_alcance] (
      [id]            INT IDENTITY(1,1) NOT NULL CONSTRAINT [formacion_curso_alcance_pkey] PRIMARY KEY,
      [course_id]     INT NOT NULL,
      [id_company]    INT NOT NULL,
      [id_department] INT NULL,
      [activo]        BIT NOT NULL CONSTRAINT [formacion_curso_alcance_activo_df] DEFAULT 1,
      [updated_by]    NVARCHAR(255) NOT NULL,
      [updated_at]    DATETIME2 NOT NULL CONSTRAINT [formacion_curso_alcance_updated_at_df] DEFAULT SYSUTCDATETIME(),
      CONSTRAINT [formacion_curso_alcance_course_fkey] FOREIGN KEY ([course_id]) REFERENCES [dbo].[portal_course]([id]) ON DELETE CASCADE,
      CONSTRAINT [formacion_curso_alcance_uq] UNIQUE ([course_id], [id_company], [id_department])
    );

  -- Divulgación de un curso o de un material (video) nuevo.
  IF OBJECT_ID(N'dbo.formacion_divulgacion', N'U') IS NULL
    CREATE TABLE [dbo].[formacion_divulgacion] (
      [id]            INT IDENTITY(1,1) NOT NULL CONSTRAINT [formacion_divulgacion_pkey] PRIMARY KEY,
      [course_id]     INT NOT NULL,
      [material_id]   INT NULL,
      [mensaje]       NVARCHAR(1000) NULL,
      [divulgado_por] NVARCHAR(255) NOT NULL,
      [divulgado_at]  DATETIME2 NOT NULL CONSTRAINT [formacion_divulgacion_divulgado_at_df] DEFAULT SYSUTCDATETIME(),
      CONSTRAINT [formacion_divulgacion_course_fkey] FOREIGN KEY ([course_id]) REFERENCES [dbo].[portal_course]([id]) ON DELETE CASCADE
    );

  -- A quién le quedó pendiente; visto_at se llena al abrir el curso o revisar el material.
  IF OBJECT_ID(N'dbo.formacion_divulgacion_destinatario', N'U') IS NULL
    CREATE TABLE [dbo].[formacion_divulgacion_destinatario] (
      [id]             INT IDENTITY(1,1) NOT NULL CONSTRAINT [formacion_divulgacion_destinatario_pkey] PRIMARY KEY,
      [divulgacion_id] INT NOT NULL,
      [email]          NVARCHAR(255) NOT NULL,
      [visto_at]       DATETIME2 NULL,
      CONSTRAINT [formacion_divulgacion_destinatario_div_fkey] FOREIGN KEY ([divulgacion_id]) REFERENCES [dbo].[formacion_divulgacion]([id]) ON DELETE CASCADE,
      CONSTRAINT [formacion_divulgacion_destinatario_uq] UNIQUE ([divulgacion_id], [email])
    );

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'formacion_divulgacion_destinatario_email_visto_idx')
    CREATE INDEX [formacion_divulgacion_destinatario_email_visto_idx] ON [dbo].[formacion_divulgacion_destinatario] ([email], [visto_at]);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
/* BLOQUE-DDL-FIN */
