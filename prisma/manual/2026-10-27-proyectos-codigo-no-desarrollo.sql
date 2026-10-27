/*
  PROYECTOS CON CÓDIGO PARA UN AGENTE QUE NO ES DE DESARROLLO — listado y corrección (2026-10-27).
  Regla de Nicolás Rivera (2026-10-27, 16:08 COT): el nivel de código y los repositorios de un
  proyecto solo se asignan a AGENTES DE DESARROLLO (hoy horus y pedro). Caso de origen: el
  proyecto 9 «Comercio Exterior LATAM» (Play) quedó el 2026-10-26 en «lectura» con front-kronos y
  sapsend porque el formulario se lo ofreció.

  AFECTADO = proyecto con nivel distinto de «ninguno» o con repos vinculados, donde AL MENOS UNO de
  sus agentes designados (chat_project_agent) no es de desarrollo. Incluye archivados.
  «De desarrollo» = agent.es_desarrollo = 1; si la columna todavía no existe (producción antes del
  pase), se usa la lista fija horus/pedro.

  CORRECCIÓN: nivel «ninguno», sin autorizadores y sin repos; queda en el registro inmutable
  chat_project_agent_policy_log con el antes, el después y el motivo.

  MODOS (SESSION_CONTEXT N'proyectos_codigo_no_desarrollo_modo'):
    - sin valor  → LISTAR: solo SELECT (no escribe nada). Muestra el antes y el después propuesto.
    - 'ensayo'   → hace la corrección dentro de una transacción y la DESHACE (ROLLBACK).
    - 'aplicar'  → hace la corrección y la confirma. Exige además
                   SESSION_CONTEXT N'proyectos_codigo_no_desarrollo_actor' = correo de quien autoriza.
  Ejemplo:
    EXEC sp_set_session_context N'proyectos_codigo_no_desarrollo_modo', N'aplicar';
    EXEC sp_set_session_context N'proyectos_codigo_no_desarrollo_actor', N'nicolas.rivera@gsslatam.com';

  ⚠️ En producción se corre SOLO en modo LISTAR hasta el «sí» de Nicolás (ventana de las 17:00).
  REVERSA: el registro guarda el antes (before_value) de cada proyecto; se restaura desde la UI
  (Proyecto → Permisos), que ya no lo permite para agentes de negocio, a propósito.

  GUARDA: solo KRONOSDB, KRONOSDB_PRUEBAS o la base efímera de la CI.
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB', N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51733, N'Base no esperada: este script solo corre en KRONOSDB, KRONOSDB_PRUEBAS o kronos_ci.', 1;

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.chat_project_agent_policy', N'U') IS NULL
  THROW 51734, N'Falta la tabla chat_project_agent_policy (permisos de los agentes).', 1;

DECLARE @modo NVARCHAR(20) = LOWER(ISNULL(CAST(SESSION_CONTEXT(N'proyectos_codigo_no_desarrollo_modo') AS NVARCHAR(20)), N'listar'));
DECLARE @actor NVARCHAR(320) = CAST(SESSION_CONTEXT(N'proyectos_codigo_no_desarrollo_actor') AS NVARCHAR(320));
IF @modo NOT IN (N'listar', N'ensayo', N'aplicar')
  THROW 51735, N'Modo desconocido: use listar (sin valor), ensayo o aplicar.', 1;
IF @modo = N'aplicar' AND (@actor IS NULL OR CHARINDEX(N'@', @actor) = 0)
  THROW 51736, N'Para aplicar, indique en proyectos_codigo_no_desarrollo_actor el correo de quien autoriza.', 1;

DECLARE @motivo NVARCHAR(500) = N'Regla de Nicolás Rivera (2026-10-27): el código y los repositorios solo se asignan a agentes de desarrollo. Proyecto con un agente que no es de desarrollo: queda en «ninguno» y sin repositorios.';

/* Agentes de desarrollo: la columna si existe; si no, la lista fija. */
IF OBJECT_ID(N'tempdb..#dev') IS NOT NULL DROP TABLE #dev;
CREATE TABLE #dev (id_agent INT PRIMARY KEY);
IF COL_LENGTH(N'dbo.agent', N'es_desarrollo') IS NOT NULL
  INSERT INTO #dev (id_agent) EXEC sp_executesql N'SELECT id_agent FROM [dbo].[agent] WHERE es_desarrollo = 1;';
ELSE
  INSERT INTO #dev (id_agent) SELECT id_agent FROM [dbo].[agent] WHERE code IN (N'horus', N'pedro');

