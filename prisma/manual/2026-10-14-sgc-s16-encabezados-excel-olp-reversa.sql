/*
  REVERSA (datos) de 2026-10-14-sgc-s16-encabezados-excel-olp.sql: el tipo
  «Formato» vuelve a solo Word y la plantilla «INSTITUCIONAL» deja de ser la
  por defecto y se DESACTIVA (no se borra). Queda en el control de cambios.
  ⚠️ No revierte plantillas que Calidad haya creado o asignado después.
  Idempotente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Reversa del Sprint 16 (datos de la empresa): «Formato» vuelve a solo Word y se desactiva la plantilla INSTITUCIONAL.';
IF OBJECT_ID(N'[sgc].[header_template]', N'U') IS NULL
BEGIN
  PRINT N'Sin la migración del S16 no hay nada que revertir.';
  RETURN;
END;
DECLARE @Now DATETIME2 = SYSUTCDATETIME();
DECLARE @IdFo INT = (SELECT id_document_type FROM [sgc].[document_type] WHERE id_company = @IdCompany AND code = N'FO' AND draft_extensions IS NOT NULL);
IF @IdFo IS NOT NULL
BEGIN
  UPDATE [sgc].[document_type] SET draft_extensions = NULL, updated_at = @Now WHERE id_document_type = @IdFo;
  INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, action, reason, before_json, after_json)
  VALUES (@IdCompany, @Now, @Actor, N'document_type', CAST(@IdFo AS NVARCHAR(60)), N'tipo_documental.encabezado_formatos', @Motivo, N'{"draftExtensions":"docx,xlsx"}', N'{"draftExtensions":null}');
END;
DECLARE @IdTpl INT = (SELECT id_header_template FROM [sgc].[header_template] WHERE id_company = @IdCompany AND code = N'INSTITUCIONAL' AND is_active = 1);
IF @IdTpl IS NOT NULL
BEGIN
  UPDATE [sgc].[document_type] SET id_header_template = NULL, updated_at = @Now WHERE id_header_template = @IdTpl;
  UPDATE [sgc].[header_template] SET is_default = 0, is_active = 0, updated_by = @Actor, updated_at = @Now WHERE id_header_template = @IdTpl;
  INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, action, reason, before_json, after_json)
  VALUES (@IdCompany, @Now, @Actor, N'header_template', CAST(@IdTpl AS NVARCHAR(60)), N'encabezado.plantilla_editada', @Motivo, N'{"isActive":true}', N'{"isActive":false,"isDefault":false}');
END;
SELECT 'despues' AS momento, code, draft_extensions FROM [sgc].[document_type] WHERE id_company = @IdCompany;
