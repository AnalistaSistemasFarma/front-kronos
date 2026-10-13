/*
  REVERSA — SGC documental: apaga en la empresa el ajuste «Aseguramiento de
  Calidad revisa el documento que elaboró» (punto 3 de la excepción de Calidad
  del 2026-10-13). Idempotente: si ya está apagado no escribe nada. No borra
  filas (config_change_log y audit_log son de solo inserción): inserta el
  cambio de vuelta a {"qualitySelfReview":false}.

  Los puntos 1 y 2 (Calidad elabora y revisa su propia solicitud) están en el
  código; revertirlos es revertir el commit.
  CÓMO CORRERLO: script Node con `mssql` (memoria "correr-sql-servidores-front-kronos").
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @IdCompany INT = 3;
DECLARE @Encender BIT = 0;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Reversa de la RN 2026-10-13: se apaga «Calidad revisa el documento que elaboró» (vuelve la segregación estricta para el elaborador). Autorizado por nicolas.rivera@gsslatam.com.';
DECLARE @Accion NVARCHAR(40) = N'empresa.calidad_revisa_lo_que_elabora';

BEGIN TRY
  BEGIN TRANSACTION;
  IF NOT EXISTS (SELECT 1 FROM [sgc].[company_config] WITH (UPDLOCK, HOLDLOCK) WHERE id_company = @IdCompany)
    THROW 51120, N'La empresa no tiene el SGC configurado (sgc.company_config).', 1;
  DECLARE @Now DATETIME2 = SYSUTCDATETIME();
  DECLARE @UltimoJson NVARCHAR(MAX) = (
    SELECT TOP (1) after_json FROM [sgc].[config_change_log]
    WHERE entity = N'company_config' AND entity_id = CAST(@IdCompany AS NVARCHAR(60)) AND id_company = @IdCompany AND action = @Accion
    ORDER BY id_config_change DESC);
  -- El JSON lo escribe la app (JSON.stringify, sin espacios) o este script: basta comparar el texto.
  DECLARE @Antes BIT = IIF(REPLACE(ISNULL(@UltimoJson, N''), N' ', N'') LIKE N'%"qualitySelfReview":true%', 1, 0);
  IF @Antes <> @Encender
  BEGIN
    DECLARE @AntesJson NVARCHAR(100) = CONCAT(N'{"qualitySelfReview":', IIF(@Antes = 1, N'true', N'false'), N'}');
    DECLARE @DespuesJson NVARCHAR(100) = CONCAT(N'{"qualitySelfReview":', IIF(@Encender = 1, N'true', N'false'), N'}');
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'company_config', CAST(@IdCompany AS NVARCHAR(60)), @Accion, @Motivo, @AntesJson, @DespuesJson);
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'configuracion.empresa', N'company_config', CAST(@IdCompany AS NVARCHAR(60)), @AntesJson, @DespuesJson, @Motivo);
  END;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT TOP (1) DB_NAME() AS base, id_company, occurred_at, actor_email, after_json
FROM [sgc].[config_change_log]
WHERE entity = N'company_config' AND entity_id = CAST(@IdCompany AS NVARCHAR(60)) AND id_company = @IdCompany AND action = @Accion
ORDER BY id_config_change DESC;
