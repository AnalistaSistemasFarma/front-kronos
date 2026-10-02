/*
  Migración: auditoria_inventario_agentes (F1 — inventario de solo lectura)

  Pedido de Nicolás (2026-10-01) y decisiones del 2026-10-02: por cada agente
  ya registrado en SynerLink (tabla `agent`), qué MCP tiene (con su empresa y
  si lee o escribe), qué herramientas, skills y canales, cuándo se escaneó y
  qué riesgos salen de eso. Lo llena un recolector central que corre por SSH
  desde la Mac de horus, cada noche y a pedido ("Re-escanear").

  SOLO AGREGA: cuatro tablas nuevas. No altera ninguna tabla existente.

    1. agent_scan_request   — solicitudes de escaneo (botón o corrida nocturna).
    2. agent_inventory      — foto del inventario de un agente en una corrida.
    3. agent_inventory_mcp  — los MCP de esa foto (empresa, lectura/escritura,
                              si exigen autenticación).
    4. agent_audit_finding  — hallazgos de riesgo calculados automáticamente.

  NUNCA SE GUARDAN SECRETOS: ni tokens, ni contraseñas, ni valores de variables
  de entorno. Ver lib/agent-audit/inventory.ts.

  Igual que 20260910120000_auditoria_agentes: las tablas se crean con su PK y
  sus llaves foráneas en la misma sentencia, y los índices van dentro de EXEC
  (SQL Server compila el lote completo antes de ejecutarlo). El agente va en
  NO ACTION: un agente no se borra, se desactiva.

  ATENCIÓN: generada MANUALMENTE (sin shadow database — P3014). En los
  despliegues no corre `migrate deploy` (la base no está baselined, P3005):
  se aplica a mano antes del pase, con el script de Node + mssql.

  Idempotente: se puede re-correr sin efecto.
*/

-- ── 1. Solicitudes de escaneo ───────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_scan_request')
BEGIN
  CREATE TABLE [dbo].[agent_scan_request] (
    [id]             INT IDENTITY(1,1) NOT NULL,
    [origin]         NVARCHAR(20)      NOT NULL,
    [status]         NVARCHAR(20)      NOT NULL,
    [requested_by]   NVARCHAR(255)     NULL,
    [requested_at]   DATETIME2         NOT NULL CONSTRAINT [DF_agent_scan_request_requested_at] DEFAULT CURRENT_TIMESTAMP,
    [started_at]     DATETIME2         NULL,
    [finished_at]    DATETIME2         NULL,
    [collector_host] NVARCHAR(120)     NULL,
    [agents_scanned] INT               NOT NULL CONSTRAINT [DF_agent_scan_request_agents_scanned] DEFAULT 0,
    [error_summary]  NVARCHAR(2000)    NULL,
    CONSTRAINT [PK_agent_scan_request] PRIMARY KEY CLUSTERED ([id] ASC)
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_scan_request_status')
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_scan_request_status]
    ON [dbo].[agent_scan_request] ([status] ASC, [requested_at] ASC)');
END

-- ── 2. Inventario por agente y corrida ──────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_inventory')
BEGIN
  CREATE TABLE [dbo].[agent_inventory] (
    [id]                     INT IDENTITY(1,1) NOT NULL,
    [id_agent]               INT               NOT NULL,
    [id_scan_request]        INT               NOT NULL,
    [scanned_at]             DATETIME2         NOT NULL,
    [kind]                   NVARCHAR(30)      NOT NULL,
    [host]                   NVARCHAR(120)     NOT NULL,
    [location]               NVARCHAR(300)     NULL,
    [model]                  NVARCHAR(120)     NULL,
    [service_status]         NVARCHAR(30)      NULL,
    [exec_mode]              NVARCHAR(60)      NULL,
    [exec_requires_approval] BIT               NULL,
    [tools_json]             NVARCHAR(MAX)     NULL,
    [skills_json]            NVARCHAR(MAX)     NULL,
    [channels_json]          NVARCHAR(MAX)     NULL,
    [scan_error]             NVARCHAR(500)     NULL,
    [created_at]             DATETIME2         NOT NULL CONSTRAINT [DF_agent_inventory_created_at] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PK_agent_inventory] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_agent_inventory_agent] FOREIGN KEY ([id_agent])
      REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [FK_agent_inventory_scan_request] FOREIGN KEY ([id_scan_request])
      REFERENCES [dbo].[agent_scan_request]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_inventory_agent')
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_inventory_agent]
    ON [dbo].[agent_inventory] ([id_agent] ASC, [scanned_at] ASC)');
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_inventory_scan_request')
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_inventory_scan_request]
    ON [dbo].[agent_inventory] ([id_scan_request] ASC)');
END

-- ── 3. MCP del inventario ───────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_inventory_mcp')
BEGIN
  CREATE TABLE [dbo].[agent_inventory_mcp] (
    [id]           INT IDENTITY(1,1) NOT NULL,
    [id_inventory] INT               NOT NULL,
    [name]         NVARCHAR(120)     NOT NULL,
    [transport]    NVARCHAR(20)      NOT NULL,
    [target]       NVARCHAR(300)     NULL,
    [company]      NVARCHAR(120)     NULL,
    [access]       NVARCHAR(20)      NOT NULL,
    [auth]         NVARCHAR(30)      NOT NULL,
    [write_tools]  NVARCHAR(1000)    NULL,
    CONSTRAINT [PK_agent_inventory_mcp] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_agent_inventory_mcp_inventory] FOREIGN KEY ([id_inventory])
      REFERENCES [dbo].[agent_inventory]([id]) ON DELETE CASCADE ON UPDATE NO ACTION
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_inventory_mcp_inventory')
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_inventory_mcp_inventory]
    ON [dbo].[agent_inventory_mcp] ([id_inventory] ASC)');
END

-- ── 4. Hallazgos de riesgo automáticos ──────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'agent_audit_finding')
BEGIN
  CREATE TABLE [dbo].[agent_audit_finding] (
    [id]            INT IDENTITY(1,1) NOT NULL,
    [id_agent]      INT               NOT NULL,
    [rule_code]     NVARCHAR(60)      NOT NULL,
    [severity]      NVARCHAR(20)      NOT NULL,
    [subject]       NVARCHAR(200)     NOT NULL,
    [title]         NVARCHAR(300)     NOT NULL,
    [detail]        NVARCHAR(1000)    NULL,
    [status]        NVARCHAR(20)      NOT NULL,
    [first_seen_at] DATETIME2         NOT NULL,
    [last_seen_at]  DATETIME2         NOT NULL,
    [resolved_at]   DATETIME2         NULL,
    CONSTRAINT [PK_agent_audit_finding] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_agent_audit_finding_agent] FOREIGN KEY ([id_agent])
      REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'agent_audit_finding_id_agent_rule_code_subject_key')
BEGIN
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [agent_audit_finding_id_agent_rule_code_subject_key]
    ON [dbo].[agent_audit_finding] ([id_agent] ASC, [rule_code] ASC, [subject] ASC)');
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_agent_audit_finding_status')
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_audit_finding_status]
    ON [dbo].[agent_audit_finding] ([status] ASC, [severity] ASC)');
END
