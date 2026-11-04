-- Automatización de ventas: varios usuarios SAP (UserSign) por empresa, separados por coma.
-- Idempotente: solo cambia el tipo si la columna sigue en INT. Los valores existentes (p. ej. 30) se conservan como texto.
-- Reversa (solo si todos los valores son un único número):
--   ALTER TABLE dbo.sales_automation_config ALTER COLUMN user_sign INT NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.sales_automation_config') AND name = N'user_sign' AND system_type_id = TYPE_ID(N'int'))
  ALTER TABLE dbo.sales_automation_config ALTER COLUMN user_sign NVARCHAR(100) NULL;
GO
