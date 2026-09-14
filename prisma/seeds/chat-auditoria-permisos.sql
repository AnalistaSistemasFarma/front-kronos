/*
  Seed de PERMISOS del módulo "Auditoría de agentes" (idempotente, APPEND-ONLY).
  SQL Server (provider sqlserver). NO contiene DROP/ALTER/TRUNCATE.

  Pedido de Nicolás (2026-09-10): "quiero que sea un módulo asignable en
  synerlink solo para administración".

  Qué hace:
    1. Reutiliza (o crea) el Process contenedor 'Procesos'.
    2. Crea el subproceso '/process/chat/auditoria' bajo ese proceso, que ES el
       permiso del módulo: quien lo tenga asignado en cualquier empresa ve la
       pantalla. Se otorga desde Administración → Usuarios como cualquier otro
       módulo — eso es lo que lo hace "asignable" sin construir una pantalla de
       permisos nueva (mismo criterio de lib/chat/access.ts).
    3. Lo otorga al administrador indicado, en las empresas donde ya tenga
       company_user. Solo inserta las filas que falten.

  POR QUÉ NO SE OTORGA A NADIE MÁS. La pantalla muestra el texto de
  conversaciones ajenas de TODA la flota: es información confidencial y datos
  personales (Ley 1581 de 2012). El permiso se entrega uno por uno, a mano, a
  quien de verdad audita.

  OJO: los administradores (rol admin, o el subproceso de Administración →
  Usuarios) entran sin este permiso, por la segunda puerta de
  lib/chat/audit-access.ts. Este subproceso existe para poder dárselo a alguien
  que audita SIN convertirlo en administrador de la plataforma.

  Ajuste @AdminEmail antes de correr.
*/

DECLARE @AdminEmail  NVARCHAR(255) = 'nicolas.rivera@gsslatam.com';
DECLARE @ProcessName NVARCHAR(255) = 'Procesos';
DECLARE @SubName     NVARCHAR(255) = 'Auditoría de agentes';
DECLARE @SubUrl      NVARCHAR(255) = '/process/chat/auditoria';

/* 1) Process contenedor (reusa el primero con ese nombre, o lo crea). */
DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process
);
IF @ProcessId IS NULL
BEGIN
  INSERT INTO [dbo].[process] (process) VALUES (@ProcessName);
  SET @ProcessId = SCOPE_IDENTITY();
END

/* 2) Subproceso-permiso del módulo (idempotente por subprocess_url). */
DECLARE @SubId INT = (
  SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl ORDER BY id_subprocess
);
IF @SubId IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  VALUES (@SubName, @ProcessId, @SubUrl);
  SET @SubId = SCOPE_IDENTITY();
END

/* 3) Otorgarlo al administrador indicado, en sus empresas. */
INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
SELECT @SubId, cu.id_company_user
FROM [dbo].[company_user] cu
JOIN [dbo].[user] u ON u.id = cu.id_user
WHERE LOWER(LTRIM(RTRIM(u.email))) = LOWER(LTRIM(RTRIM(@AdminEmail)))
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[subprocess_user_company] suc
    WHERE suc.id_subprocess = @SubId AND suc.id_company_user = cu.id_company_user
  );

/* Diagnóstico: a quién le quedó otorgado. */
SELECT u.email, c.company, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url = @SubUrl;
