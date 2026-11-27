/*
  Migración: SGC · CAPACITACIÓN CON UN CURSO DE FORMACIÓN (2026-11-26; reunión de Nicolás Rivera con Juan Mora del
  2026-11-23: «primero se configura el curso en Formación y en la solicitud documental se elige ese curso»).
  Tabla en dbo (no toca el esquema sgc validado). SOLO ADITIVO e IDEMPOTENTE. ⚠️ ANTES del código.

  BLOQUE-DDL-INICIO (los scripts manuales de PRUEBAS y PROD repiten este bloque tal cual;
  lib/sgc/__tests__/formacion-curso.test.ts verifica que no se separen).
*/

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
