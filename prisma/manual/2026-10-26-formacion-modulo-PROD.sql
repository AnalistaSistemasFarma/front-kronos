/*
  PASE MANUAL (PROD) — Formación como módulo propio (2026-10-26).
  Se corre con el visto bueno de Nicolás Rivera, con respaldo COPY_ONLY antes.

  1) El MISMO bloque DDL de prisma/migrations/20261026120000_formacion_modulo/migration.sql
     (aditivo e idempotente).
  2) Registra el módulo «Formación» (/process/formacion) en el proceso Talento Humano, si no existe.
     Los permisos se asignan después desde el módulo Usuarios (por usuario y empresa).

  ⚠️ ORDEN: ANTES del código.
  Después: npx prisma migrate resolve --applied 20261026120000_formacion_modulo
  REVERSA: prisma/manual/2026-10-26-formacion-modulo-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51562, N'Base no esperada: este script es solo para KRONOSDB (producción).', 1;

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

/* MÓDULO */
DECLARE @ProcessName NVARCHAR(255) = N'Talento Humano';
DECLARE @Url         NVARCHAR(255) = N'/process/formacion';
DECLARE @Nombre      NVARCHAR(255) = N'Formación';

BEGIN TRY
  BEGIN TRANSACTION;

  DECLARE @ProcessId INT = (SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process);
  IF @ProcessId IS NULL
  BEGIN
    INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
    SET @ProcessId = SCOPE_IDENTITY();
  END

  IF NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] WHERE subprocess_url = @Url)
    INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url) VALUES (@Nombre, @ProcessId, @Url);

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT DB_NAME() AS base, p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url = @Url;
