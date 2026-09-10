/*
  Renombra el módulo del chat: "Asistentes IA" -> "Chat".
  Pedido de Nicolás el 2026-09-09: "ya no es solo IA" (el módulo ahora
  también tiene grupos con personas).

  Toca DOS filas y nada más. Idempotente: re-correrlo no hace nada.
    1. dbo.process.process          -> título de la tarjeta del hub
    2. dbo.subprocess.subprocess    -> renglón del hub y etiqueta del
                                        permiso en /process/administration/users
                                        (solo la del subprocess_url '/process/chat';
                                         los subprocesos por agente no se tocan)

  NO toca: agent, agent_company, subprocess_user_company, company_user,
  ni los subprocesos '/process/chat/<agente>'. Los permisos no se mueven:
  se identifican por id_subprocess, no por nombre.
*/
SET NOCOUNT ON;

DECLARE @Old       NVARCHAR(255) = N'Asistentes IA';
DECLARE @New       NVARCHAR(255) = N'Chat';
DECLARE @ModuleUrl NVARCHAR(255) = N'/process/chat';

SELECT N'1-antes-process' AS paso, p.id_process, p.process, p.process_url
FROM dbo.[process] p
WHERE p.process IN (@Old, @New);

SELECT N'2-antes-subprocess' AS paso, s.id_subprocess, s.subprocess, s.subprocess_url
FROM dbo.[subprocess] s
WHERE s.subprocess_url = @ModuleUrl;

UPDATE dbo.[process]    SET process    = @New WHERE process = @Old;
UPDATE dbo.[subprocess] SET subprocess = @New WHERE subprocess_url = @ModuleUrl AND subprocess = @Old;

SELECT N'3-despues-process' AS paso, p.id_process, p.process, p.process_url
FROM dbo.[process] p
WHERE p.process IN (@Old, @New);

/* Todos los subprocesos que cuelgan del proceso, para ver la tarjeta como
   la va a ver la gente. */
SELECT N'4-despues-tarjeta' AS paso, p.process, s.id_subprocess, s.subprocess, s.subprocess_url
FROM dbo.[subprocess] s
JOIN dbo.[process] p ON p.id_process = s.id_process
WHERE p.process = @New
ORDER BY s.id_subprocess;
