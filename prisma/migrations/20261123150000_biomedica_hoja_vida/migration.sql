/*
  Migración: INGENIERÍA BIOMÉDICA · HOJA DE VIDA Y MANTENIMIENTOS (fase 3, 2026-11-23; reunión de Nicolás Rivera con
  Juan Mora del 2026-11-23). Tablas en dbo, fuera del esquema sgc validado:
    - biomed_equipo: fecha de ingreso, vida útil (años) y periodicidad del mantenimiento preventivo (meses);
    - biomed_registro: el equipo al que pertenece el formato diligenciado y, en la inspección de equipos nuevos,
      los datos del equipo que se crea en el inventario al cerrarla;
    - biomed_mantenimiento (nueva): mantenimientos preventivos, correctivos y metrológicos con su lista de chequeo;
      no se borran ni se cambian, solo se anulan con motivo (disparador).

  SOLO ADITIVO e IDEMPOTENTE (columnas NULL y una tabla nueva; no toca datos existentes). ⚠️ ANTES del código.

  BLOQUE-DDL-INICIO (los scripts manuales de PRUEBAS y PROD repiten este bloque tal cual;
  lib/biomedica/__tests__/hojaVida.test.ts verifica que no se separen).
*/

SET XACT_ABORT ON;

-- Hoja de vida del equipo: fecha de ingreso, vida útil y cada cuántos meses le toca mantenimiento preventivo.
IF COL_LENGTH(N'dbo.biomed_equipo', N'fecha_ingreso') IS NULL
  ALTER TABLE [dbo].[biomed_equipo] ADD [fecha_ingreso] DATE NULL;
IF COL_LENGTH(N'dbo.biomed_equipo', N'vida_util_anios') IS NULL
  ALTER TABLE [dbo].[biomed_equipo] ADD [vida_util_anios] INT NULL CONSTRAINT [biomed_equipo_vida_util_ck] CHECK ([vida_util_anios] IS NULL OR [vida_util_anios] BETWEEN 1 AND 50);
IF COL_LENGTH(N'dbo.biomed_equipo', N'periodicidad_mant_meses') IS NULL
  ALTER TABLE [dbo].[biomed_equipo] ADD [periodicidad_mant_meses] INT NULL CONSTRAINT [biomed_equipo_periodicidad_ck] CHECK ([periodicidad_mant_meses] IS NULL OR [periodicidad_mant_meses] BETWEEN 1 AND 120);

-- Formato diligenciado ligado a su equipo (hoja de vida) y, en la inspección de ingreso, los datos del equipo que se crea al cerrarla.
IF COL_LENGTH(N'dbo.biomed_registro', N'id_biomed_equipo') IS NULL
  ALTER TABLE [dbo].[biomed_registro] ADD [id_biomed_equipo] INT NULL;
IF COL_LENGTH(N'dbo.biomed_registro', N'equipo_json') IS NULL
  ALTER TABLE [dbo].[biomed_registro] ADD [equipo_json] NVARCHAR(MAX) NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'biomed_registro_id_biomed_equipo_idx' AND object_id = OBJECT_ID(N'dbo.biomed_registro'))
  EXEC sp_executesql N'CREATE NONCLUSTERED INDEX [biomed_registro_id_biomed_equipo_idx] ON [dbo].[biomed_registro]([id_biomed_equipo])';

-- Mantenimientos de cada equipo (preventivo, correctivo, metrológico): no se borran; solo se anulan con motivo.
IF OBJECT_ID(N'dbo.biomed_mantenimiento', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[biomed_mantenimiento] (
    [id_biomed_mantenimiento] INT NOT NULL IDENTITY(1,1),
    [id_company] INT NOT NULL,
    [id_biomed_equipo] INT NOT NULL,
    [fecha] DATE NOT NULL,
    [tipo] NVARCHAR(20) NOT NULL,
    [numero_reporte] NVARCHAR(50) NULL,
    [checklist_json] NVARCHAR(MAX) NOT NULL CONSTRAINT [biomed_mantenimiento_checklist_df] DEFAULT N'[]',
    [observaciones] NVARCHAR(2000) NULL,
    [responsables] NVARCHAR(500) NOT NULL,
    [proximo] DATE NULL,
    [id_biomed_registro] INT NULL,
    [estado] NVARCHAR(20) NOT NULL CONSTRAINT [biomed_mantenimiento_estado_df] DEFAULT N'vigente',
    [anulado_por] NVARCHAR(255) NULL,
    [anulado_at] DATETIME2 NULL,
    [motivo_anulacion] NVARCHAR(1000) NULL,
    [created_by] NVARCHAR(255) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [biomed_mantenimiento_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [biomed_mantenimiento_pkey] PRIMARY KEY CLUSTERED ([id_biomed_mantenimiento]),
    CONSTRAINT [biomed_mantenimiento_tipo_ck] CHECK ([tipo] IN (N'preventivo', N'correctivo', N'metrologico')),
    CONSTRAINT [biomed_mantenimiento_estado_ck] CHECK ([estado] IN (N'vigente', N'anulado'))
  );
  CREATE NONCLUSTERED INDEX [biomed_mantenimiento_id_biomed_equipo_fecha_idx] ON [dbo].[biomed_mantenimiento]([id_biomed_equipo], [fecha]);
  CREATE NONCLUSTERED INDEX [biomed_mantenimiento_id_company_proximo_idx] ON [dbo].[biomed_mantenimiento]([id_company], [proximo]);
END;

-- Un mantenimiento no se borra ni se cambia: solo pasa de vigente a anulado (con quién, cuándo y por qué).
IF OBJECT_ID(N'dbo.biomed_mantenimiento_control', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [dbo].[biomed_mantenimiento_control] ON [dbo].[biomed_mantenimiento] AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
    THROW 51590, N''Un mantenimiento no se borra: anúlelo con su motivo.'', 1;
  IF UPDATE(id_company) OR UPDATE(id_biomed_equipo) OR UPDATE(fecha) OR UPDATE(tipo) OR UPDATE(numero_reporte) OR UPDATE(checklist_json)
     OR UPDATE(observaciones) OR UPDATE(responsables) OR UPDATE(proximo) OR UPDATE(id_biomed_registro) OR UPDATE(created_by) OR UPDATE(created_at)
     OR EXISTS (SELECT 1 FROM deleted WHERE estado = N''anulado'')
    THROW 51591, N''Un mantenimiento registrado no se modifica: solo se anula con su motivo.'', 1;
END';

/* BLOQUE-DDL-FIN */
