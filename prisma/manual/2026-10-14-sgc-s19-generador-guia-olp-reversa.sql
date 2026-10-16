/*
  REVERSA de 2026-10-14-sgc-s19-generador-guia-olp.sql: desmarca el tipo
  «Plantilla» (PLT) como plantilla guía del Generador, con su registro de
  cambio. Las plantillas que partían de él quedan «Origen codificado» (no
  generan) hasta que Calidad marque de nuevo un tipo. Los registros ya
  generados no se tocan. Idempotente.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Reversa del Sprint 19 (OLP): el tipo «Plantilla» (PLT) deja de ser plantilla guía del Generador.';

IF COL_LENGTH(N'sgc.document_type', N'generator_guide') IS NULL
BEGIN
  SELECT N'Sin la columna generator_guide: nada que revertir.' AS aviso;
  RETURN;
END;

DECLARE @Now DATETIME2 = SYSUTCDATETIME();
DECLARE @IdPlt INT = (SELECT id_document_type FROM [sgc].[document_type] WHERE id_company = @IdCompany AND code = N'PLT');
DECLARE @Marcado BIT = 0;
IF @IdPlt IS NOT NULL
  EXEC sp_executesql N'SELECT @m = generator_guide FROM [sgc].[document_type] WHERE id_document_type = @t', N'@m BIT OUTPUT, @t INT', @m = @Marcado OUTPUT, @t = @IdPlt;

BEGIN TRY
  BEGIN TRANSACTION;
  IF @Marcado = 1
  BEGIN
    EXEC sp_executesql N'UPDATE [sgc].[document_type] SET generator_guide = 0, updated_at = @n WHERE id_document_type = @t AND generator_guide = 1', N'@n DATETIME2, @t INT', @n = @Now, @t = @IdPlt;
    INSERT INTO [sgc].[config_change_log] (id_company, occurred_at, actor_email, entity, entity_id, action, reason, before_json, after_json)
    VALUES (@IdCompany, @Now, @Actor, N'document_type', CAST(@IdPlt AS NVARCHAR(60)), N'tipo_documental.generador_guia', @Motivo, N'{"generatorGuide":true}', N'{"generatorGuide":false}');
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, @Now, @Actor, N'maestro.editado', N'document_type', CAST(@IdPlt AS NVARCHAR(60)), N'{"generatorGuide":true}', N'{"generatorGuide":false}', @Motivo);
  END;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
