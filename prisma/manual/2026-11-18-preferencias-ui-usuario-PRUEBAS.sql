/*
  PRUEBAS — Preferencias de interfaz por usuario (colores de compañía en tablas, anchos de columnas).
  2026-11-18. BASE: KRONOSDB_PRUEBAS. Idempotente y aditivo (tabla nueva). Reversa: 2026-11-18-preferencias-ui-usuario-reversa.sql
  Clave/valor por usuario: no toca la tabla [user] ni schema.prisma.
*/
SET XACT_ABORT ON; SET NOCOUNT ON;
IF DB_NAME() <> N'KRONOSDB_PRUEBAS' THROW 51901, N'Base no esperada: solo KRONOSDB_PRUEBAS.', 1;
IF OBJECT_ID(N'dbo.user_ui_preference', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.user_ui_preference (
    id_user     NVARCHAR(255)  NOT NULL,
    pref_key    NVARCHAR(100)  NOT NULL,
    pref_value  NVARCHAR(4000) NOT NULL,
    updated_at  DATETIME2      NOT NULL CONSTRAINT DF_user_ui_preference_updated DEFAULT sysutcdatetime(),
    CONSTRAINT PK_user_ui_preference PRIMARY KEY (id_user, pref_key)
  );
END
SELECT name FROM sys.tables WHERE name = N'user_ui_preference';
