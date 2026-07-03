-- Agrega columna id_executor_final a mesa de ayuda ([case]) si no existe.

IF NOT EXISTS (
  SELECT 1
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'case' AND COLUMN_NAME = 'id_executor_final'
)
BEGIN
  ALTER TABLE [case] ADD id_executor_final NVARCHAR(255) NULL;
  PRINT 'Columna id_executor_final creada en [case].';
END
ELSE
BEGIN
  PRINT 'Columna id_executor_final ya existe en [case].';
END
GO
