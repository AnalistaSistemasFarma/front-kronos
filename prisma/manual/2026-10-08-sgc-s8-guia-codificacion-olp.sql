/*
  DATO OPCIONAL — SGC documental, Sprint 8: PROPUESTA de guía de codificación
  de One Latam Pharma con herencia del número del procedimiento.

  ⚠️ NO es parte obligatoria del pase. Calidad (María Camila) no ha entregado
  la guía de codificación definitiva (decisión D3 del plan). Esta es la
  recomendación del plan con lo que Calidad explicó el 2026-10-07:
    «compañía + área + número (OLP-GCC-02 = procedimiento); los formatos e
     instructivos heredan el número del procedimiento».
  Lo mismo se configura sin script desde «Configuración → Guía de
  codificación» (solo Aseguramiento de Calidad, con motivo y auditoría).

  QUÉ HACE (idempotente; solo si la empresa aún no tiene herencia):
    1. Herencia: los tipos @TiposHijos (FO, IN) heredan el número del padre con
       el patrón @PatronHijo ({CODIGO_PADRE}-{TIPO}{CONSECUTIVO} → OLP-GCC-02-FO01).
    2. Solo si @AplicarPatronPrincipal = 1: el patrón principal pasa a
       {PREFIJO}-{PROCESO}-{CONSECUTIVO} con 2 dígitos (OLP-GCC-02). Cambiar la
       guía NO recodifica los documentos existentes.
    Cada cambio queda en sgc.audit_log con el motivo.

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS; en
  KRONOSDB solo con autorización del pase y la guía confirmada por Calidad.

  REVERSA: volver a guardar la guía anterior desde Configuración, o la reversa
  del Sprint 8 (prisma/manual/2026-10-08-sgc-s8-encabezado-listado-maestro-reversa.sql).
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @PatronHijo NVARCHAR(200) = N'{CODIGO_PADRE}-{TIPO}{CONSECUTIVO}';
DECLARE @TiposHijos NVARCHAR(200) = N'FO,IN';
DECLARE @DigitosHijo INT = 2;
DECLARE @AplicarPatronPrincipal BIT = 0;
DECLARE @Reason NVARCHAR(1000) = N'Sprint 8 (propuesta del plan, pendiente de confirmar por Calidad): los formatos e instructivos heredan el número de su procedimiento (socialización con Calidad OLP 2026-10-07).';

SELECT 'antes' AS momento, id_company, prefix, pattern, sequence_digits, child_pattern, child_type_codes, child_sequence_digits FROM [sgc].[coding_guide] WHERE id_company = @IdCompany;

BEGIN TRY
  BEGIN TRANSACTION;

  IF EXISTS (SELECT 1 FROM [sgc].[coding_guide] WHERE id_company = @IdCompany AND child_pattern IS NULL)
  BEGIN
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    SELECT @IdCompany, SYSUTCDATETIME(), @Actor, N'guia_codificacion.editada', N'coding_guide', CAST(@IdCompany AS NVARCHAR(60)),
           CONCAT(N'{"pattern":"', pattern, N'","sequenceDigits":', sequence_digits, N',"childPattern":null}'),
           CONCAT(N'{"pattern":"', CASE WHEN @AplicarPatronPrincipal = 1 THEN N'{PREFIJO}-{PROCESO}-{CONSECUTIVO}' ELSE pattern END, N'","childPattern":"', @PatronHijo, N'","childTypeCodes":"', @TiposHijos, N'"}'),
           @Reason
    FROM [sgc].[coding_guide] WHERE id_company = @IdCompany;

    UPDATE [sgc].[coding_guide]
    SET child_pattern = @PatronHijo,
        child_type_codes = @TiposHijos,
        child_sequence_digits = @DigitosHijo,
        pattern = CASE WHEN @AplicarPatronPrincipal = 1 THEN N'{PREFIJO}-{PROCESO}-{CONSECUTIVO}' ELSE pattern END,
        sequence_digits = CASE WHEN @AplicarPatronPrincipal = 1 THEN 2 ELSE sequence_digits END,
        updated_by = @Actor,
        change_reason = @Reason,
        updated_at = SYSUTCDATETIME()
    WHERE id_company = @IdCompany;
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT 'despues' AS momento, id_company, prefix, pattern, sequence_digits, child_pattern, child_type_codes, child_sequence_digits FROM [sgc].[coding_guide] WHERE id_company = @IdCompany;
