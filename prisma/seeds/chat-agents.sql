/*
  Seed del módulo "Chat" (chat de agentes y grupos en SynerLink).
  Idempotente y APPEND-ONLY. SQL Server. NO contiene DROP/ALTER/TRUNCATE, y no
  toca ninguna tabla del módulo de Gestión Documental (SGD).

  Qué hace:
    1. Garantiza la empresa GSS **por NOMBRE**. En producción GSS es
       id_company = 8, pero en KRONOSDB_PRUEBAS ni siquiera existe y los ids
       6 y 7 son otras empresas. Sembrar por id dejaría el módulo colgado de
       la empresa equivocada en pruebas: por eso todo aquí se resuelve por
       nombre.
    2. Crea el Process 'Chat' (contenedor propio del módulo, no se
       cuelga de 'Procesos' como Organigrama/Métricas: es un módulo con
       identidad propia en el hub).
    3. Crea los dos subprocesos que SON el permiso:
         /process/chat        -> acceso al módulo
         /process/chat/orus   -> permiso para hablar con Orus
       (ver la decisión de diseño en lib/chat/access.ts: el subproceso es la
       ÚNICA fuente de verdad del permiso; no existe user_agent_access).
       El agente queda amarrado a su subproceso por FK: agent.id_subprocess.
    4. Siembra UN solo agente: code='horus', display_name='Orus',
       handle='@horus_gss_bot', vinculado a GSS como empresa principal.
       Nicolás: "iniciamos con el tuyo orus". No se inventan los demás.
       avatar_url apunta a /agents/orus.jpg, la foto que entregó Nicolás el
       2026-09-07 y que vive versionada en public/agents (nunca una URL
       externa). Si el archivo faltara, la interfaz cae al avatar por inicial.
    5. Otorga los dos subprocesos al administrador en GSS, creando el
       company_user de GSS si no lo tiene (es indispensable para que la
       empresa aparezca en /process/administration/users). Solo inserta lo
       que falte.

  Uso:  node prisma/seeds/run-chat-agents.mjs
*/

DECLARE @AdminEmail   NVARCHAR(255) = 'nicolas.rivera@gsslatam.com';
DECLARE @CompanyName  NVARCHAR(255) = 'GSS';
DECLARE @ProcessName  NVARCHAR(255) = 'Chat';
DECLARE @ModuleUrl    NVARCHAR(255) = '/process/chat';
DECLARE @AgentCode    NVARCHAR(60)  = 'horus';
DECLARE @AgentName    NVARCHAR(120) = 'Orus';
DECLARE @AgentHandle  NVARCHAR(60)  = '@horus_gss_bot';
DECLARE @AgentUrl     NVARCHAR(255) = '/process/chat/orus';
DECLARE @AgentAvatar  NVARCHAR(500) = '/agents/orus.jpg';

/* ------------------------------------------------------------------ */
/* 1) Empresa GSS (por NOMBRE, nunca por id).                          */
/* ------------------------------------------------------------------ */
DECLARE @CompanyId INT = (
  SELECT TOP 1 id_company FROM [dbo].[company] WHERE company = @CompanyName ORDER BY id_company
);
IF @CompanyId IS NULL
BEGIN
  INSERT INTO [dbo].[company] (company) VALUES (@CompanyName);
  SET @CompanyId = SCOPE_IDENTITY();
END

/* ------------------------------------------------------------------ */
/* 2) Process contenedor del módulo.                                   */
/* ------------------------------------------------------------------ */
DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[process] WHERE process = @ProcessName ORDER BY id_process
);
IF @ProcessId IS NULL
BEGIN
  -- process_url queda NULL a propósito: el hub abre process_url en una
  -- pestaña nueva (components/process/ProcessView.tsx) y la página del chat
  -- todavía no existe (llega en la fase de interfaz). Mismo criterio que
  -- 'Asuntos regulatorios' o 'Gestión de Procesos'.
  INSERT INTO [dbo].[process] (process, process_url) VALUES (@ProcessName, NULL);
  SET @ProcessId = SCOPE_IDENTITY();
END

/* ------------------------------------------------------------------ */
/* 3) Subprocesos = el permiso (idempotentes por subprocess_url).      */
/* ------------------------------------------------------------------ */
DECLARE @ModuleSubId INT = (
  SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @ModuleUrl ORDER BY id_subprocess
);
IF @ModuleSubId IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  VALUES (N'Chat', @ProcessId, @ModuleUrl);
  SET @ModuleSubId = SCOPE_IDENTITY();
