/*
  PASE MANUAL — SGC documental, Sprint 13: ENCENDER la FIRMA PROPIA de One
  Latam Pharma (R13, decisión D10).

  ⛔ NO CORRER sin el AVAL ESCRITO de la Dra. Adriana Cárdenas sobre el método
  (memoria firmas-validez-sgc-y-regulatorio). Sin ese aval la firma propia
  queda APAGADA (así la deja la migración) y Calidad sigue registrando la
  firma en la inducción.

  PRERREQUISITO: migración 20261008150000_sgc_s13_firma_propia_registro.

  QUÉ HACE (idempotente): pone sgc.company_config.self_signature_enabled = 1
  y deja en sgc.config_change_log la referencia del aval (@AvalAdriana:
  correo, acta o radicado). Si @AvalAdriana queda vacío, NO hace nada (THROW).
  Con la firma propia encendida: cada persona registra la suya en «Mi firma»,
  queda pendiente, Calidad la valida o la rechaza, y Calidad ya no registra
  firmas de otros.

  APAGAR: el mismo script con @Encender = 0 (también pide el motivo en @AvalAdriana).
  CÓMO CORRERLO: script Node con `mssql` (memoria "correr-sql-servidores-front-kronos").
  Primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Encender BIT = 1;
DECLARE @AvalAdriana NVARCHAR(1000) = NULL; -- p. ej. N'Correo de Adriana Cárdenas del AAAA-MM-DD: aprueba el método de firma propia'

IF @AvalAdriana IS NULL OR LEN(LTRIM(RTRIM(@AvalAdriana))) < 10
  THROW 51112, N'Falta la referencia del aval de la Dra. Adriana Cárdenas (@AvalAdriana): la firma propia no se enciende sin él.', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  DECLARE @Antes BIT = (SELECT self_signature_enabled FROM [sgc].[company_config] WHERE id_company = @IdCompany);
  IF @Antes IS NULL THROW 51113, N'La empresa no está activa en el SGC.', 1;
  IF @Antes <> @Encender
  BEGIN
    UPDATE [sgc].[company_config] SET self_signature_enabled = @Encender WHERE id_company = @IdCompany;
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'company_config', CAST(@IdCompany AS NVARCHAR(60)), N'empresa.firma_propia', @AvalAdriana,
            CONCAT(N'{"selfSignatureEnabled":', IIF(@Antes = 1, N'true', N'false'), N'}'), CONCAT(N'{"selfSignatureEnabled":', IIF(@Encender = 1, N'true', N'false'), N'}'));
  END;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT id_company, self_signature_enabled FROM [sgc].[company_config] WHERE id_company = @IdCompany;
