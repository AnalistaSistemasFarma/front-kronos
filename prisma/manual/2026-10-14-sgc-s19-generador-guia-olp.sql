/*
  PASE MANUAL — SGC documental, Sprint 19 (OLP): el GENERADOR solo para
  documentos SIN CODIFICACIÓN (R34, RN de Calidad OLP del 2026-10-13).

  PRERREQUISITOS: migraciones 20261010100000_sgc_generador_plantillas y
  20261014130000_sgc_s19_generador_sin_codificacion, y el CÓDIGO del S19.

  QUÉ HACE (idempotente):
    1. Marca como «plantilla guía» del Generador el tipo «Plantilla» (PLT) de
       la empresa, SI EXISTE (2026-10-03-sgc-tipo-plantilla-olp.sql). Ningún
       otro tipo se marca: los documentos codificados (PR, IN, FO, MA…) van
       por solicitud. Si no hay PLT, no cambia nada (Calidad marca su tipo
       desde Configuración → Tipos documentales, con motivo).
    2. Deja el cambio en sgc.config_change_log y sgc.audit_log.
  No enciende el Generador (company_config.generator_enabled): eso es
  2026-10-10-sgc-generador-plantillas-pruebas.sql, solo en PRUEBAS.

  ⚠️ DECISIÓN A CONFIRMAR CON CALIDAD: que «Plantilla» (PLT) sea el tipo de
  las plantillas guía. Sin esa confirmación, NO correrlo en KRONOSDB.

  CÓMO CORRERLO: scripts/sgc/pase-produccion/aplicar-sql.mjs. Primero en
  KRONOSDB_PRUEBAS. Para otra empresa: cambiar @IdCompany.
  REVERSA: 2026-10-14-sgc-s19-generador-guia-olp-reversa.sql
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 19 (R34, RN de Calidad OLP del 2026-10-13): el Generador de documentos es solo para documentos sin codificación; el tipo «Plantilla» (PLT) queda como plantilla guía.';

IF COL_LENGTH(N'sgc.document_type', N'generator_guide') IS NULL
  THROW 51191, N'Falta la migración 20261014130000_sgc_s19_generador_sin_codificacion.', 1;

DECLARE @Now DATETIME2 = SYSUTCDATETIME();
DECLARE @IdPlt INT = (SELECT id_document_type FROM [sgc].[document_type] WHERE id_company = @IdCompany AND code = N'PLT');
DECLARE @Marcado BIT = 0;
IF @IdPlt IS NOT NULL
  EXEC sp_executesql N'SELECT @m = generator_guide FROM [sgc].[document_type] WHERE id_document_type = @t', N'@m BIT OUTPUT, @t INT', @m = @Marcado OUTPUT, @t = @IdPlt;

BEGIN TRY
  BEGIN TRANSACTION;
  IF @IdPlt IS NOT NULL AND @Marcado = 0
  BEGIN
    EXEC sp_executesql N'UPDATE [sgc].[document_type] SET generator_guide = 1, updated_at = @n WHERE id_document_type = @t AND generator_guide = 0', N'@n DATETIME2, @t INT', @n = @Now, @t = @IdPlt;
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'document_type', CAST(@IdPlt AS NVARCHAR(60)), N'tipo_documental.generador_guia', @Motivo, N'{"generatorGuide":false}', N'{"generatorGuide":true}');
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'maestro.editado', N'document_type', CAST(@IdPlt AS NVARCHAR(60)), N'{"generatorGuide":false}', N'{"generatorGuide":true}', @Motivo);
  END;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

IF @IdPlt IS NULL SELECT N'La empresa no tiene el tipo PLT: no se marcó ningún tipo.' AS aviso;
EXEC sp_executesql N'SELECT ''despues'' AS momento, code, name, generator_guide FROM [sgc].[document_type] WHERE id_company = @c ORDER BY sort_order', N'@c INT', @c = @IdCompany;
