/*
  Fix pedido por Nicolás (2026-09-02): "Generador de Documentos"
  (/process/document-management/generador, Sprint 7) quedó sembrado como una
  SUBRUTA que reusaba el permiso GENERAL de Gestión Documental -- cualquiera
  con lectura, escritura o el atajo regulatorio del módulo documental
  (subprocess_url '/process/document-management', '/process/document-management/manage'
  o '/process/document-management/manage/regulatory') lo veía. Nicolás lo
  quiere INDEPENDIENTE de verdad, "así como el de gestionar documentos, o
  usuarios": su propio subproceso, asignable por su cuenta desde el admin de
  usuarios (subprocess_user_company) sin tener que dar también el permiso de
  Gestión Documental.

  Este script crea el subproceso nuevo '/process/document-management/generador'
  bajo el MISMO process contenedor 'Procesos' que usa
  prisma/seeds/document-management-permisos.sql, y -- para no dejar a nadie
  sin acceso en el momento del despliegue -- se lo asigna a TODAS las filas
  (empresa, usuario) que hoy tengan CUALQUIERA de los tres subprocesos de
  Gestión Documental (unión, sin duplicados): son exactamente las personas
  que hoy pueden entrar al Generador porque ese acceso implica canRead=true
  en getDocumentManagementAccess (ver lib/document-management/access.ts,
  antes de este fix). Nicolás puede reasignar el permiso nuevo después,
  persona por persona, desde el admin de usuarios existente -- no hace falta
  UI nueva, /api/subprocesses ya lista cualquier subprocess nuevo.

  Mismo patrón que prisma/seeds/document-management-regulatory-subprocess.sql
  (Sprint 5, mismo tipo de fix: separar un permiso que antes vivía dentro de
  otro). Idempotente, APPEND-ONLY (sin DROP/ALTER/TRUNCATE). SQL Server
  (provider sqlserver).
*/

DECLARE @ProcessName NVARCHAR(255) = 'Procesos';
DECLARE @SubNameGenerador NVARCHAR(255) = 'Generador de Documentos';
DECLARE @SubUrlGenerador NVARCHAR(255) = '/process/document-management/generador';

/* 1) Process contenedor (reusa el mismo que document-management-permisos.sql). */
DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process
);
IF @ProcessId IS NULL
BEGIN
  INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
  SET @ProcessId = SCOPE_IDENTITY();
END

/* 2) Subproceso nuevo (idempotente por subprocess_url). */
DECLARE @SubIdGenerador INT = (
  SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrlGenerador ORDER BY id_subprocess
);
IF @SubIdGenerador IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  VALUES (@SubNameGenerador, @ProcessId, @SubUrlGenerador);
  SET @SubIdGenerador = SCOPE_IDENTITY();
END

/* 3) Otorgar el permiso nuevo a quien HOY tiene cualquiera de los tres
      subprocesos de Gestión Documental -- transición sin pérdida de acceso.
      Solo inserta las filas (id_company_user) que falten. */
INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
SELECT DISTINCT @SubIdGenerador, suc.id_company_user
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
WHERE s.subprocess_url IN (
    '/process/document-management',
    '/process/document-management/manage',
    '/process/document-management/manage/regulatory'
  )
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[subprocess_user_company] suc2
    WHERE suc2.id_subprocess = @SubIdGenerador AND suc2.id_company_user = suc.id_company_user
  );

/* Diagnóstico: quién quedó con acceso al Generador de Documentos. */
SELECT u.email, c.company, s.subprocess_url
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url = @SubUrlGenerador
ORDER BY c.company, u.email;
