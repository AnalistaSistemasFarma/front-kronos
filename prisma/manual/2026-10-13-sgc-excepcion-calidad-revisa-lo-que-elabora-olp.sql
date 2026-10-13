/*
  PASE MANUAL — SGC documental: EXCEPCIÓN PARA CALIDAD a la segregación de
  funciones (RN de Nicolás Rivera, 2026-10-13, a raíz de la solicitud #1 de OLP).

  CONTEXTO: el código ya permite a Aseguramiento de Calidad (1) elaborar y
  (2) revisar su propia solicitud. El punto (3), «Calidad revisa el documento
  que elaboró», es un AJUSTE POR EMPRESA, APAGADO por defecto. Nicolás lo
  confirmó para One Latam Pharma el 2026-10-13; este script lo ENCIENDE en OLP.

  SIN MIGRACIÓN: el valor vigente del ajuste es la ÚLTIMA fila de
  sgc.config_change_log con action = 'empresa.calidad_revisa_lo_que_elabora'
  (tabla de solo inserción). Encender = insertar una fila con
  {"qualitySelfReview":true}; también queda en sgc.audit_log.
  Calidad lo puede cambiar después en Configuración del SGC (con motivo).

  QUÉ HACE (idempotente): si la empresa tiene el SGC y el ajuste NO está ya en
  el valor pedido, inserta el cambio en config_change_log y en audit_log. Si
  ya está, no escribe nada.

  REVERSA: 2026-10-13-sgc-excepcion-calidad-revisa-lo-que-elabora-reversa.sql
  (inserta el cambio de vuelta a apagado; nada se borra).
  CÓMO CORRERLO: script Node con `mssql` (memoria "correr-sql-servidores-front-kronos").
  Primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @IdCompany INT = 3;
DECLARE @Encender BIT = 1;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'RN 2026-10-13 (solicitud #1 de OLP): Aseguramiento de Calidad puede revisar el documento que elaboró. Autorizado por nicolas.rivera@gsslatam.com. La aprobación no cambia.';
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
