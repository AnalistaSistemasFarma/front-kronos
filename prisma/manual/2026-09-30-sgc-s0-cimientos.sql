/*
  PASE MANUAL — SGC documental, Sprint 0: cimientos (datos).
  Autorizado por Nicolás Rivera el 2026-09-30 (plan del SGC documental de OLP).

  PRERREQUISITO: la migración 20260930110000_sgc_esquema_base (esquema `sgc` y
  tabla sgc.company_config) ya aplicada.

  QUÉ HACE (idempotente, APPEND-ONLY, sin DROP/ALTER/TRUNCATE):
    1. Proceso contenedor del menú: "Sistema de Gestión de Calidad".
    2. Subprocesos-permiso del módulo (los nombres y URLs deben coincidir con
       lib/sgc/constants.ts):
         /process/sgc-documental          SGC documental (entrada del menú, consulta)
         /process/sgc-documental/gestion  gestionar documentos      (marcador)
         /process/sgc-documental/calidad  Aseguramiento de Calidad  (marcador)
         /process/sgc-documental/flujos   administración de flujos  (marcador)
    3. Activa SOLO One Latam Pharma (id_company = 3) en sgc.company_config.
       Las demás empresas se activan después con la skill sgc-activar-empresa.
    4. Otorga los 4 permisos al usuario @AdminEmail ÚNICAMENTE en OLP (si tiene
       company_user en OLP). Nadie más queda con acceso.

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (ver la
  memoria "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS;
  en KRONOSDB solo con autorización del pase. Imprime el estado antes y después.

  REVERSA: prisma/manual/2026-09-30-sgc-s0-cimientos-reversa.sql
*/

SET XACT_ABORT ON;

DECLARE @AdminEmail   NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @IdCompanyOlp INT           = 3;
DECLARE @ProcessName  NVARCHAR(255) = N'Sistema de Gestión de Calidad';

/* Estado ANTES */
SELECT 'antes' AS momento, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s WHERE s.subprocess_url LIKE N'/process/sgc-documental%';
SELECT 'antes' AS momento, id_company, is_active FROM [sgc].[company_config];

BEGIN TRY
  BEGIN TRANSACTION;

  /* 1) Proceso contenedor */
  DECLARE @ProcessId INT = (SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process);
  IF @ProcessId IS NULL
  BEGIN
    INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
    SET @ProcessId = SCOPE_IDENTITY();
  END

  /* 2) Subprocesos (idempotentes por subprocess_url) */
  DECLARE @Subs TABLE (subprocess NVARCHAR(255), url NVARCHAR(255));
  INSERT INTO @Subs (subprocess, url) VALUES
    (N'SGC documental',                                      N'/process/sgc-documental'),
    (N'SGC documental · gestionar documentos',               N'/process/sgc-documental/gestion'),
    (N'SGC documental · Aseguramiento de Calidad',           N'/process/sgc-documental/calidad'),
    (N'SGC documental · administración de flujos validados', N'/process/sgc-documental/flujos');

  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  SELECT x.subprocess, @ProcessId, x.url
  FROM @Subs x
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[subprocess] s WHERE s.subprocess_url = x.url);

  /* 3) Activar OLP en el SGC */
  IF NOT EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompanyOlp)
    INSERT INTO [sgc].[company_config] (id_company, is_active, storage_root, activated_by, activated_at, change_reason, created_at, updated_at)
    VALUES (@IdCompanyOlp, 1, N'SGC/OLP', @AdminEmail, SYSUTCDATETIME(),
            N'Sprint 0: activación inicial de One Latam Pharma (decisión de Nicolás Rivera, 2026-09-30).',
            SYSUTCDATETIME(), SYSUTCDATETIME());

  /* 4) Permisos del administrador SOLO en OLP */
  INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
  SELECT s.id_subprocess, cu.id_company_user
  FROM [dbo].[subprocess] s
  JOIN @Subs x ON x.url = s.subprocess_url
  JOIN [dbo].[company_user] cu ON cu.id_company = @IdCompanyOlp
  JOIN [dbo].[user] u ON u.id = cu.id_user AND u.email = @AdminEmail
  WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[subprocess_user_company] suc
    WHERE suc.id_subprocess = s.id_subprocess AND suc.id_company_user = cu.id_company_user
  );

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Estado DESPUÉS */
SELECT 'despues' AS momento, p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url LIKE N'/process/sgc-documental%' ORDER BY s.subprocess_url;
SELECT 'despues' AS momento, id_company, is_active, storage_root, activated_by FROM [sgc].[company_config];
SELECT 'despues' AS momento, u.email, c.company, s.subprocess_url
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url LIKE N'/process/sgc-documental%'
ORDER BY c.company, s.subprocess_url;
