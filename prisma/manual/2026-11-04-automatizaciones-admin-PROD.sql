/*
  PASE MANUAL (PRODUCCIÓN) — Automatizaciones programadas: ADMINISTRAR y detectar las MUERTAS (2026-11-04).

  Pedido de Nicolás Rivera (2026-11-04 10:06): «todas las automatizaciones de los agentes deberían
  poder verse y administrarse desde ahí, así podemos estar pendientes de que alguna automatización
  se nos murió».

  REQUIERE ANTES: 2026-11-04-automatizaciones-programadas-PROD.sql (tabla agent_scheduled_job).

  QUÉ HACE (aditivo e idempotente; solo crea lo que falta):
    - dbo.agent_scheduled_job + 3 columnas NULL:
        ref           identificador administrable: Label de launchd u «openclaw:<equipo>:<id del job>»
                      (llave del catálogo; NULL en cron, que no se administra desde la pantalla).
        horario_json  programación estructurada ({"cada": min} o {"cal": [{wd,d,h,m}]}) para calcular
                      cuándo debió correr y marcarla «Muerta / no corrió».
        ultimas_json  últimas 10 corridas (hora, terminó bien, producción, línea de error sin secretos)
                      para «Ver últimas corridas».
    - dbo.agent_scheduled_job_command   las órdenes Pausar / Reanudar / Ejecutar ahora: quién la pidió
                      (correo, IP, navegador), cuándo, qué equipo la ejecutó y cómo terminó. Es el
                      registro de auditoría; cada orden queda además en la hoja de vida del agente.
                      Índice único filtrado: una sola orden activa por automatización.
  El aviso de «muerta»/«fallando» usa las tablas de Errores de IA (2026-11-03-errores-ia, tipo
  'automatizacion', sin cambio de esquema). Si ese pase no está, el aviso se omite sin fallar.

  Sin modelo Prisma (lib/agent-audit/scheduled-admin-db.ts usa withMssqlPool): NO cambia
  schema.prisma. Sin este pase el indicador funciona como antes y «Administrar» responde 503.
  CÓMO CORRERLO: script Node con `mssql` o SSMS, con respaldo COPY_ONLY antes.
  REVERSA: prisma/manual/2026-11-04-automatizaciones-admin-reversa.sql
*/
SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;
IF DB_NAME() <> N'KRONOSDB'
  THROW 51596, N'Base no esperada: este script es solo para KRONOSDB.', 1;
IF OBJECT_ID(N'[dbo].[agent_scheduled_job]', N'U') IS NULL
  THROW 51597, N'Falta dbo.agent_scheduled_job: corra antes 2026-11-04-automatizaciones-programadas.', 1;
SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRAN;

IF COL_LENGTH(N'dbo.agent_scheduled_job', N'ref') IS NULL
  ALTER TABLE [dbo].[agent_scheduled_job] ADD [ref] NVARCHAR(200) NULL;
IF COL_LENGTH(N'dbo.agent_scheduled_job', N'horario_json') IS NULL
  ALTER TABLE [dbo].[agent_scheduled_job] ADD [horario_json] NVARCHAR(4000) NULL;
IF COL_LENGTH(N'dbo.agent_scheduled_job', N'ultimas_json') IS NULL
  ALTER TABLE [dbo].[agent_scheduled_job] ADD [ultimas_json] NVARCHAR(MAX) NULL;

IF OBJECT_ID(N'[dbo].[agent_scheduled_job_command]', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[agent_scheduled_job_command] (
    [id_command]   INT IDENTITY(1,1) NOT NULL,
    [id_job]       INT            NULL,       -- sin FK: la automatización puede desaparecer y la orden queda
    [clave]        NVARCHAR(160)  NOT NULL,   -- <host>:<tipo>:<nombre> (agent_scheduled_job.clave)
    [id_agent]     INT            NOT NULL,
    [host]         NVARCHAR(40)   NOT NULL,   -- equipo: solo el ejecutor de ESE equipo la ve
    [tipo]         NVARCHAR(20)   NOT NULL,   -- launchd | openclaw
    [ref]          NVARCHAR(200)  NOT NULL,   -- Label u openclaw:<equipo>:<id>; el ejecutor lo vuelve a validar
    [nombre]       NVARCHAR(200)  NOT NULL,
    [accion]       NVARCHAR(16)   NOT NULL,   -- pausar | reanudar | ejecutar
    [status]       NVARCHAR(16)   NOT NULL,   -- pendiente | en_curso | ok | ocupado | error | vencida
    [requested_by] NVARCHAR(255)  NOT NULL,   -- correo de quien la pidió (auditoría)
    [requested_ip] NVARCHAR(64)   NULL,
    [requested_ua] NVARCHAR(300)  NULL,
    [requested_at] DATETIME2(0)   NOT NULL,
    [taken_at]     DATETIME2(0)   NULL,
    [finished_at]  DATETIME2(0)   NULL,
    [result]       NVARCHAR(1000) NULL,
    [executor]     NVARCHAR(120)  NULL,
    CONSTRAINT [PK_agent_scheduled_job_command] PRIMARY KEY CLUSTERED ([id_command]),
    CONSTRAINT [FK_agent_scheduled_job_command_agent] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_agent_scheduled_job_command_accion')
  EXEC(N'ALTER TABLE [dbo].[agent_scheduled_job_command] WITH CHECK ADD CONSTRAINT [CK_agent_scheduled_job_command_accion] CHECK ([accion] IN (N''pausar'', N''reanudar'', N''ejecutar''));');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_agent_scheduled_job_command_status')
  EXEC(N'ALTER TABLE [dbo].[agent_scheduled_job_command] WITH CHECK ADD CONSTRAINT [CK_agent_scheduled_job_command_status] CHECK ([status] IN (N''pendiente'', N''en_curso'', N''ok'', N''ocupado'', N''error'', N''vencida''));');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_agent_scheduled_job_command_tipo')
  EXEC(N'ALTER TABLE [dbo].[agent_scheduled_job_command] WITH CHECK ADD CONSTRAINT [CK_agent_scheduled_job_command_tipo] CHECK ([tipo] IN (N''launchd'', N''openclaw''));');
/* Una sola orden ACTIVA por automatización: dos administradores a la vez no la duplican. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_agent_scheduled_job_command_activa' AND object_id = OBJECT_ID(N'[dbo].[agent_scheduled_job_command]'))
  EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [UX_agent_scheduled_job_command_activa] ON [dbo].[agent_scheduled_job_command] ([clave]) WHERE [status] IN (N''pendiente'', N''en_curso'');');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_scheduled_job_command_host' AND object_id = OBJECT_ID(N'[dbo].[agent_scheduled_job_command]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_scheduled_job_command_host] ON [dbo].[agent_scheduled_job_command] ([host], [status], [id_command]);');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_agent_scheduled_job_command_clave' AND object_id = OBJECT_ID(N'[dbo].[agent_scheduled_job_command]'))
  EXEC(N'CREATE NONCLUSTERED INDEX [IX_agent_scheduled_job_command_clave] ON [dbo].[agent_scheduled_job_command] ([clave], [id_command] DESC);');

COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
SELECT DB_NAME() AS base,
       COL_LENGTH(N'dbo.agent_scheduled_job', N'ultimas_json') AS ultimas_json,
       OBJECT_ID(N'dbo.agent_scheduled_job_command', N'U') AS agent_scheduled_job_command;
