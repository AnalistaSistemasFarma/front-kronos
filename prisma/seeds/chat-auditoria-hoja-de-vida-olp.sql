/*
  Seed de la HOJA DE VIDA de los 8 agentes de One Latam Pharma (incremento 1,
  2026-10-20). Idempotente, APPEND-ONLY: solo inserta lo que falte. NO
  contiene DROP/ALTER/TRUNCATE/UPDATE/DELETE.

  Fuente: las actas de Gobierno IA del 2026-10-19 y 2026-10-20
  (~/brain/migrar-agente-synerlink/traspasos/agentes-olp-activacion-20261019/):
    - casos «Solicitud de conectores para agentes IA» (proceso 256 de OLP)
      #6205 Cosmo … #6212 Galileo, aprobados por Andrea Duque el 2026-10-19;
    - plantilla de mínimo privilegio aplicada a cada agente.

  Por CÓDIGO de agente, nunca por id (los ids no coinciden entre KRONOSDB y
  KRONOSDB_PRUEBAS). El DIRECTOR de cada agente queda vacío a propósito: es
  una decisión pendiente de Nicolás.

  En KRONOSDB_PRUEBAS los casos #6205–#6212 no existen: la ficha muestra el
  vínculo con su título guardado y avisa que el caso no está en esa base.
*/

DECLARE @g TABLE (code NVARCHAR(60), plantilla NVARCHAR(120), aplicada DATE, notas NVARCHAR(1000), caso INT);
INSERT INTO @g (code, plantilla, aplicada, notas, caso) VALUES
  (N'galileo',  N'Plantilla A — sin SAP',                    '2026-10-19', N'Solo radica «Solicitud de conectores para agentes IA». Sin comandos, navegador ni mensajería. Cron permitido (Nicolás, 2026-10-19).', 6212),
  (N'sirio',    N'Plantilla A — sin SAP',                    '2026-10-19', N'Sin comandos, navegador ni mensajería; SAP negado. Cron permitido (Nicolás, 2026-10-19).', 6208),
  (N'vega',     N'Plantilla A — sin SAP',                    '2026-10-20', N'Unificada al Gateway de cosmo el 2026-10-20 (antes tenía un perfil aparte del piloto de SharePoint del 2026-09-09).', 6209),
  (N'mercurio', N'Plantilla B — SAP OLP solo consulta',      '2026-10-19', N'Cuatro herramientas de lectura de SAP OLP (sapbo-olp). Sin comandos, navegador ni mensajería.', 6207),
  (N'orion',    N'Plantilla B — SAP OLP solo consulta',      '2026-10-19', N'Cuatro herramientas de lectura de SAP OLP (sapbo-olp). Sin comandos, navegador ni mensajería.', 6206),
  (N'atlas',    N'Plantilla B — SAP OLP solo consulta',      '2026-10-19', N'Cuatro herramientas de lectura de SAP OLP (sapbo-olp). Sin comandos, navegador ni mensajería.', 6211),
  (N'kepler',   N'Plantilla B — SAP OLP solo consulta',      '2026-10-19', N'Cuatro herramientas de lectura de SAP OLP (sapbo-olp). Validar con Neider si sin comandos pierde algo (archivos para Power BI).', 6210),
  (N'cosmo',    N'Ajuste parcial (Claude Code)',             '2026-10-19', N'Se negó usuarios_licencia_activa. Pendiente: limitar el correo de sharepoint-olp al buzón de Andrea (Iván Gutiérrez y Cristian Baldión).', 6205);

INSERT INTO [dbo].[agent_governance] (id_agent, privilege_template, privilege_applied_on, notes, updated_by)
SELECT a.id_agent, g.plantilla, g.aplicada, g.notas, N'seed 2026-10-20 (actas Gobierno IA)'
FROM @g g
INNER JOIN [dbo].[agent] a ON a.code = g.code
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[agent_governance] x WHERE x.id_agent = a.id_agent);

INSERT INTO [dbo].[agent_cv_case] (id_agent, id_request, relation, title_snapshot, linked_by)
SELECT a.id_agent, g.caso, N'gobierno-ia', N'Solicitud de conectores para agentes IA', N'seed 2026-10-20 (actas Gobierno IA)'
FROM @g g
INNER JOIN [dbo].[agent] a ON a.code = g.code
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[agent_cv_case] x WHERE x.id_agent = a.id_agent AND x.id_request = g.caso);

SELECT
  (SELECT COUNT(*) FROM [dbo].[agent_governance]) AS gobierno,
  (SELECT COUNT(*) FROM [dbo].[agent_cv_case]) AS casos;
