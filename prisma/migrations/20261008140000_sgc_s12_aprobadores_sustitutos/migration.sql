/*
  Migración: sgc_s12_aprobadores_sustitutos
  SGC documental — Sprint 12 del plan del 2026-10-08 (socialización con
  Calidad OLP del 2026-10-07): APROBADORES AUTORIZADOS y FIRMANTE SUSTITUTO.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca `dbo`):
    - [sgc].[approver_authorization]: lista de aprobadores autorizados por
        persona y proceso (NULL = todos), con vigencia y motivo; la administra
        Aseguramiento de Calidad (decisión D9). NO SE BORRA: se revoca con motivo.
    - [sgc].[signer_substitution]: cada firmante sustituto asignado (cupo
        original y nuevo, titular y sustituto, motivo, periodo de ausencia,
        quién y cuándo). SOLO INSERCIÓN.
    - [sgc].[task_assignee].[on_behalf_of]: el cupo es de un sustituto que firma
        en nombre del titular.
    - [sgc].[signature].[on_behalf_of]: la firma quedó «en sustitución de»
        (entra al registro encadenado SOLO cuando hay sustitución: las firmas
        anteriores conservan su hash).
    - [sgc].[company_config].[approver_list_enforced] (1): con la lista activa,
        y solo cuando la empresa tiene al menos un aprobador autorizado, el
        servidor rechaza a un aprobador que no esté en la lista. Mientras
        Calidad no cargue la lista nada cambia.
  El tipo de autorización SGC-SUSTITUTOS (grupo exclusivo, decisión D8) es un
  DATO: prisma/manual/2026-10-08-sgc-s12-sustitutos-olp.sql.

  ⚠️ ORDEN DEL PASE: después de la del Sprint 11 y antes que el código.
  Idempotente. Cambio controlado del esquema `sgc` (lo declara en la sesión).

  REVERSA: prisma/manual/2026-10-08-sgc-s12-aprobadores-sustitutos-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261008140000_sgc_s12_aprobadores_sustitutos (Sprint 12)';

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'sgc.company_config', N'approver_list_enforced') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [approver_list_enforced] BIT NOT NULL CONSTRAINT [company_config_approver_list_enforced_df] DEFAULT 1;
IF COL_LENGTH(N'sgc.task_assignee', N'on_behalf_of') IS NULL
  ALTER TABLE [sgc].[task_assignee] ADD [on_behalf_of] NVARCHAR(255) NULL;
IF COL_LENGTH(N'sgc.signature', N'on_behalf_of') IS NULL
  ALTER TABLE [sgc].[signature] ADD [on_behalf_of] NVARCHAR(255) NULL;

IF OBJECT_ID(N'[sgc].[approver_authorization]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[approver_authorization] (
      [id_approver_authorization] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [id_process_map] INT NULL,
      [valid_from] DATE NOT NULL,
      [valid_to] DATE NULL,
      [reason] NVARCHAR(1000) NOT NULL,
      [granted_by] NVARCHAR(255) NOT NULL,
      [granted_at] DATETIME2 NOT NULL,
      [revoked_by] NVARCHAR(255) NULL,
      [revoked_at] DATETIME2 NULL,
      [revoke_reason] NVARCHAR(1000) NULL,
      CONSTRAINT [approver_authorization_pkey] PRIMARY KEY CLUSTERED ([id_approver_authorization]),
      CONSTRAINT [approver_authorization_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [approver_authorization_id_process_map_fkey] FOREIGN KEY ([id_process_map]) REFERENCES [sgc].[process_map]([id_process_map]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [approver_authorization_id_company_user_email_idx] ON [sgc].[approver_authorization]([id_company], [user_email]);
END;

IF OBJECT_ID(N'[sgc].[signer_substitution]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[signer_substitution] (
      [id_signer_substitution] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [id_request] INT NOT NULL,
      [id_task] INT NOT NULL,
      [step_key] NVARCHAR(40) NOT NULL,
      [id_task_assignee_original] INT NOT NULL,
      [id_task_assignee_new] INT NOT NULL,
      [original_email] NVARCHAR(255) NOT NULL,
      [substitute_email] NVARCHAR(255) NOT NULL,
      [reason] NVARCHAR(1000) NOT NULL,
      [absence_from] DATE NULL,
      [absence_to] DATE NULL,
      [assigned_by] NVARCHAR(255) NOT NULL,
      [assigned_at] DATETIME2 NOT NULL,
      CONSTRAINT [signer_substitution_pkey] PRIMARY KEY CLUSTERED ([id_signer_substitution]),
      CONSTRAINT [signer_substitution_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [signer_substitution_id_request_idx] ON [sgc].[signer_substitution]([id_request]);
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

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'approver_authorization_valores_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[approver_authorization] ADD CONSTRAINT [approver_authorization_valores_ck] CHECK (([valid_to] IS NULL OR [valid_to] >= [valid_from]) AND LEN([reason]) >= 5 AND (([revoked_at] IS NULL AND [revoked_by] IS NULL) OR ([revoked_at] IS NOT NULL AND [revoked_by] IS NOT NULL AND LEN([revoke_reason]) >= 5)));';

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'signer_substitution_valores_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[signer_substitution] ADD CONSTRAINT [signer_substitution_valores_ck] CHECK ([original_email] <> [substitute_email] AND LEN([reason]) >= 5 AND ([absence_to] IS NULL OR [absence_from] IS NULL OR [absence_to] >= [absence_from]));';

IF OBJECT_ID(N'[sgc].[approver_authorization_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[approver_authorization_sin_borrado]
ON [sgc].[approver_authorization]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51100, N''sgc.approver_authorization no se borra: una autorización de aprobador se revoca con motivo.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[signer_substitution_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[signer_substitution_solo_insercion]
ON [sgc].[signer_substitution]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51101, N''sgc.signer_substitution es de solo inserción: cada sustitución de firmante queda registrada.'', 1;
END;';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
