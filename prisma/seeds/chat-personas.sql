/*
  Seed del PILOTO "Personas" del chat (mensajes directos entre personas).
  Idempotente y APPEND-ONLY. SQL Server. NO contiene DROP/ALTER/TRUNCATE.

  Aprobado por Nicolás Rivera el 2026-09-29 (decisiones D2 y D10).

  Requiere que ya esté aplicada la migración 20260929120000_chat_people (o
  prisma/manual/2026-09-29-chat-people.sql).

  Qué hace:
    1. Crea el subproceso '/process/chat/personas' ("Chat · Personas") bajo el
       MISMO proceso que '/process/chat'. Quien lo tenga en una empresa puede
       INICIAR conversaciones con personas de esa empresa que tengan el Chat.
       Quien solo recibe no lo necesita. Se otorga desde Administración →
       Usuarios como cualquier otro módulo.
    2. Crea el agente CENTINELA code='personas' (display 'Mensajes'): llena el
       `id_agent` NOT NULL de los hilos entre personas. Inactivo y sin
       subproceso a propósito: no aparece en ninguna lista, ninguna llave lo
       autentica y nadie puede "hablarle".
    3. Otorga el subproceso a las personas de @Emails, SOLO en las empresas
       donde ya tienen '/process/chat'. Solo inserta lo que falte.

  Ajuste @Emails antes de correr (separados por coma).

  🔒 BLOQUEOS: lleva `SET LOCK_TIMEOUT 5000` para no quedarse esperando si
  alguien tiene tomadas las tablas de permisos. Si falla con el error 1222
  ("Lock request time out period exceeded"), vuelva a correrlo: cada paso
  comprueba antes de insertar, así que el reintento solo completa lo que
  falte. Con XACT_ABORT ON, cualquier error detiene el lote en ese punto.
*/

SET XACT_ABORT ON;
SET LOCK_TIMEOUT 5000;

DECLARE @Emails     NVARCHAR(MAX) = N'nicolas.rivera@gsslatam.com';
DECLARE @SubName    NVARCHAR(255) = N'Chat · Personas';
DECLARE @SubUrl     NVARCHAR(255) = N'/process/chat/personas';
DECLARE @ModuleUrl  NVARCHAR(255) = N'/process/chat';

/* 1) Subproceso del piloto, bajo el proceso del módulo de Chat. */
DECLARE @ProcessId INT = (
  SELECT TOP 1 id_process FROM [dbo].[subprocess] WHERE subprocess_url = @ModuleUrl ORDER BY id_subprocess
);
IF @ProcessId IS NULL
BEGIN
  RAISERROR(N'No existe el subproceso /process/chat: siembre primero el módulo de Chat.', 16, 1);
  RETURN;
END

DECLARE @SubId INT = (
  SELECT TOP 1 id_subprocess FROM [dbo].[subprocess] WHERE subprocess_url = @SubUrl ORDER BY id_subprocess
);
IF @SubId IS NULL
BEGIN
  INSERT INTO [dbo].[subprocess] (subprocess, id_process, subprocess_url)
  VALUES (@SubName, @ProcessId, @SubUrl);
  SET @SubId = SCOPE_IDENTITY();
END

/* 2) Agente centinela (inactivo, sin subproceso). */
IF NOT EXISTS (SELECT 1 FROM [dbo].[agent] WHERE code = N'personas')
BEGIN
  INSERT INTO [dbo].[agent] (code, display_name, handle, avatar_url, description, is_active, sort_order, id_subprocess)
  VALUES (
    N'personas',
    N'Mensajes',
    NULL,
    NULL,
    N'Centinela técnico de los mensajes entre personas. No es un asistente: no se asigna ni responde.',
    0,
    9999,
    NULL
  );
END

/* 3) Otorgar el piloto, solo donde ya tienen el módulo de Chat. */
INSERT INTO [dbo].[subprocess_user_company] (id_subprocess, id_company_user)
SELECT DISTINCT @SubId, cu.id_company_user
FROM [dbo].[company_user] cu
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[subprocess_user_company] chat ON chat.id_company_user = cu.id_company_user
JOIN [dbo].[subprocess] sc ON sc.id_subprocess = chat.id_subprocess AND sc.subprocess_url = @ModuleUrl
WHERE LOWER(LTRIM(RTRIM(u.email))) IN (
    SELECT LOWER(LTRIM(RTRIM(value))) FROM STRING_SPLIT(@Emails, N',')
  )
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[subprocess_user_company] suc
    WHERE suc.id_subprocess = @SubId AND suc.id_company_user = cu.id_company_user
  );

/* Diagnóstico: a quién le quedó otorgado y el centinela. */
SELECT u.email, c.company, s.subprocess, s.subprocess_url
FROM [dbo].[subprocess_user_company] suc
JOIN [dbo].[subprocess] s ON s.id_subprocess = suc.id_subprocess
JOIN [dbo].[company_user] cu ON cu.id_company_user = suc.id_company_user
JOIN [dbo].[user] u ON u.id = cu.id_user
JOIN [dbo].[company] c ON c.id_company = cu.id_company
WHERE s.subprocess_url = @SubUrl
ORDER BY u.email, c.company;

SELECT id_agent, code, display_name, is_active, id_subprocess FROM [dbo].[agent] WHERE code = N'personas';
