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
