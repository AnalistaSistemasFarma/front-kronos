/*
  Migración: sgc_s13_firma_propia_registro
  SGC documental — Sprint 13 del plan del 2026-10-08 (socialización con
  Calidad OLP del 2026-10-07): FIRMA PROPIA con validación de Calidad (R13).
  El «Registro de firmas» (R14) no necesita cambios de base de datos.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca `dbo`):
    - [sgc].[signature_master]: origin (calidad | propia), capture_method
        (dibujada | imagen), validation_status (validada | pendiente),
        validated_by, validated_at. Las firmas ya registradas quedan
        «calidad» y «validada» (siguen firmando igual).
    - Trigger [signature_master_validacion_una_vez]: el origen y el método no
        cambian; solo una firma PENDIENTE pasa a «validada», una vez.
    - [sgc].[company_config].[self_signature_enabled] = 0: la firma propia
        queda APAGADA. Encenderla requiere el aval de la Dra. Adriana Cárdenas
        (memoria firmas-validez-sgc-y-regulatorio); no hay SQL que la encienda.

  ⚠️ ORDEN DEL PASE: después de la del Sprint 12 y antes que el código.
  Idempotente. Cambio controlado del esquema `sgc` (lo declara en la sesión).

  REVERSA: prisma/manual/2026-10-08-sgc-s13-firma-propia-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261008150000_sgc_s13_firma_propia_registro (Sprint 13)';

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'sgc.signature_master', N'origin') IS NULL
  ALTER TABLE [sgc].[signature_master] ADD [origin] NVARCHAR(20) NOT NULL CONSTRAINT [signature_master_origin_df] DEFAULT N'calidad';
IF COL_LENGTH(N'sgc.signature_master', N'capture_method') IS NULL
  ALTER TABLE [sgc].[signature_master] ADD [capture_method] NVARCHAR(20) NULL;
IF COL_LENGTH(N'sgc.signature_master', N'validation_status') IS NULL
  ALTER TABLE [sgc].[signature_master] ADD [validation_status] NVARCHAR(20) NOT NULL CONSTRAINT [signature_master_validation_status_df] DEFAULT N'validada';
IF COL_LENGTH(N'sgc.signature_master', N'validated_by') IS NULL
  ALTER TABLE [sgc].[signature_master] ADD [validated_by] NVARCHAR(255) NULL;
IF COL_LENGTH(N'sgc.signature_master', N'validated_at') IS NULL
  ALTER TABLE [sgc].[signature_master] ADD [validated_at] DATETIME2 NULL;
IF COL_LENGTH(N'sgc.company_config', N'self_signature_enabled') IS NULL
  ALTER TABLE [sgc].[company_config] ADD [self_signature_enabled] BIT NOT NULL CONSTRAINT [company_config_self_signature_enabled_df] DEFAULT 0;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'signature_master_firma_propia_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[signature_master] ADD CONSTRAINT [signature_master_firma_propia_ck] CHECK ([origin] IN (N''calidad'', N''propia'') AND ([capture_method] IS NULL OR [capture_method] IN (N''dibujada'', N''imagen'')) AND [validation_status] IN (N''validada'', N''pendiente'') AND ([validation_status] = N''pendiente'' OR [origin] = N''calidad'' OR ([validated_by] IS NOT NULL AND [validated_at] IS NOT NULL)) AND ([origin] = N''calidad'' OR [validated_by] IS NULL OR [validated_by] <> [user_email]));';

IF OBJECT_ID(N'[sgc].[signature_master_validacion_una_vez]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[signature_master_validacion_una_vez]
ON [sgc].[signature_master]
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  IF UPDATE(origin) OR UPDATE(capture_method)
     OR ((UPDATE(validation_status) OR UPDATE(validated_by) OR UPDATE(validated_at))
         AND EXISTS (SELECT 1 FROM deleted d JOIN inserted i ON i.id_signature_master = d.id_signature_master
                     WHERE d.validation_status <> N''pendiente'' OR i.validation_status <> N''validada''))
    THROW 51110, N''sgc.signature_master: el origen y el método no cambian; solo una firma PENDIENTE se valida, una vez.'', 1;
END;';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
