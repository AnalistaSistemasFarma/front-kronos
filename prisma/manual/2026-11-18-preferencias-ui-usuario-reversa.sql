SET XACT_ABORT ON;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'KRONOSDB') THROW 51902, N'Base no esperada.', 1;
IF OBJECT_ID(N'dbo.user_ui_preference', N'U') IS NOT NULL DROP TABLE dbo.user_ui_preference;
