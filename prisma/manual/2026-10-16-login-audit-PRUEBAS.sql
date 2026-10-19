/*
  PASE MANUAL (PRUEBAS) — Auditoría de inicios de sesión. 2026-10-16.
  BASE: KRONOSDB_PRUEBAS (el script se detiene en cualquier otra base).

  QUÉ HACE (idempotente; solo crea e inserta, no borra ni modifica nada existente):
    1. Tabla dbo.user_login_audit con sus índices y CHECK (igual a
       prisma/migrations/20261016200000_user_login_audit/migration.sql).
    2. Subproceso-permiso (marcador, no es una página ni sale en el hub; igual a
       lib/auth/login-audit/constants.ts):
         /process/administration/users/inicios-sesion   «Usuarios · Inicios de sesión»
       en el MISMO proceso que Administración → Usuarios (/process/administration/users).
    3. Lo otorga SOLO a @AdminEmail en las empresas donde ya tiene company_user.
       Quien tenga rol admin / super_user ve la pestaña aunque no tenga el marcador;
       a los demás administradores de Usuarios se les asigna desde Administración → Usuarios.

  ANTES: respaldo COPY_ONLY de la base. CÓMO CORRERLO: script Node con `mssql`
  (memoria «correr-sql-servidores-front-kronos») o SSMS. Primero aquí, en PRUEBAS.
  REVERSA: prisma/manual/2026-10-16-login-audit-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51452, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

DECLARE @AdminEmail NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @UsersUrl   NVARCHAR(255) = N'/process/administration/users';
DECLARE @SubUrl     NVARCHAR(255) = N'/process/administration/users/inicios-sesion';
DECLARE @SubName    NVARCHAR(255) = N'Usuarios · Inicios de sesión';

DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[subprocess]
  WHERE LOWER(LTRIM(RTRIM(subprocess_url))) = @UsersUrl ORDER BY id_subprocess
);
IF @ProcessId IS NULL
  THROW 51453, N'No existe el subproceso /process/administration/users: revise la base antes de seguir.', 1;

SELECT DB_NAME() AS base, 'antes' AS momento,
       OBJECT_ID(N'dbo.user_login_audit', N'U') AS tabla_id,
       (SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl) AS id_subproceso_marcador;

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

  DECLARE @SubId INT = (SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl ORDER BY id_subprocess);
  IF @SubId IS NULL
  BEGIN
    INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url) VALUES (@SubName, @ProcessId, @SubUrl);
    SET @SubId = SCOPE_IDENTITY();
  END

  INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
  SELECT @SubId, cu.id_company_user
  FROM [dbo].[company_user] cu
  JOIN [dbo].[user] u ON u.id = cu.id_user
  WHERE LOWER(LTRIM(RTRIM(u.email))) = LOWER(LTRIM(RTRIM(@AdminEmail)))
    AND NOT EXISTS (
      SELECT 1 FROM [dbo].[subprocess_user_company] suc
      WHERE suc.id_subprocess = @SubId AND suc.id_company_user = cu.id_company_user
    );

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Diagnóstico */
SELECT DB_NAME() AS base, 'despues' AS momento, t.name AS tabla,
       (SELECT COUNT(*) FROM sys.indexes i WHERE i.object_id = t.object_id AND i.name LIKE N'IX_user_login_audit_%') AS indices
FROM sys.tables t WHERE t.object_id = OBJECT_ID(N'dbo.user_login_audit');

SELECT s.id_subprocess, s.subprocess, s.id_process, s.subprocess_url,
       (SELECT COUNT(*) FROM [dbo].[subprocess_user_company] suc WHERE suc.id_subprocess = s.id_subprocess) AS permisos_otorgados
FROM [dbo].[subprocess] s WHERE s.subprocess_url = @SubUrl;
