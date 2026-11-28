/*
  PASE MANUAL (PROD) — SGC · capacitación con un curso de Formación (2026-11-26).
  QUÉ HACE (idempotente; no toca datos existentes): el MISMO bloque DDL de
  prisma/migrations/20261126180000_formacion_curso_capacitacion/migration.sql (tabla dbo.sgc_training_course).
  ORDEN: ANTES del código. REVERSA: prisma/manual/2026-11-26-sgc-formacion-curso-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() <> N'KRONOSDB'
  THROW 51871, N'Base no esperada: este script es solo para KRONOSDB (producción).', 1;

SET XACT_ABORT ON;

-- Curso de Formación de la capacitación de una solicitud del SGC (tabla en dbo, FUERA del esquema sgc validado).
IF OBJECT_ID(N'dbo.sgc_training_course', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[sgc_training_course] (
    [id_training] INT NOT NULL,
    [course_id] INT NOT NULL,
    [linked_by] NVARCHAR(255) NOT NULL,
    [linked_at] DATETIME2 NOT NULL CONSTRAINT [sgc_training_course_linked_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [sgc_training_course_pkey] PRIMARY KEY CLUSTERED ([id_training])
  );
  CREATE NONCLUSTERED INDEX [sgc_training_course_course_id_idx] ON [dbo].[sgc_training_course]([course_id]);
END;

/* BLOQUE-DDL-FIN */

SELECT DB_NAME() AS base, OBJECT_ID(N'dbo.sgc_training_course', N'U') AS sgc_training_course;
