/*
  PASE MANUAL — SGC documental: tipo documental «Plantilla» de One Latam
  Pharma (pedido en la reunión de Calidad del 2026-10-02: se creó una
  «plantilla para procedimiento»). Es un DATO del catálogo de tipos
  documentales (no requiere código): código PLT (PL ya es «Plan»), revisión
  cada 36 meses, alerta 2 meses antes y capacitación obligatoria como los
  demás tipos. *Supuesto a validar con Calidad:* el código PLT entra en el
  código de los documentos de ese tipo (p. ej. OLP-GC-PLT-001) y ya no se
  puede cambiar cuando haya documentos; Calidad puede renombrarlo o
  desactivarlo desde «Configuración → Tipos documentales».

  Se aplicó en KRONOSDB_PRUEBAS el 2026-10-03. En KRONOSDB, solo si Calidad
  lo confirma en el pase. Idempotente. Queda en sgc.audit_log.
  REVERSA: no se borra; se desactiva desde Configuración (con motivo).
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Reason NVARCHAR(1000) = N'Correcciones de Calidad OLP (reunión 2026-10-02): tipo documental «Plantilla» para las plantillas de documentos (p. ej. plantilla para procedimiento).';

BEGIN TRY
  BEGIN TRANSACTION;
  IF EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompany)
     AND NOT EXISTS (SELECT 1 FROM [sgc].[document_type] WHERE id_company = @IdCompany AND (code = N'PLT' OR name = N'Plantilla'))
  BEGIN
    DECLARE @Sort INT = ISNULL((SELECT MAX(sort_order) FROM [sgc].[document_type] WHERE id_company = @IdCompany), 0) + 1;
    INSERT INTO [sgc].[document_type] (id_company, code, name, plural_name, requires_training, review_months, alert_months, sort_order, is_active, created_at, updated_at)
    VALUES (@IdCompany, N'PLT', N'Plantilla', N'Plantillas', 1, 36, 2, @Sort, 1, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, before_json, after_json, detail)
    VALUES (@IdCompany, SYSUTCDATETIME(), @Actor, N'maestro.creado', N'document_type', CAST(SCOPE_IDENTITY() AS NVARCHAR(60)), NULL, N'{"code":"PLT","name":"Plantilla","review_months":36,"alert_months":2,"requires_training":true}', @Reason);
  END;
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT code, name, plural_name, is_active FROM [sgc].[document_type] WHERE id_company = @IdCompany ORDER BY sort_order;
