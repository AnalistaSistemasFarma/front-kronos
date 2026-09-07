/*
  Migración: add_chat_agents
  Módulo "Asistentes IA" (chat de agentes en SynerLink) — Fase 2a: modelo de
  datos y permisos. Solo infraestructura; la interfaz llega en una fase
  posterior.

  AISLAMIENTO (pedido explícito de Nicolás): este módulo NO debe rozar el
  módulo de Gestión Documental (SGD) y viceversa. Esta migración es
  ESTRICTAMENTE ADITIVA: solo crea tablas nuevas con prefijo `agent_`/`chat_`.
  No hay DROP, ALTER ni TRUNCATE sobre ninguna tabla existente (ni del SGD ni
  de ninguna otra).

  ATENCIÓN: esta migración se escribió MANUALMENTE siguiendo el mismo criterio
  de 20260821000000_add_document_management (base de PRUEBAS sin shadow
  database disponible, ver .env: SHADOW_DATABASE_URL deshabilitada). El SQL
  respeta el estilo que genera `prisma migrate diff --script` para el provider
  sqlserver.

  Tablas creadas:
    - agent               catálogo de bots de la flota. `id_subprocess`
                          apunta al subproceso que ES su permiso (FK real).
    - agent_company        agrupación N:N agente <-> empresa (las "carpetas")
    - chat_conversation    hilo entre un usuario y un agente
    - chat_message         mensajes del hilo (body = Markdown CRUDO, nunca HTML)
    - chat_attachment      adjuntos de un mensaje (OneDrive)
    - chat_agent_status    estado en vivo del agente dentro de una conversación

  NO se crea `user_agent_access`: ver la decisión documentada en
  lib/chat/access.ts y en el comentario del módulo en prisma/schema.prisma —
  el PERMISO vive en el esquema existente process -> subprocess ->
  subprocess_user_company, y la auditoría de "quién otorgó y cuándo" ya la
  cubre `user_audit_log` (acción UPDATE_SUBPROCESSES, con performed_by y
  created_at). Una tabla paralela sería una segunda fuente de verdad del mismo
  permiso.

  Cadenas de borrado (SQL Server no admite múltiples rutas de cascada hacia la
  misma tabla; por eso solo hay UNA ruta en cascada por tabla hija):
    user -> chat_conversation -> chat_message -> chat_attachment   (CASCADE)
    user -> chat_conversation -> chat_agent_status                 (CASCADE)
    agent  -> chat_conversation                                    (NO ACTION)
    company -> agent_company                                       (NO ACTION)

  Para registrar esta migración como aplicada en una base que YA tiene las
  tablas, use:
    npx prisma migrate resolve --applied 20260906120000_add_chat_agents
*/

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[agent] (
    [id_agent] INT NOT NULL IDENTITY(1,1),
    [code] NVARCHAR(60) NOT NULL,
    [display_name] NVARCHAR(120) NOT NULL,
    [handle] NVARCHAR(60),
    [avatar_url] NVARCHAR(500),
    [description] NVARCHAR(500),
    [is_active] BIT NOT NULL CONSTRAINT [agent_is_active_df] DEFAULT 1,
    [sort_order] INT NOT NULL CONSTRAINT [agent_sort_order_df] DEFAULT 0,
    [id_subprocess] INT,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [agent_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [agent_pkey] PRIMARY KEY CLUSTERED ([id_agent]),
    CONSTRAINT [agent_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[agent_company] (
    [id_agent_company] INT NOT NULL IDENTITY(1,1),
    [id_agent] INT NOT NULL,
    [id_company] INT NOT NULL,
    [is_primary] BIT NOT NULL CONSTRAINT [agent_company_is_primary_df] DEFAULT 0,
    CONSTRAINT [agent_company_pkey] PRIMARY KEY CLUSTERED ([id_agent_company]),
    CONSTRAINT [agent_company_id_agent_id_company_key] UNIQUE NONCLUSTERED ([id_agent],[id_company])
);

-- CreateTable
CREATE TABLE [dbo].[chat_conversation] (
    [id] INT NOT NULL IDENTITY(1,1),
    [id_user] NVARCHAR(1000) NOT NULL,
    [id_agent] INT NOT NULL,
    [title] NVARCHAR(300),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [chat_conversation_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    [last_message_at] DATETIME2,
    [archived] BIT NOT NULL CONSTRAINT [chat_conversation_archived_df] DEFAULT 0,
    CONSTRAINT [chat_conversation_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[chat_message] (
    [id] INT NOT NULL IDENTITY(1,1),
    [id_conversation] INT NOT NULL,
    [role] NVARCHAR(20) NOT NULL,
    [body] NVARCHAR(max) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [chat_message_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [delivered_at] DATETIME2,
    [read_at] DATETIME2,
    CONSTRAINT [chat_message_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[chat_attachment] (
    [id] INT NOT NULL IDENTITY(1,1),
    [id_message] INT NOT NULL,
    [file_name] NVARCHAR(400) NOT NULL,
    [content_type] NVARCHAR(200),
    [size_bytes] INT,
    [onedrive_item_id] NVARCHAR(300),
    [web_url] NVARCHAR(1000),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [chat_attachment_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [chat_attachment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[chat_agent_status] (
    [id_conversation] INT NOT NULL,
    [state] NVARCHAR(20) NOT NULL CONSTRAINT [chat_agent_status_state_df] DEFAULT 'idle',
    [label] NVARCHAR(200),
    [updated_at] DATETIME2 NOT NULL,
    CONSTRAINT [chat_agent_status_pkey] PRIMARY KEY CLUSTERED ([id_conversation])
);

-- CreateIndex
-- Índice ÚNICO FILTRADO (mismo criterio que UX_user_nit en
-- 20260818120000_add_user_nit_supplier): un subproceso no puede ser el permiso
-- de dos agentes distintos, pero sí pueden coexistir varios agentes sin
-- subproceso asignado (NULL). SQL Server solo admite un NULL en un índice
-- único NO filtrado, de ahí el WHERE.
CREATE UNIQUE INDEX [UX_agent_id_subprocess]
    ON [dbo].[agent] ([id_subprocess])
    WHERE [id_subprocess] IS NOT NULL;

-- CreateIndex
CREATE NONCLUSTERED INDEX [agent_company_id_company_idx] ON [dbo].[agent_company]([id_company]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [chat_conversation_id_user_archived_last_message_at_idx] ON [dbo].[chat_conversation]([id_user], [archived], [last_message_at] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [chat_conversation_id_agent_idx] ON [dbo].[chat_conversation]([id_agent]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [chat_message_id_conversation_id_idx] ON [dbo].[chat_message]([id_conversation], [id] DESC);

-- CreateIndex
CREATE NONCLUSTERED INDEX [chat_message_id_conversation_created_at_idx] ON [dbo].[chat_message]([id_conversation], [created_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [chat_attachment_id_message_idx] ON [dbo].[chat_attachment]([id_message]);

-- AddForeignKey
ALTER TABLE [dbo].[agent] ADD CONSTRAINT [agent_id_subprocess_fkey] FOREIGN KEY ([id_subprocess]) REFERENCES [dbo].[subprocess]([id_subprocess]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[agent_company] ADD CONSTRAINT [agent_company_id_agent_fkey] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[agent_company] ADD CONSTRAINT [agent_company_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[chat_conversation] ADD CONSTRAINT [chat_conversation_id_user_fkey] FOREIGN KEY ([id_user]) REFERENCES [dbo].[user]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[chat_conversation] ADD CONSTRAINT [chat_conversation_id_agent_fkey] FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[chat_message] ADD CONSTRAINT [chat_message_id_conversation_fkey] FOREIGN KEY ([id_conversation]) REFERENCES [dbo].[chat_conversation]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[chat_attachment] ADD CONSTRAINT [chat_attachment_id_message_fkey] FOREIGN KEY ([id_message]) REFERENCES [dbo].[chat_message]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[chat_agent_status] ADD CONSTRAINT [chat_agent_status_id_conversation_fkey] FOREIGN KEY ([id_conversation]) REFERENCES [dbo].[chat_conversation]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
