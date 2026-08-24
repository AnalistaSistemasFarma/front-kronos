/*
  Migración: add_user_nit_supplier
  Proyecto "proveedores" (fase 1+2) — tipo de usuario Proveedor + login por NIT.

  Agrega la columna [user].nit: NIT del proveedor externo. Solo lo tienen los
  usuarios con role = 'supplier'. Es el identificador con el que se scopea toda su
  información del lado del servidor. Los usuarios internos lo tienen en NULL.

  Además crea un índice ÚNICO FILTRADO (WHERE nit IS NOT NULL) para garantizar que
  no existan dos proveedores con el mismo NIT, permitiendo a la vez múltiples NULL
  (todos los usuarios internos). SQL Server solo admite un único NULL en un índice
  único normal, por eso el filtro es obligatorio.

  100% ADITIVA: solo ADD COLUMN + CREATE INDEX. Sin DROP/ALTER de columnas
  existentes. Idempotente. NO aplicar a la BD de producción desde aquí; ver el PR
  para el SQL exacto a correr en KRONOSDB_PRUEBAS.
*/

IF COL_LENGTH('dbo.user', 'nit') IS NULL
    ALTER TABLE [dbo].[user] ADD [nit] NVARCHAR(50) NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UX_user_nit' AND object_id = OBJECT_ID('dbo.user')
)
    CREATE UNIQUE INDEX [UX_user_nit]
        ON [dbo].[user] ([nit])
        WHERE [nit] IS NOT NULL;
GO
