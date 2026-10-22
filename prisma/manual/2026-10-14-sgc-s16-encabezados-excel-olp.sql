/*
  PASE MANUAL — SGC documental, Sprint 16 (OLP): ENCABEZADO POR TIPO y
  FORMATOS EN EXCEL (decisiones de Nicolás del 2026-10-13 14:44: D17 y D20).

  PRERREQUISITOS: migración 20261014110000_sgc_s16_encabezados_excel y el
  CÓDIGO del S16 desplegados.

  QUÉ HACE (idempotente):
    1. D20: crea la plantilla de encabezado POR DEFECTO «INSTITUCIONAL» (la de
       hoy: mismos rótulos y fila inferior) si la empresa aún no tiene una por
       defecto. Las plantillas de instructivo, formato y procedimiento/manual
       de Calidad se cargan después desde Configuración → Encabezados (con
       motivo) y se asignan a cada tipo; mientras tanto todos usan la por defecto.
    2. D17: el tipo «Formato» (FO) admite el borrador en Word y en Excel
       («docx,xlsx»). Los demás tipos siguen solo con Word (rn-sgc-borrador-solo-word).
    3. Deja cada cambio en sgc.config_change_log y sgc.audit_log.

  CÓMO CORRERLO: scripts/sgc/pase-produccion/aplicar-sql.mjs (verifica
  DB_NAME()). Primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización.
  Para otra empresa: cambiar @IdCompany.

  REVERSA: 2026-10-14-sgc-s16-encabezados-excel-olp-reversa.sql
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 16 (decisiones de Nicolás del 2026-10-13: D20 plantilla de encabezado por defecto y por tipo documental; D17 borradores de formatos en Excel, sin convertirlos a Word).';

IF OBJECT_ID(N'[sgc].[header_template]', N'U') IS NULL
  THROW 51162, N'Falta la migración 20261014110000_sgc_s16_encabezados_excel.', 1;
IF NOT EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompany)
  THROW 51163, N'La empresa no tiene el SGC configurado.', 1;

DECLARE @Now DATETIME2 = SYSUTCDATETIME();
BEGIN TRY
  BEGIN TRANSACTION;
  IF NOT EXISTS (SELECT 1 FROM [sgc].[header_template] WHERE id_company = @IdCompany AND is_default = 1)
     AND NOT EXISTS (SELECT 1 FROM [sgc].[header_template] WHERE id_company = @IdCompany AND code = N'INSTITUCIONAL')
  BEGIN
    DECLARE @Cfg NVARCHAR(MAX) = N'{"titleLabel":"NOMBRE DEL DOCUMENTO","codeLabel":"CÓDIGO","versionLabel":"VERSIÓN","elaboroLabel":"ELABORÓ","revisoLabel":"REVISÓ","aproboLabel":"APROBÓ","emissionLabel":"FECHA DE EMISIÓN","bottomRow":"proceso_tipo","legend":null}';
    INSERT INTO [sgc].[header_template] (id_company, code, name, config_json, is_default, is_active, version, created_by, created_at, updated_by, updated_at)
    VALUES (@IdCompany, N'INSTITUCIONAL', N'Encabezado institucional (por defecto)', @Cfg, 1, 1, 1, @Actor, @Now, @Actor, @Now);
    DECLARE @IdTpl INT = SCOPE_IDENTITY();
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'header_template', CAST(@IdTpl AS NVARCHAR(60)), N'encabezado.plantilla_creada', @Motivo, NULL, CONCAT(N'{"code":"INSTITUCIONAL","isDefault":true,"config":', @Cfg, N'}'));
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'encabezado.plantilla', N'header_template', CAST(@IdTpl AS NVARCHAR(60)), N'{"code":"INSTITUCIONAL","isDefault":true,"version":1}', @Motivo);
  END;

  DECLARE @IdFo INT = (SELECT id_document_type FROM [sgc].[document_type] WHERE id_company = @IdCompany AND code = N'FO');
  IF @IdFo IS NOT NULL AND EXISTS (SELECT 1 FROM [sgc].[document_type] WHERE id_document_type = @IdFo AND ISNULL(draft_extensions, N'docx') <> N'docx,xlsx')
  BEGIN
    DECLARE @Antes NVARCHAR(100) = (SELECT draft_extensions FROM [sgc].[document_type] WHERE id_document_type = @IdFo);
    UPDATE [sgc].[document_type] SET draft_extensions = N'docx,xlsx', updated_at = @Now WHERE id_document_type = @IdFo;
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'document_type', CAST(@IdFo AS NVARCHAR(60)), N'tipo_documental.encabezado_formatos', @Motivo, CONCAT(N'{"draftExtensions":', IIF(@Antes IS NULL, N'null', CONCAT(N'"', @Antes, N'"')), N'}'), N'{"draftExtensions":"docx,xlsx"}');
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'maestro.editado', N'document_type', CAST(@IdFo AS NVARCHAR(60)), CONCAT(N'{"draftExtensions":', IIF(@Antes IS NULL, N'null', CONCAT(N'"', @Antes, N'"')), N'}'), N'{"draftExtensions":"docx,xlsx"}', @Motivo);
  END;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT 'despues' AS momento, t.code, t.name, t.draft_extensions, h.code AS plantilla
FROM [sgc].[document_type] t LEFT JOIN [sgc].[header_template] h ON h.id_header_template = t.id_header_template
WHERE t.id_company = @IdCompany ORDER BY t.sort_order;
SELECT 'plantillas' AS momento, code, name, is_default, is_active, version FROM [sgc].[header_template] WHERE id_company = @IdCompany;
