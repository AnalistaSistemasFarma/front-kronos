/*
  Migración: ACCESO CON BIOMÉTRICO (passkeys / WebAuthn), 2026-10-31.
  Pedido de Nicolás Rivera (2026-10-31): entrar con Face ID en iOS y con huella (o rostro, si el
  equipo lo certifica) en Android.

  SOLO ADITIVO e IDEMPOTENTE, se puede aplicar en caliente:
    1. Tabla nueva dbo.user_passkey (llave PÚBLICA por dispositivo; sin datos biométricos).
    2. Amplía el CHECK CK_user_login_audit_provider para aceptar 'passkey' (no toca filas).

  ORDEN: ANTES del código. Sin la tabla, el perfil muestra «no habilitado» y el botón del login
  responde «no disponible»; el login con contraseña sigue igual. Sin el CHECK ampliado, los
  ingresos con biométrico funcionan pero su fila de auditoría falla (se registra en el log).

  BLOQUE-DDL-INICIO (los scripts manuales de PRUEBAS y PROD repiten este bloque tal cual).
*/

SET XACT_ABORT ON;

BEGIN TRY

BEGIN TRAN;

/* ---- dbo.user_passkey: llave pública por dispositivo ------------------- */
IF OBJECT_ID(N'[dbo].[user_passkey]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[user_passkey] (
    [id_passkey]    INT            IDENTITY(1,1) NOT NULL,
    [id_user]       NVARCHAR(1000) NOT NULL,
    [credential_id] NVARCHAR(512)  NOT NULL,
    [public_key]    VARBINARY(MAX) NOT NULL,
    [counter]       BIGINT         NOT NULL CONSTRAINT [user_passkey_counter_df] DEFAULT 0,
    [transports]    NVARCHAR(200)  NULL,
    [device_type]   NVARCHAR(20)   NOT NULL,
    [backed_up]     BIT            NOT NULL CONSTRAINT [user_passkey_backed_up_df] DEFAULT 0,
    [aaguid]        NVARCHAR(36)   NULL,
    [name]          NVARCHAR(100)  NOT NULL,
    [created_at]    DATETIME2      NOT NULL CONSTRAINT [user_passkey_created_at_df] DEFAULT sysutcdatetime(),
    [created_ip]    NVARCHAR(64)   NULL,
    [last_used_at]  DATETIME2      NULL,
    CONSTRAINT [user_passkey_pkey] PRIMARY KEY CLUSTERED ([id_passkey]),
    CONSTRAINT [UQ_user_passkey_credential] UNIQUE NONCLUSTERED ([credential_id]),
    CONSTRAINT [FK_user_passkey_user] FOREIGN KEY ([id_user]) REFERENCES [dbo].[user]([id]) ON DELETE CASCADE ON UPDATE CASCADE
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_user_passkey_usuario' AND object_id = OBJECT_ID(N'[dbo].[user_passkey]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_user_passkey_usuario] ON [dbo].[user_passkey]([id_user]);');

/* ---- La auditoría de inicios de sesión acepta el proveedor «passkey» ---- */
IF OBJECT_ID(N'[dbo].[user_login_audit]', N'U') IS NOT NULL
   AND ISNULL(OBJECT_DEFINITION(OBJECT_ID(N'[dbo].[CK_user_login_audit_provider]')), N'') NOT LIKE N'%passkey%'
BEGIN
  IF OBJECT_ID(N'[dbo].[CK_user_login_audit_provider]', N'C') IS NOT NULL
    EXEC(N'ALTER TABLE [dbo].[user_login_audit] DROP CONSTRAINT [CK_user_login_audit_provider];');
  EXEC(N'ALTER TABLE [dbo].[user_login_audit] ADD CONSTRAINT [CK_user_login_audit_provider] CHECK ([provider] IN (N''credentials'', N''supplier-nit'', N''azure-ad'', N''passkey''));');
END;

COMMIT TRAN;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

/* BLOQUE-DDL-FIN */
