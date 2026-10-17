/*
  Migración: AUDITORÍA DE INICIOS DE SESIÓN — ADITIVA. 2026-10-16.

  Pedido de Nicolás Rivera (2026-10-16): «un módulo para los administradores, desde Usuarios,
  donde podamos ver los logins que van haciendo los usuarios, de qué IP y país, por auditoría
  de seguridad».

  Crea 1 tabla NUEVA en dbo (no toca ninguna tabla existente):
    user_login_audit   una fila por intento de inicio de sesión (exitoso o fallido) por
                       correo/contraseña, NIT de proveedor o Microsoft (Entra ID): quién se
                       intentó, cuándo, resultado y motivo, IP (sin el puerto de IIS/ARR),
                       país/región/ciudad (geolocalización LOCAL), navegador/SO/dispositivo y
                       empresas del usuario. Índices por fecha, por identificador y por usuario.

  Privacidad: NO guarda contraseñas, PIN ni tokens.

  Generada MANUALMENTE (producción no está baselined: P3005). Se corre A MANO con respaldo
  COPY_ONLY. Para el pase use los scripts por ambiente, que además crean el subproceso-permiso:
      prisma/manual/2026-10-16-login-audit-PRUEBAS.sql   (KRONOSDB_PRUEBAS)
      prisma/manual/2026-10-16-login-audit-PROD.sql      (KRONOSDB)
  IDEMPOTENTE (también corre sobre el esquema que deja `prisma db push` en la CI).
  REVERSA: prisma/manual/2026-10-16-login-audit-reversa.sql
*/

SET XACT_ABORT ON;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51450, N'Base no esperada: esta migración solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.user_login_audit', N'U') IS NULL
  BEGIN
    CREATE TABLE [dbo].[user_login_audit] (
      [id]             INT IDENTITY(1,1) NOT NULL,
      [attempted_at]   DATETIME2      NOT NULL CONSTRAINT [user_login_audit_attempted_at_df] DEFAULT sysutcdatetime(),
      [provider]       NVARCHAR(20)   NOT NULL,
      [identifier]     NVARCHAR(320)  NULL,
      [id_user]        NVARCHAR(50)   NULL,
      [user_name]      NVARCHAR(255)  NULL,
      [success]        BIT            NOT NULL,
      [failure_reason] NVARCHAR(40)   NULL,
      [client_ip]      NVARCHAR(64)   NULL,
      [ip_scope]       NVARCHAR(12)   NOT NULL,
      [country_code]   NVARCHAR(2)    NULL,
      [country_name]   NVARCHAR(100)  NULL,
      [region]         NVARCHAR(120)  NULL,
      [city]           NVARCHAR(120)  NULL,
      [user_agent]     NVARCHAR(400)  NULL,
      [browser]        NVARCHAR(60)   NULL,
      [os]             NVARCHAR(60)   NULL,
      [device]         NVARCHAR(20)   NULL,
      [companies]      NVARCHAR(400)  NULL,
      CONSTRAINT [user_login_audit_pkey] PRIMARY KEY CLUSTERED ([id])
    );
  END

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_user_login_audit_fecha' AND object_id = OBJECT_ID(N'dbo.user_login_audit'))
    CREATE NONCLUSTERED INDEX [IX_user_login_audit_fecha] ON [dbo].[user_login_audit]([attempted_at] DESC);
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_user_login_audit_identificador' AND object_id = OBJECT_ID(N'dbo.user_login_audit'))
    CREATE NONCLUSTERED INDEX [IX_user_login_audit_identificador] ON [dbo].[user_login_audit]([identifier], [attempted_at]);
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_user_login_audit_usuario' AND object_id = OBJECT_ID(N'dbo.user_login_audit'))
    CREATE NONCLUSTERED INDEX [IX_user_login_audit_usuario] ON [dbo].[user_login_audit]([id_user], [attempted_at]);

  /* Restricciones CHECK (db push no las crea: se agregan aquí también sobre su esquema). */
  IF OBJECT_ID(N'dbo.CK_user_login_audit_provider', N'C') IS NULL
    EXEC (N'ALTER TABLE [dbo].[user_login_audit] ADD CONSTRAINT [CK_user_login_audit_provider] CHECK ([provider] IN (N''credentials'', N''supplier-nit'', N''azure-ad''))');
  IF OBJECT_ID(N'dbo.CK_user_login_audit_ip_scope', N'C') IS NULL
    EXEC (N'ALTER TABLE [dbo].[user_login_audit] ADD CONSTRAINT [CK_user_login_audit_ip_scope] CHECK ([ip_scope] IN (N''PUBLICA'', N''INTERNA'', N''DESCONOCIDA''))');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
