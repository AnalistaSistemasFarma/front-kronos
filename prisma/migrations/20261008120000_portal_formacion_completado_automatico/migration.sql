/*
  Migración: FORMACIÓN (Portal TH) — completado AUTOMÁTICO de materiales — ADITIVA.

  Pedido de Cristian Baldión (2026-10-08): la casilla de "completado" queda
  bloqueada para los estudiantes y se marca SOLA cuando la persona revisa todo
  el material; solo los administradores y formadores del Excel
  "ADMINISTRADORES - FORMADORES" (sitio TalentoHumano) la marcan a mano.

  1. `portal_material_progress`: de dónde salió cada marca.
       origen       'AUTO' | 'MANUAL' (las filas existentes quedan 'MANUAL':
                    hasta hoy las marcaba el propio estudiante).
       marcado_por  correo de quien la marcó a mano.
  2. `portal_material_vista`: apertura de un material, registrada por el
     SERVIDOR; el reporte de "revisado" se valida contra su hora.

  No borra ni modifica datos existentes. Generada MANUALMENTE (sin shadow
  database — P3014, igual que las migraciones anteriores del portal). Correr
  primero contra KRONOSDB_PRUEBAS (.230). Idempotente.
*/

IF COL_LENGTH(N'dbo.portal_material_progress', N'origen') IS NULL
  ALTER TABLE [dbo].[portal_material_progress]
    ADD [origen] NVARCHAR(10) NOT NULL
      CONSTRAINT [DF_portal_material_progress_origen] DEFAULT N'MANUAL';

IF COL_LENGTH(N'dbo.portal_material_progress', N'marcado_por') IS NULL
  ALTER TABLE [dbo].[portal_material_progress] ADD [marcado_por] NVARCHAR(255) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'portal_material_vista' AND schema_id = SCHEMA_ID(N'dbo'))
BEGIN
  CREATE TABLE [dbo].[portal_material_vista] (
    [id]              INT IDENTITY(1,1) NOT NULL,
    [token]           NVARCHAR(36)   NOT NULL,
    [material_id]     INT            NOT NULL,
    [student_email]   NVARCHAR(255)  NOT NULL,
    [abierta_at]      DATETIME2      NOT NULL CONSTRAINT [DF_portal_material_vista_abierta] DEFAULT SYSUTCDATETIME(),
    [paginas]         INT            NULL,
    [reportada_at]    DATETIME2      NULL,
    [segundos_vistos] INT            NULL,
    [duracion_seg]    INT            NULL,
    [aceptada]        BIT            NULL,
    CONSTRAINT [PK_portal_material_vista] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_portal_material_vista_material] FOREIGN KEY ([material_id])
      REFERENCES [dbo].[portal_course_material] ([id]) ON DELETE CASCADE
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_material_vista]') AND name = N'portal_material_vista_token_key'
)
  CREATE UNIQUE NONCLUSTERED INDEX [portal_material_vista_token_key]
    ON [dbo].[portal_material_vista]([token] ASC);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_material_vista]') AND name = N'portal_material_vista_material_id_student_email_idx'
)
  CREATE NONCLUSTERED INDEX [portal_material_vista_material_id_student_email_idx]
    ON [dbo].[portal_material_vista]([material_id] ASC, [student_email] ASC);

/*
  REVERSA (manual; solo si hay que deshacer este cambio). No toca datos de
  progreso: solo quita lo que agrega esta migración.

  DROP TABLE IF EXISTS [dbo].[portal_material_vista];

  IF COL_LENGTH(N'dbo.portal_material_progress', N'marcado_por') IS NOT NULL
    ALTER TABLE [dbo].[portal_material_progress] DROP COLUMN [marcado_por];

  IF OBJECT_ID(N'dbo.DF_portal_material_progress_origen', N'D') IS NOT NULL
    ALTER TABLE [dbo].[portal_material_progress] DROP CONSTRAINT [DF_portal_material_progress_origen];
  IF COL_LENGTH(N'dbo.portal_material_progress', N'origen') IS NOT NULL
    ALTER TABLE [dbo].[portal_material_progress] DROP COLUMN [origen];
*/
