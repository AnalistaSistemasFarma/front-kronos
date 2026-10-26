/*
  HOJA DE VIDA COMPLETA (incremento 1, 2026-10-20) — script de PROD.
  Base: KRONOSDB. Se niega a correr en otra base (THROW corta el lote).

  = migración 20261020120000_auditoria_hoja_de_vida_completa (4 tablas nuevas)
  + seed chat-auditoria-hoja-de-vida-olp.sql (gobierno y casos de los 8
    agentes de OLP).
  Ambos textos se copian LITERALES aquí (lo verifica
  lib/agent-audit/__tests__/sql-hoja-de-vida.test.ts): si cambia uno, se
  regenera este archivo.

  SOLO AGREGA. Idempotente. Correr con el script de Node + mssql
  (memoria correr-sql-servidores-front-kronos), con autorización de Nicolás
  y respaldo previo, DENTRO de la ventana del pase.
  Reversa: 2026-10-20-hoja-de-vida-completa-reversa.sql.
*/
IF DB_NAME() <> N'KRONOSDB'
  THROW 50001, N'Este script es solo para KRONOSDB.', 1;

-- ═════ MIGRACIÓN ═════
/*
  Migración: auditoria_hoja_de_vida_completa (hoja de vida, incremento 1 —
  pedido de Nicolás del 2026-10-20: «la hoja de vida no tiene mucha
  información»).

  SOLO AGREGA: cuatro tablas nuevas. No altera ni borra nada existente
  (feedback «agregar nuevo, nunca modificar lo existente»): `agent`,
  `agent_profile`, `agent_inventory` y las demás tablas de F1/F2 quedan igual.

    1. agent_governance        — gobierno DECLARADO del agente: director del
                                 área, plantilla de mínimo privilegio aplicada,
                                 fecha y notas. Lo edita quien tenga el permiso
                                 de configurar.
    2. agent_cv_case           — casos de SynerLink vinculados al agente (el de
                                 Gobierno IA y otros). El estado y las tareas se
                                 leen en vivo de requests_general al abrir la
                                 ficha; aquí solo va el vínculo.
    3. agent_inventory_runtime — lo que el recolector ve del agente en marcha,
                                 por cada inventario: modo de autenticación y
                                 HUELLA de la credencial (12 hex del sha256;
                                 NUNCA el valor), último arranque, última
                                 rotación de sesión, huella de la personalidad
                                 (CLAUDE.md / AGENTS.md…), bloques de gobierno
                                 detectados y si reporta su consumo.
    4. agent_external_finding  — hallazgos de auditorías externas (Gobierno IA,
                                 Iván Gutiérrez). El recolector NO los toca: no
                                 se cierran solos como los automáticos.

  Igual que las migraciones de F1/F2: PK y FK en la misma sentencia, índices
  dentro de EXEC, agente en NO ACTION (un agente no se borra, se desactiva).

  ATENCIÓN: generada MANUALMENTE. En los despliegues no corre `migrate deploy`
  (la base no está baselined, P3005): se aplica a mano antes del pase con
  prisma/manual/2026-10-20-hoja-de-vida-completa-{PRUEBAS,PROD}.sql.
  Reversa: prisma/manual/2026-10-20-hoja-de-vida-completa-reversa.sql.

  Idempotente: se puede re-correr sin efecto.
*/

-- ── 1. Gobierno declarado ───────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_governance')
BEGIN
  CREATE TABLE [dbo].[agent_governance] (
    [id_agent]             INT            NOT NULL,
    [director_name]        NVARCHAR(160)  NULL,
    [director_email]       NVARCHAR(255)  NULL,
    [privilege_template]   NVARCHAR(120)  NULL,
    [privilege_applied_on] DATE           NULL,
    [notes]                NVARCHAR(1000) NULL,
    [updated_by]           NVARCHAR(255)  NULL,
    [updated_at]           DATETIME2      NOT NULL CONSTRAINT [DF_agent_governance_updated_at] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PK_agent_governance] PRIMARY KEY CLUSTERED ([id_agent] ASC),
    CONSTRAINT [FK_agent_governance_agent] FOREIGN KEY ([id_agent])
      REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END

