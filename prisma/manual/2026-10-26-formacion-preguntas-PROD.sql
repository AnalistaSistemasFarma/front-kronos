/*
  PASE MANUAL (PROD) — Formación · preguntas y respuestas por material (2026-10-26).
  El MISMO bloque DDL de prisma/migrations/20261026150000_formacion_preguntas/migration.sql (aditivo,
  idempotente). Va DESPUÉS de 2026-10-26-formacion-modulo-PROD.sql y ANTES del código.
  Después: npx prisma migrate resolve --applied 20261026150000_formacion_preguntas
  REVERSA: prisma/manual/2026-10-26-formacion-preguntas-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB')
  THROW 51572, N'Base no esperada: este script es solo para KRONOSDB (producción).', 1;

/* BLOQUE-DDL-INICIO */
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  -- Preguntas y respuestas de cada material (video) del curso. parent_id = respuesta a otra.
  -- Sin FK al curso: SQL Server no admite dos caminos de borrado en cascada (material -> curso).
  IF OBJECT_ID(N'dbo.formacion_pregunta', N'U') IS NULL
    CREATE TABLE [dbo].[formacion_pregunta] (
      [id]            INT IDENTITY(1,1) NOT NULL CONSTRAINT [formacion_pregunta_pkey] PRIMARY KEY,
      [material_id]   INT NOT NULL,
      [course_id]     INT NOT NULL,
      [parent_id]     INT NULL,
      [email]         NVARCHAR(255) NOT NULL,
      [nombre]        NVARCHAR(255) NOT NULL,
      [texto]         NVARCHAR(2000) NOT NULL,
      [created_at]    DATETIME2 NOT NULL CONSTRAINT [formacion_pregunta_created_at_df] DEFAULT SYSUTCDATETIME(),
      [eliminado_at]  DATETIME2 NULL,
      [eliminado_por] NVARCHAR(255) NULL,
      CONSTRAINT [formacion_pregunta_material_fkey] FOREIGN KEY ([material_id]) REFERENCES [dbo].[portal_course_material]([id]) ON DELETE CASCADE,
      CONSTRAINT [formacion_pregunta_parent_fkey] FOREIGN KEY ([parent_id]) REFERENCES [dbo].[formacion_pregunta]([id])
    );

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'formacion_pregunta_material_idx')
    CREATE INDEX [formacion_pregunta_material_idx] ON [dbo].[formacion_pregunta] ([material_id], [parent_id]);

  -- «Me gusta» de una pregunta o respuesta (uno por persona).
  IF OBJECT_ID(N'dbo.formacion_pregunta_like', N'U') IS NULL
    CREATE TABLE [dbo].[formacion_pregunta_like] (
      [id]          INT IDENTITY(1,1) NOT NULL CONSTRAINT [formacion_pregunta_like_pkey] PRIMARY KEY,
      [pregunta_id] INT NOT NULL,
      [email]       NVARCHAR(255) NOT NULL,
      [created_at]  DATETIME2 NOT NULL CONSTRAINT [formacion_pregunta_like_created_at_df] DEFAULT SYSUTCDATETIME(),
      CONSTRAINT [formacion_pregunta_like_pregunta_fkey] FOREIGN KEY ([pregunta_id]) REFERENCES [dbo].[formacion_pregunta]([id]) ON DELETE CASCADE,
      CONSTRAINT [formacion_pregunta_like_uq] UNIQUE ([pregunta_id], [email])
    );

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
/* BLOQUE-DDL-FIN */