IF OBJECT_ID(N'tempdb..#afectados') IS NOT NULL DROP TABLE #afectados;
SELECT p.id_project,
       p.name,
       p.archived,
       ISNULL(pol.code_level, N'ninguno') AS code_level,
       pol.deploy_approvers,
       STUFF((SELECT N',' + c.slug
                FROM dbo.chat_project_agent_policy_repo r
                JOIN dbo.chat_project_repo_catalog c ON c.id_repo = r.id_repo
               WHERE r.id_project = p.id_project
               ORDER BY r.id_policy_repo
                 FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 1, N'') AS repos,
       STUFF((SELECT N',' + a.code
                FROM dbo.chat_project_agent pa
                JOIN dbo.agent a ON a.id_agent = pa.id_agent
               WHERE pa.id_project = p.id_project AND NOT EXISTS (SELECT 1 FROM #dev d WHERE d.id_agent = pa.id_agent)
               ORDER BY a.code
                 FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 1, N'') AS agentes_no_desarrollo,
       CAST(NULL AS NVARCHAR(MAX)) AS before_value
  INTO #afectados
  FROM dbo.chat_project p
  LEFT JOIN dbo.chat_project_agent_policy pol ON pol.id_project = p.id_project
 WHERE (ISNULL(pol.code_level, N'ninguno') <> N'ninguno'
        OR EXISTS (SELECT 1 FROM dbo.chat_project_agent_policy_repo r WHERE r.id_project = p.id_project))
   AND EXISTS (SELECT 1 FROM dbo.chat_project_agent pa
                WHERE pa.id_project = p.id_project
                  AND NOT EXISTS (SELECT 1 FROM #dev d WHERE d.id_agent = pa.id_agent));

-- El ANTES con la misma forma que escribe la app (lib/proyectos/permisos-agentes.ts → entradaDeFila).
UPDATE #afectados
   SET before_value = N'{"codeLevel":"' + code_level + N'","repos":['
       + ISNULL(N'"' + REPLACE(NULLIF(repos, N''), N',', N'","') + N'"', N'')
       + N'],"deployApprovers":['
       + ISNULL(N'"' + REPLACE(NULLIF(deploy_approvers, N''), N',', N'","') + N'"', N'')
       + N']}';

DECLARE @despues NVARCHAR(200) = N'{"codeLevel":"ninguno","repos":[],"deployApprovers":[]}';

SELECT DB_NAME() AS base, @modo AS modo, (SELECT COUNT(*) FROM #dev) AS agentes_desarrollo, (SELECT COUNT(*) FROM #afectados) AS proyectos_afectados;
SELECT id_project, name, archived, code_level, repos, agentes_no_desarrollo, before_value AS antes, @despues AS despues
  FROM #afectados ORDER BY id_project;

IF @modo = N'listar' OR NOT EXISTS (SELECT 1 FROM #afectados)
  RETURN;

BEGIN TRAN;

  -- Proyectos afectados SIN fila de política (solo repos sueltos): se les crea la fila en «ninguno».
  INSERT INTO dbo.chat_project_agent_policy (id_project, code_level, deploy_approvers, reason, updated_by, updated_at)
  SELECT a.id_project, N'ninguno', NULL, @motivo, NULL, SYSUTCDATETIME()
    FROM #afectados a
   WHERE NOT EXISTS (SELECT 1 FROM dbo.chat_project_agent_policy pol WHERE pol.id_project = a.id_project);

  UPDATE pol
     SET code_level = N'ninguno', deploy_approvers = NULL, reason = @motivo, updated_by = NULL, updated_at = SYSUTCDATETIME()
    FROM dbo.chat_project_agent_policy pol
    JOIN #afectados a ON a.id_project = pol.id_project;

  DELETE r
    FROM dbo.chat_project_agent_policy_repo r
    JOIN #afectados a ON a.id_project = r.id_project;

  INSERT INTO dbo.chat_project_agent_policy_log (scope, id_project, id_repo, action, before_value, after_value, reason, changed_by, changed_by_email, changed_at)
  SELECT N'proyecto', a.id_project, NULL, N'cambiar', a.before_value, @despues, @motivo, NULL, ISNULL(@actor, N'ensayo'), SYSUTCDATETIME()
    FROM #afectados a;

  SELECT @modo AS modo, a.id_project, pol.code_level AS code_level_despues,
         (SELECT COUNT(*) FROM dbo.chat_project_agent_policy_repo r WHERE r.id_project = a.id_project) AS repos_despues
    FROM #afectados a JOIN dbo.chat_project_agent_policy pol ON pol.id_project = a.id_project
   ORDER BY a.id_project;

IF @modo = N'aplicar'
  COMMIT TRAN;
ELSE
  ROLLBACK TRAN;

SELECT @modo AS modo, CASE WHEN @modo = N'aplicar' THEN N'APLICADO' ELSE N'ENSAYO DESHECHO (ROLLBACK)' END AS resultado;