-- ── 2. Casos de SynerLink vinculados ────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_cv_case')
BEGIN
  CREATE TABLE [dbo].[agent_cv_case] (
    [id]             INT IDENTITY(1,1) NOT NULL,
    [id_agent]       INT               NOT NULL,
    [id_request]     INT               NOT NULL,
    [relation]       NVARCHAR(30)      NOT NULL,
    [title_snapshot] NVARCHAR(300)     NULL,
    [linked_by]      NVARCHAR(255)     NULL,
    [linked_at]      DATETIME2         NOT NULL CONSTRAINT [DF_agent_cv_case_linked_at] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PK_agent_cv_case] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_agent_cv_case_agent] FOREIGN KEY ([id_agent])
      REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'agent_cv_case_id_agent_id_request_key')
BEGIN
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [agent_cv_case_id_agent_id_request_key]
    ON [dbo].[agent_cv_case] ([id_agent] ASC, [id_request] ASC)');
END

-- ── 3. Datos de ejecución por inventario ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_inventory_runtime')
BEGIN
  CREATE TABLE [dbo].[agent_inventory_runtime] (
    [id_inventory]         INT            NOT NULL,
    [auth_mode]            NVARCHAR(30)   NULL,
    [auth_detail]          NVARCHAR(120)  NULL,
    [token_fingerprint]    NVARCHAR(16)   NULL,
    [process_started_at]   DATETIME2      NULL,
    [last_rotation_at]     DATETIME2      NULL,
    [last_rotation_status] NVARCHAR(30)   NULL,
    [last_rotation_detail] NVARCHAR(300)  NULL,
    [persona_fingerprint]  NVARCHAR(16)   NULL,
    [persona_files]        NVARCHAR(500)  NULL,
    [governance_json]      NVARCHAR(MAX)  NULL,
    [usage_hook]           BIT            NULL,
    CONSTRAINT [PK_agent_inventory_runtime] PRIMARY KEY CLUSTERED ([id_inventory] ASC),
    CONSTRAINT [FK_agent_inventory_runtime_inventory] FOREIGN KEY ([id_inventory])
      REFERENCES [dbo].[agent_inventory]([id]) ON DELETE CASCADE ON UPDATE NO ACTION
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_inventory_runtime_token')
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_inventory_runtime_token]
    ON [dbo].[agent_inventory_runtime] ([token_fingerprint] ASC)');
END

-- ── 4. Hallazgos de auditorías externas (Gobierno IA) ───────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_external_finding')
BEGIN
  CREATE TABLE [dbo].[agent_external_finding] (
    [id]             INT IDENTITY(1,1) NOT NULL,
    [id_agent]       INT               NOT NULL,
    [source]         NVARCHAR(120)     NOT NULL,
    [ref_code]       NVARCHAR(40)      NOT NULL,
    [severity]       NVARCHAR(20)      NOT NULL,
    [title]          NVARCHAR(300)     NOT NULL,
    [detail]         NVARCHAR(2000)    NULL,
    [recommendation] NVARCHAR(1000)    NULL,
    [status]         NVARCHAR(20)      NOT NULL,
    [reported_on]    DATE              NOT NULL,
    [resolved_on]    DATE              NULL,
    [id_request]     INT               NULL,
    [created_by]     NVARCHAR(255)     NULL,
    [created_at]     DATETIME2         NOT NULL CONSTRAINT [DF_agent_external_finding_created_at] DEFAULT CURRENT_TIMESTAMP,
    [updated_by]     NVARCHAR(255)     NULL,
    [updated_at]     DATETIME2         NULL,
    CONSTRAINT [PK_agent_external_finding] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_agent_external_finding_agent] FOREIGN KEY ([id_agent])
      REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'agent_external_finding_id_agent_source_ref_code_key')
BEGIN
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [agent_external_finding_id_agent_source_ref_code_key]
    ON [dbo].[agent_external_finding] ([id_agent] ASC, [source] ASC, [ref_code] ASC)');
END

-- ═════ SEED ═════
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