END

DECLARE @AgentSubId INT = (
  SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @AgentUrl ORDER BY id_subprocess
);
IF @AgentSubId IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  VALUES (N'Asistente Orus', @ProcessId, @AgentUrl);
  SET @AgentSubId = SCOPE_IDENTITY();
END

/* ------------------------------------------------------------------ */
/* 4) Agente Orus + su agrupación por empresa.                         */
/* ------------------------------------------------------------------ */
DECLARE @AgentId INT = (
  SELECT TOP 1 id_agent FROM [dbo].[agent] WHERE code = @AgentCode ORDER BY id_agent
);
IF @AgentId IS NULL
BEGIN
  INSERT INTO [dbo].[agent] (code, display_name, handle, avatar_url, description, is_active, sort_order, id_subprocess)
  VALUES (
    @AgentCode,
    @AgentName,
    @AgentHandle,
    @AgentAvatar,
    N'Asistente de inteligencia artificial de Group Shared Services Latinoamérica.',
    1,
    10,
    @AgentSubId
  );
  SET @AgentId = SCOPE_IDENTITY();
END

/* Si el agente ya existía sin subproceso (p.ej. sembrado antes de crear el
   permiso), se le amarra ahora. Único UPDATE del seed, y solo sobre la
   tabla `agent` de este módulo. */
UPDATE [dbo].[agent]
SET id_subprocess = @AgentSubId
WHERE id_agent = @AgentId AND id_subprocess IS NULL;

/* Igual que el UPDATE de arriba: el agente se sembró antes de que existiera
   la foto, así que se le pone ahora. Solo cuando está en NULL, para no
   pisar un avatar que alguien haya cambiado a mano después. */
UPDATE [dbo].[agent]
SET avatar_url = @AgentAvatar
WHERE id_agent = @AgentId AND avatar_url IS NULL;

IF NOT EXISTS (
  SELECT 1 FROM [dbo].[agent_company] WHERE id_agent = @AgentId AND id_company = @CompanyId
)
BEGIN
  INSERT INTO [dbo].[agent_company] (id_agent, id_company, is_primary)
  VALUES (@AgentId, @CompanyId, 1);
END

/* ------------------------------------------------------------------ */
/* 5) Permisos del administrador en GSS.                               */
/* ------------------------------------------------------------------ */
DECLARE @AdminUserId NVARCHAR(1000) = (
  SELECT TOP 1 id FROM [dbo].[user] WHERE email = @AdminEmail
);

IF @AdminUserId IS NOT NULL
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM [dbo].[company_user] WHERE id_user = @AdminUserId AND id_company = @CompanyId
  )
  BEGIN
    INSERT INTO [dbo].[company_user] (id_company, id_user) VALUES (@CompanyId, @AdminUserId);
  END

  INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
  SELECT s.id_subprocess, cu.id_company_user
  FROM [dbo].[company_user] cu
  CROSS JOIN (SELECT @ModuleSubId AS id_subprocess UNION ALL SELECT @AgentSubId) s
  WHERE cu.id_user = @AdminUserId
    AND cu.id_company = @CompanyId
    AND NOT EXISTS (
      SELECT 1 FROM [dbo].[subprocess_user_company] suc
      WHERE suc.id_subprocess = s.id_subprocess
        AND suc.id_company_user = cu.id_company_user
    );
END

/* ------------------------------------------------------------------ */
/* Diagnóstico.                                                        */
/* ------------------------------------------------------------------ */
SELECT a.id_agent, a.code, a.display_name, a.handle, s.subprocess_url AS permiso, c.company, ac.is_primary
FROM [dbo].[agent] a
JOIN [dbo].[agent_company] ac ON ac.id_agent = a.id_agent
JOIN [dbo].[company] c ON c.id_company = ac.id_company
LEFT JOIN [dbo].[subprocess] s ON s.id_subprocess = a.id_subprocess
WHERE a.code = @AgentCode;

SELECT p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess] s
JOIN [dbo].[process] p ON p.id_process = s.id_process
WHERE s.subprocess_url IN (@ModuleUrl, @AgentUrl)
ORDER BY s.subprocess_url;

SELECT u.email, c.company, s.subprocess_url
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url IN (@ModuleUrl, @AgentUrl)
ORDER BY u.email, s.subprocess_url;
