/*
  Migración: sgc_s10_capacitacion_opcional
  SGC documental — Sprint 10 del plan del 2026-10-08 (socialización con
  Calidad OLP del 2026-10-07): capacitación OPCIONAL por solicitud y
  configurada ANTES de la divulgación, evaluación solo en Microsoft Forms o
  Google Forms, 2 intentos y recapacitación.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca `dbo`):
    - [sgc].[request]: requires_training_suggested (lo sugiere el
        solicitante), requires_training (lo confirma quien crea el documento o
        Calidad), training_confirmed_by y training_confirmed_at. NULL = como
        hasta hoy (manda el tipo documental): las solicitudes en curso no cambian.
    - [sgc].[training]: evaluation_provider (microsoft | google) y
        max_attempts (2 por defecto, CHECK 1–5).
    - [sgc].[training_result]: attempt_number (intento que cuenta),
        extra_attempts (intentos de más, no cuentan) y retraining_required.
    - [sgc].[retraining]: recapacitación presencial o virtual que registra
        Calidad (SOLO INSERCIÓN).
  El flujo nuevo (preparación de la capacitación antes de la divulgación) es
  un DATO: prisma/manual/2026-10-08-sgc-s10-flujo-capacitacion-previa-olp.sql.

  ⚠️ ORDEN DEL PASE: después de la del Sprint 9 y antes que el código.
  Idempotente. Cambio controlado del esquema `sgc` (lo declara en la sesión).

  REVERSA: prisma/manual/2026-10-08-sgc-s10-capacitacion-opcional-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261008120000_sgc_s10_capacitacion_opcional (Sprint 10)';

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'sgc.request', N'requires_training_suggested') IS NULL
  ALTER TABLE [sgc].[request] ADD [requires_training_suggested] BIT NULL;
IF COL_LENGTH(N'sgc.request', N'requires_training') IS NULL
  ALTER TABLE [sgc].[request] ADD [requires_training] BIT NULL;
IF COL_LENGTH(N'sgc.request', N'training_confirmed_by') IS NULL
  ALTER TABLE [sgc].[request] ADD [training_confirmed_by] NVARCHAR(255) NULL;
IF COL_LENGTH(N'sgc.request', N'training_confirmed_at') IS NULL
  ALTER TABLE [sgc].[request] ADD [training_confirmed_at] DATETIME2 NULL;

IF COL_LENGTH(N'sgc.training', N'evaluation_provider') IS NULL
  ALTER TABLE [sgc].[training] ADD [evaluation_provider] NVARCHAR(20) NULL;
IF COL_LENGTH(N'sgc.training', N'max_attempts') IS NULL
  ALTER TABLE [sgc].[training] ADD [max_attempts] INT NOT NULL CONSTRAINT [training_max_attempts_df] DEFAULT 2;

IF COL_LENGTH(N'sgc.training_result', N'attempt_number') IS NULL
  ALTER TABLE [sgc].[training_result] ADD [attempt_number] INT NULL;
IF COL_LENGTH(N'sgc.training_result', N'extra_attempts') IS NULL
  ALTER TABLE [sgc].[training_result] ADD [extra_attempts] INT NOT NULL CONSTRAINT [training_result_extra_attempts_df] DEFAULT 0;
IF COL_LENGTH(N'sgc.training_result', N'retraining_required') IS NULL
  ALTER TABLE [sgc].[training_result] ADD [retraining_required] BIT NOT NULL CONSTRAINT [training_result_retraining_required_df] DEFAULT 0;

IF OBJECT_ID(N'[sgc].[retraining]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[retraining] (
      [id_retraining] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [id_training] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [mode] NVARCHAR(20) NOT NULL,
      [session_date] DATE NOT NULL,
      [result] NVARCHAR(20) NOT NULL,
      [notes] NVARCHAR(1000) NULL,
      [registered_by] NVARCHAR(255) NOT NULL,
      [registered_at] DATETIME2 NOT NULL,
      CONSTRAINT [retraining_pkey] PRIMARY KEY CLUSTERED ([id_retraining]),
      CONSTRAINT [retraining_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [retraining_id_training_fkey] FOREIGN KEY ([id_training]) REFERENCES [sgc].[training]([id_training]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [retraining_id_request_idx] ON [sgc].[retraining]([id_request]);
  CREATE NONCLUSTERED INDEX [retraining_user_email_idx] ON [sgc].[retraining]([user_email]);
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'training_intentos_proveedor_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[training] ADD CONSTRAINT [training_intentos_proveedor_ck] CHECK ([max_attempts] BETWEEN 1 AND 5 AND ([evaluation_provider] IS NULL OR [evaluation_provider] IN (N''microsoft'', N''google'')));';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'retraining_valores_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[retraining] ADD CONSTRAINT [retraining_valores_ck] CHECK ([mode] IN (N''presencial'', N''virtual'') AND [result] IN (N''asistio'', N''aprobo'', N''reprobo''));';

IF OBJECT_ID(N'[sgc].[retraining_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[retraining_solo_insercion]
ON [sgc].[retraining]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51080, N''sgc.retraining es de solo inserción: la recapacitación registrada no se modifica ni se borra.'', 1;
END;';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
