/*
  Seed del PERMISO APARTE para ver el TEXTO de las conversaciones en la
  Auditoría de agentes (idempotente, APPEND-ONLY). SQL Server.
  NO contiene DROP/ALTER/TRUNCATE.

  Decisión de Nicolás (2026-10-02): la vista general de Auditoría deja de
  mostrar el texto de las conversaciones; muestra solo agentes y métricas
  (persona, fecha, IP, consumo). El texto queda detrás de este subproceso.

  Qué hace:
    1. Toma el MISMO proceso del subproceso '/process/chat/auditoria' (el
       módulo de Auditoría de agentes) para que aparezcan juntos en
       Administración → Usuarios.
    2. Crea el subproceso '/process/chat/auditoria/conversaciones'. Es solo un
       permiso (marcador): no es una página y no se lista en el hub
       (lib/request-general/dashboardRoutes.ts).
    3. Lo otorga al administrador indicado, en las empresas donde ya tenga
       company_user. Solo inserta las filas que falten.

  SIN SEGUNDA PUERTA: a diferencia del módulo, ser administrador NO alcanza
  para leer el texto. Es información confidencial y datos personales (Ley 1581
  de 2012); se otorga uno por uno, a mano, a quien de verdad audita.

  Ajuste @AdminEmail antes de correr. Requiere que exista el subproceso del
  módulo (prisma/seeds/chat-auditoria-permisos.sql).
*/

DECLARE @AdminEmail NVARCHAR(255) = 'nicolas.rivera@gsslatam.com';
DECLARE @SubName    NVARCHAR(255) = 'Auditoría de agentes · Conversaciones';
DECLARE @SubUrl     NVARCHAR(255) = '/process/chat/auditoria/conversaciones';
DECLARE @ModuloUrl  NVARCHAR(255) = '/process/chat/auditoria';

/* 1) Proceso del módulo de auditoría. */
DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[subprocess] WHERE subprocess_url = @ModuloUrl ORDER BY id_subprocess
);
IF @ProcessId IS NULL
BEGIN
  RAISERROR('No existe el subproceso %s: corra primero chat-auditoria-permisos.sql.', 16, 1, @ModuloUrl);
  RETURN;
END

/* 2) Subproceso-permiso (idempotente por subprocess_url). */
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

/* Diagnóstico: id creado y a quién le quedó otorgado. */
SELECT s.id_subprocess, s.subprocess, s.id_process, s.subprocess_url
FROM [dbo].[subprocess] s WHERE s.subprocess_url = @SubUrl;

SELECT u.email, c.company, s.id_subprocess
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url = @SubUrl;
