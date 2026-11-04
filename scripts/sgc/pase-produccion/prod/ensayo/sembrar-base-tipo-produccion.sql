/*
  ENSAYO DEL PASE (solo CI, base efímera): completa una base creada con el
  schema.prisma de `main` para que se parezca a KRONOSDB antes del pase:
  - tablas que en producción existen fuera de Prisma (notifications,
    _prisma_migrations; scheduled_job/_run se crean con 04-programador-central.sql);
  - OLP (id_company = 3), Nicolás con company_user en OLP, el proceso «Procesos»
    con los subprocesos 40 y 41 del módulo documental viejo y 1 asignación al 41,
    igual que lo que se midió en KRONOSDB el 2026-10-10.
  Nunca correr en un servidor real.
*/
SET NOCOUNT ON;
IF DB_NAME() <> N'KRONOSDB' OR CAST(SERVERPROPERTY('MachineName') AS NVARCHAR(128)) = N'SERFARMA03'
  THROW 50999, N'La siembra del ensayo solo corre en la base efímera de la CI.', 1;

IF OBJECT_ID(N'dbo.notifications', N'U') IS NULL
  CREATE TABLE dbo.notifications (id INT IDENTITY(1,1) PRIMARY KEY, id_user NVARCHAR(1000) NULL, title NVARCHAR(255) NULL, url NVARCHAR(500) NULL, created_at DATETIME NOT NULL DEFAULT GETDATE());
IF OBJECT_ID(N'dbo._prisma_migrations', N'U') IS NULL
  CREATE TABLE dbo._prisma_migrations (id VARCHAR(36) NOT NULL PRIMARY KEY, checksum VARCHAR(64) NOT NULL, finished_at DATETIMEOFFSET NULL,
    migration_name NVARCHAR(250) NOT NULL, logs NVARCHAR(MAX) NULL, rolled_back_at DATETIMEOFFSET NULL, started_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(), applied_steps_count INT NOT NULL DEFAULT 0);

IF NOT EXISTS (SELECT 1 FROM dbo.company WHERE id_company = 3)
BEGIN
  SET IDENTITY_INSERT dbo.company ON;
  INSERT INTO dbo.company (id_company, company) VALUES (1, N'FARMALOGICA'), (2, N'RYAN'), (3, N'ONELATAMPHARMA'), (8, N'GSS');
  SET IDENTITY_INSERT dbo.company OFF;
END
IF NOT EXISTS (SELECT 1 FROM dbo.[user] WHERE email = N'nicolas.rivera@gsslatam.com')
  INSERT INTO dbo.[user] (id, name, email) VALUES (N'ensayo-nicolas', N'Nicolás Rivera', N'nicolas.rivera@gsslatam.com'),
    (N'ensayo-mc', N'María Camila Ortega', N'subdireccion.reglamentaria@gsslatam.com');
IF NOT EXISTS (SELECT 1 FROM dbo.company_user WHERE id_user = N'ensayo-nicolas')
  INSERT INTO dbo.company_user (id_company, id_user) VALUES (3, N'ensayo-nicolas'), (8, N'ensayo-mc');
IF NOT EXISTS (SELECT 1 FROM dbo.subprocess WHERE id_subprocess IN (40, 41))
BEGIN
  INSERT INTO dbo.process (process) VALUES (N'Procesos');
  DECLARE @p INT = SCOPE_IDENTITY();
  SET IDENTITY_INSERT dbo.subprocess ON;
  INSERT INTO dbo.subprocess (id_subprocess, subprocess, id_process, subprocess_url) VALUES
    (40, N'Gestión Documental', @p, N'/process/document-management'),
    (41, N'Gestión Documental (gestionar)', @p, N'/process/document-management/manage'),
    (95, N'Último subproceso existente', @p, N'/process/ensayo-ultimo');
  SET IDENTITY_INSERT dbo.subprocess OFF;
  INSERT INTO dbo.subprocess_user_company (id_subprocess, id_company_user)
  SELECT 41, id_company_user FROM dbo.company_user WHERE id_user = N'ensayo-nicolas';
END
SELECT (SELECT COUNT(*) FROM dbo.company) AS empresas, (SELECT COUNT(*) FROM dbo.subprocess) AS subprocesos,
  OBJECT_ID(N'dbo.document_version', N'U') AS document_version, OBJECT_ID(N'dbo.notifications', N'U') AS notifications;
