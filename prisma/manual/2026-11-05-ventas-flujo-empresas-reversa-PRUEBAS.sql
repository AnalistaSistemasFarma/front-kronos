-- REVERSA del flujo «Oferta de venta» de Farmalógica (1) y Ryan (2) en KRONOSDB_PRUEBAS (2026-11-05).
-- Se detiene si ya hay solicitudes con el proceso. Cada empresa va en su propio lote.
SET XACT_ABORT ON; SET NOCOUNT ON;
GO
IF DB_NAME() <> N'KRONOSDB_PRUEBAS' THROW 50111, N'ABORTO: no es KRONOSDB_PRUEBAS', 1;
DECLARE @c INT = 1;
DECLARE @proc INT = (SELECT TOP 1 pc.id FROM dbo.process_category pc JOIN dbo.category_request cr ON cr.id = pc.id_category_request
                     JOIN dbo.company_category_request ccr ON ccr.id_category_request = cr.id
                     WHERE ccr.id_company = @c AND cr.category = N'Ventas' AND pc.process = N'Oferta de venta');
IF @proc IS NULL BEGIN SELECT N'Nada que revertir' AS resultado, @c AS empresa; RETURN; END
IF EXISTS (SELECT 1 FROM dbo.process_category_request_general WHERE id_process_category = @proc)
  THROW 50112, N'Hay solicitudes con el proceso «Oferta de venta»: no se revierte.', 1;
BEGIN TRAN;
DELETE FROM dbo.task_condition_option WHERE id_task IN (SELECT id FROM dbo.task_process_category WHERE id_process_category = @proc);
DELETE FROM dbo.task_sap_action WHERE id_task IN (SELECT id FROM dbo.task_process_category WHERE id_process_category = @proc);
DELETE FROM dbo.user_task_request_general WHERE id_task IN (SELECT id FROM dbo.task_process_category WHERE id_process_category = @proc);
DELETE FROM dbo.task_process_category WHERE id_process_category = @proc;
DELETE FROM dbo.process_form_field_option WHERE id_form_field IN (SELECT id FROM dbo.process_form_field WHERE id_process_category = @proc);
DELETE FROM dbo.process_form_field WHERE id_process_category = @proc;
DELETE FROM dbo.user_process_category_request_general WHERE id_process_category = @proc;
UPDATE dbo.sales_company_config SET id_process_category_oferta = NULL WHERE id_company = @c AND id_process_category_oferta = @proc;
DELETE FROM dbo.process_category WHERE id = @proc;
DELETE suc FROM dbo.subprocess_user_company suc JOIN dbo.subprocess s ON s.id_subprocess = suc.id_subprocess
 JOIN dbo.company_user cu ON cu.id_company_user = suc.id_company_user
 WHERE cu.id_company = @c AND s.subprocess_url IN (N'/process/sales', N'/process/sales/manage');
COMMIT;
SELECT N'Revertido' AS resultado, @c AS empresa, @proc AS id_proceso;
DELETE FROM dbo.sales_company_config WHERE id_company = @c AND id_process_category_oferta IS NULL;
GO
IF DB_NAME() <> N'KRONOSDB_PRUEBAS' THROW 50111, N'ABORTO: no es KRONOSDB_PRUEBAS', 1;
DECLARE @c INT = 2;
DECLARE @proc INT = (SELECT TOP 1 pc.id FROM dbo.process_category pc JOIN dbo.category_request cr ON cr.id = pc.id_category_request
                     JOIN dbo.company_category_request ccr ON ccr.id_category_request = cr.id
                     WHERE ccr.id_company = @c AND cr.category = N'Ventas' AND pc.process = N'Oferta de venta');
IF @proc IS NULL BEGIN SELECT N'Nada que revertir' AS resultado, @c AS empresa; RETURN; END
IF EXISTS (SELECT 1 FROM dbo.process_category_request_general WHERE id_process_category = @proc)
  THROW 50112, N'Hay solicitudes con el proceso «Oferta de venta»: no se revierte.', 1;
BEGIN TRAN;
DELETE FROM dbo.task_condition_option WHERE id_task IN (SELECT id FROM dbo.task_process_category WHERE id_process_category = @proc);
DELETE FROM dbo.task_sap_action WHERE id_task IN (SELECT id FROM dbo.task_process_category WHERE id_process_category = @proc);
DELETE FROM dbo.user_task_request_general WHERE id_task IN (SELECT id FROM dbo.task_process_category WHERE id_process_category = @proc);
DELETE FROM dbo.task_process_category WHERE id_process_category = @proc;
DELETE FROM dbo.process_form_field_option WHERE id_form_field IN (SELECT id FROM dbo.process_form_field WHERE id_process_category = @proc);
DELETE FROM dbo.process_form_field WHERE id_process_category = @proc;
DELETE FROM dbo.user_process_category_request_general WHERE id_process_category = @proc;
UPDATE dbo.sales_company_config SET id_process_category_oferta = NULL WHERE id_company = @c AND id_process_category_oferta = @proc;
DELETE FROM dbo.process_category WHERE id = @proc;
DELETE suc FROM dbo.subprocess_user_company suc JOIN dbo.subprocess s ON s.id_subprocess = suc.id_subprocess
 JOIN dbo.company_user cu ON cu.id_company_user = suc.id_company_user
 WHERE cu.id_company = @c AND s.subprocess_url IN (N'/process/sales', N'/process/sales/manage');
COMMIT;
SELECT N'Revertido' AS resultado, @c AS empresa, @proc AS id_proceso;
DELETE FROM dbo.sales_company_config WHERE id_company = @c AND id_process_category_oferta IS NULL;
GO
