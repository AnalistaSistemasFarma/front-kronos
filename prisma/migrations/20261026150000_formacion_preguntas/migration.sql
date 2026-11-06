/*
  Migración: FORMACIÓN · PREGUNTAS Y RESPUESTAS por material (video) — ADITIVA. 2026-10-26.

  Pedido de Nicolás Rivera (2026-10-26): la vista del video con su sección de preguntas y respuestas.
  Agrega 2 tablas nuevas (formacion_pregunta, formacion_pregunta_like). No toca datos existentes.

  Generada MANUALMENTE (producción no está baselined: P3005). Se corre A MANO con respaldo:
  prisma/manual/2026-10-26-formacion-preguntas-PRUEBAS.sql y luego -PROD.sql (repiten este bloque;
  lib/formacion/__tests__/formacion-preguntas-sql.test.ts verifica que no se separen). IDEMPOTENTE.
  ⚠️ ORDEN: ANTES del código.
  REVERSA: prisma/manual/2026-10-26-formacion-preguntas-reversa.sql
*/

SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51570, N'Base no esperada: esta migración solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

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
