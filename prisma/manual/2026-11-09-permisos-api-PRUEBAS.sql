/*
  PASE MANUAL (PRUEBAS) — Permisos API: clientes de API con llave propia (2026-11-09).

  QUÉ ES: SynerLink pasa a ser la fuente única de permisos de los «clientes de API» (agentes de IA,
  Portal de terceros y México). Fase 1: el catálogo son las 53 herramientas del MCP de Kronos
  (las 2 de Usuarios entran inactivas: aún no se pueden otorgar desde la base).
  Pantalla: Administración → Usuarios → pestaña «Permisos API». Doc: docs/permisos-api.md.

  QUÉ HACE (idempotente; solo crea lo que falta; de las tablas existentes solo agrega a api_client las columnas nulas de sujeto):
    tablas NUEVAS api_client, api_client_key, api_client_company, api_permission,
    api_client_permission y api_client_audit, y la semilla de las 53 herramientas en api_permission
    (solo inserta los códigos que no existan; no pisa etiquetas editadas). Se puede volver a correr:
    si ya se aplicó con las 27 primeras, solo agrega las 26 nuevas.
    La llave en claro NUNCA se guarda: solo su SHA-256 (hex) y un prefijo visible.

  TIPOS de cliente (CHECK api_client_client_type_ck): agente, mexico, portal_terceros, synerlink y otro.
  «synerlink» se agregó el 2026-11-09; si este script ya se había corrido antes, aplique también
  2026-11-09-permisos-api-tipo-synerlink-PRUEBAS.sql / -PROD.sql (reemplaza el CHECK).

  ORDEN: ANTES del código. Sin estas tablas la pestaña «Permisos API» muestra el aviso de que falta
  el script y el MCP sigue funcionando solo con las llaves del archivo (MCP_API_KEYS).

  CÓMO CORRERLO: script Node con `mssql` o SSMS, con respaldo COPY_ONLY antes.
  SUJETOS (2026-11-09): api_client trae subject_ref / subject_label (a quién representa el cliente:
  NIT del tercero, usuario de SynerLink o sistema) y se crea api_external_system con su semilla.
  Si este script ya se había corrido antes sin sujetos, vuelva a correrlo o aplique
  2026-11-09-permisos-api-sujetos-PRUEBAS.sql / -PROD.sql (hacen lo mismo, idempotentes).

  REVERSA: prisma/manual/2026-11-09-permisos-api-reversa.sql
*/

SET NOCOUNT ON;
SET LOCK_TIMEOUT 5000;

IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51740, N'Base no esperada: este script es solo para KRONOSDB_PRUEBAS.', 1;

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.company', N'U') IS NULL
  THROW 51741, N'Falta la tabla company.', 1;

BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.api_client', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[api_client] (
    [id_api_client] INT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(120) NOT NULL,
    [client_type] NVARCHAR(30) NOT NULL,
    [description] NVARCHAR(500) NULL,
    [agent_code] NVARCHAR(60) NULL,
    [subject_ref] NVARCHAR(120) NULL,
    [subject_label] NVARCHAR(200) NULL,
    [all_companies] BIT NOT NULL CONSTRAINT [api_client_all_companies_df] DEFAULT 0,
    [active] BIT NOT NULL CONSTRAINT [api_client_active_df] DEFAULT 1,
    [created_by] NVARCHAR(320) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [api_client_created_at_df] DEFAULT SYSUTCDATETIME(),
    [updated_by] NVARCHAR(320) NULL,
    [updated_at] DATETIME2 NULL,
    CONSTRAINT [api_client_pkey] PRIMARY KEY CLUSTERED ([id_api_client]),
    CONSTRAINT [api_client_name_key] UNIQUE NONCLUSTERED ([name]),
    CONSTRAINT [api_client_client_type_ck] CHECK ([client_type] IN (N'agente', N'mexico', N'portal_terceros', N'synerlink', N'otro'))
  );
END;

IF OBJECT_ID(N'dbo.api_client_key', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[api_client_key] (
    [id_api_client_key] INT NOT NULL IDENTITY(1,1),
    [id_api_client] INT NOT NULL,
    [key_hash] CHAR(64) NOT NULL,
    [key_prefix] NVARCHAR(20) NOT NULL,
    [created_by] NVARCHAR(320) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [api_client_key_created_at_df] DEFAULT SYSUTCDATETIME(),
    [last_used_at] DATETIME2 NULL,
    [revoked_at] DATETIME2 NULL,
    [revoked_by] NVARCHAR(320) NULL,
    CONSTRAINT [api_client_key_pkey] PRIMARY KEY CLUSTERED ([id_api_client_key]),
    CONSTRAINT [api_client_key_key_hash_key] UNIQUE NONCLUSTERED ([key_hash]),
    CONSTRAINT [api_client_key_id_api_client_fkey] FOREIGN KEY ([id_api_client]) REFERENCES [dbo].[api_client]([id_api_client]) ON DELETE CASCADE ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [api_client_key_id_api_client_idx] ON [dbo].[api_client_key]([id_api_client]);
END;

IF OBJECT_ID(N'dbo.api_client_company', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[api_client_company] (
    [id_api_client] INT NOT NULL,
    [id_company] INT NOT NULL,
    CONSTRAINT [api_client_company_pkey] PRIMARY KEY CLUSTERED ([id_api_client], [id_company]),
    CONSTRAINT [api_client_company_id_api_client_fkey] FOREIGN KEY ([id_api_client]) REFERENCES [dbo].[api_client]([id_api_client]) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT [api_client_company_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF OBJECT_ID(N'dbo.api_permission', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[api_permission] (
    [code] NVARCHAR(100) NOT NULL,
    [system] NVARCHAR(30) NOT NULL CONSTRAINT [api_permission_system_df] DEFAULT N'synerlink',
    [group_label] NVARCHAR(80) NOT NULL,
    [label] NVARCHAR(120) NOT NULL,
    [description] NVARCHAR(500) NULL,
    [active] BIT NOT NULL CONSTRAINT [api_permission_active_df] DEFAULT 1,
    [display_order] INT NOT NULL CONSTRAINT [api_permission_display_order_df] DEFAULT 0,
    CONSTRAINT [api_permission_pkey] PRIMARY KEY CLUSTERED ([code])
  );
END;

IF OBJECT_ID(N'dbo.api_client_permission', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[api_client_permission] (
    [id_api_client] INT NOT NULL,
    [permission_code] NVARCHAR(100) NOT NULL,
    CONSTRAINT [api_client_permission_pkey] PRIMARY KEY CLUSTERED ([id_api_client], [permission_code]),
    CONSTRAINT [api_client_permission_id_api_client_fkey] FOREIGN KEY ([id_api_client]) REFERENCES [dbo].[api_client]([id_api_client]) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT [api_client_permission_permission_code_fkey] FOREIGN KEY ([permission_code]) REFERENCES [dbo].[api_permission]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

-- Sujetos (2026-11-09): para bases donde api_client se creó sin estas columnas.
IF COL_LENGTH(N'dbo.api_client', N'subject_ref') IS NULL
  ALTER TABLE [dbo].[api_client] ADD [subject_ref] NVARCHAR(120) NULL;

IF COL_LENGTH(N'dbo.api_client', N'subject_label') IS NULL
  ALTER TABLE [dbo].[api_client] ADD [subject_label] NVARCHAR(200) NULL;

-- Sistemas externos que se eligen como sujeto de los clientes tipo «otro».
IF OBJECT_ID(N'dbo.api_external_system', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[api_external_system] (
    [id_api_external_system] INT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(120) NOT NULL,
    [description] NVARCHAR(500) NULL,
    [active] BIT NOT NULL CONSTRAINT [api_external_system_active_df] DEFAULT 1,
    [created_by] NVARCHAR(320) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [api_external_system_created_at_df] DEFAULT SYSUTCDATETIME(),
    [updated_by] NVARCHAR(320) NULL,
    [updated_at] DATETIME2 NULL,
    CONSTRAINT [api_external_system_pkey] PRIMARY KEY CLUSTERED ([id_api_external_system]),
    CONSTRAINT [api_external_system_name_key] UNIQUE NONCLUSTERED ([name])
  );
END;

INSERT INTO [dbo].[api_external_system] ([name], [description], [active], [created_by])
SELECT v.name, v.description, 1, N'script 2026-11-09-permisos-api'
FROM (VALUES
  (N'Power Automate',        N'Flujos de Microsoft Power Automate.'),
  (N'n8n',                   N'Flujos de automatización en n8n.'),
  (N'Orion',                 N'Plataforma de firma electrónica de GSS.'),
  (N'SAPSEND',               N'Integración SAPSEND con SAP Business One.'),
  (N'Programador de tareas', N'Tareas programadas del servidor.')
) AS v(name, description)
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[api_external_system] s WHERE s.[name] = v.name);

-- Auditoría: sin llave foránea a propósito, para que el historial sobreviva aunque se borre un cliente a mano.
IF OBJECT_ID(N'dbo.api_client_audit', N'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[api_client_audit] (
    [id_api_client_audit] BIGINT NOT NULL IDENTITY(1,1),
    [id_api_client] INT NULL,
    [action] NVARCHAR(40) NOT NULL,
    [detail] NVARCHAR(MAX) NULL,
    [changed_by] NVARCHAR(320) NOT NULL,
    [changed_at] DATETIME2 NOT NULL CONSTRAINT [api_client_audit_changed_at_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [api_client_audit_pkey] PRIMARY KEY CLUSTERED ([id_api_client_audit])
  );
  CREATE NONCLUSTERED INDEX [api_client_audit_id_api_client_idx] ON [dbo].[api_client_audit]([id_api_client], [changed_at]);
END;

/* Semilla del catálogo: las 53 herramientas del MCP (carpeta mcp/src/tools). Al volver a correr el script
   solo entran los códigos nuevos (WHERE NOT EXISTS): no pisa etiquetas ni el «activo» editados. */
INSERT INTO [dbo].[api_permission] ([code], [system], [group_label], [label], [description], [active], [display_order])
SELECT v.code, N'synerlink', v.group_label, v.label, v.description, v.active, v.display_order
FROM (VALUES
  (N'kronos_list_requests',          N'Consultar solicitudes', N'Listar solicitudes',               N'Lista solicitudes generales de las empresas del cliente.', 1, 110),
  (N'kronos_get_request',            N'Consultar solicitudes', N'Ver una solicitud',                N'Detalle de una solicitud.', 1, 120),
  (N'kronos_list_request_notes',     N'Consultar solicitudes', N'Ver notas de una solicitud',       N'Bitácora de notas de una solicitud.', 1, 130),
  (N'kronos_list_request_tasks',     N'Consultar solicitudes', N'Ver actividades del flujo',        N'Tareas del flujo de una solicitud.', 1, 140),
  (N'kronos_get_request_fields',     N'Consultar solicitudes', N'Ver formulario diligenciado',      N'Valores del formulario dinámico de una solicitud.', 1, 150),
  (N'kronos_list_attachments',       N'Consultar solicitudes', N'Listar adjuntos',                  N'Adjuntos de una solicitud o ticket (OneDrive).', 1, 160),
  (N'kronos_get_attachment',         N'Consultar solicitudes', N'Descargar un adjunto',             N'Contenido de un adjunto de una solicitud o ticket.', 1, 170),
  (N'kronos_create_request',         N'Crear solicitudes',     N'Crear solicitudes',                N'Radica solicitudes generales con su flujo y notificaciones.', 1, 210),
  (N'kronos_get_process_fields',     N'Crear solicitudes',     N'Ver formulario de un proceso',     N'Definición del formulario dinámico, necesaria para crear solicitudes.', 1, 220),
  (N'kronos_add_note',               N'Gestionar solicitudes', N'Agregar notas',                    N'Agrega notas a la bitácora de una solicitud.', 1, 310),
  (N'kronos_resolve_task',           N'Gestionar solicitudes', N'Resolver actividades',             N'Cierra actividades del flujo de una solicitud.', 1, 320),
  (N'kronos_set_request_fields',     N'Gestionar solicitudes', N'Diligenciar formulario',           N'Guarda valores del formulario dinámico de una solicitud abierta.', 1, 330),
  (N'kronos_categorize_request',     N'Gestionar solicitudes', N'Categorizar solicitudes',          N'Asigna la categoría de proceso de una solicitud.', 1, 340),
  (N'kronos_upload_attachment',      N'Gestionar solicitudes', N'Subir adjuntos',                   N'Sube archivos a la carpeta de una solicitud o ticket.', 1, 350),
  (N'kronos_delete_attachment',      N'Gestionar solicitudes', N'Eliminar adjuntos',                N'Elimina adjuntos. Hoy el MCP solo lo permite a llaves con rol admin del archivo de configuración.', 1, 360),
  (N'kronos_list_processes',         N'Catálogos',             N'Procesos y subprocesos',           N'Catálogo global de procesos.', 1, 410),
  (N'kronos_list_process_categories', N'Catálogos',            N'Categorías de proceso',            N'Workflows de solicitudes de las empresas del cliente.', 1, 420),
  (N'kronos_list_departments',       N'Catálogos',             N'Departamentos',                    N'Catálogo global de departamentos.', 1, 430),
  (N'kronos_list_categories',        N'Catálogos',             N'Categorías y subcategorías',       N'Catálogo global de categorías de mesa de ayuda.', 1, 440),
  (N'kronos_list_users',             N'Catálogos',             N'Usuarios',                         N'Usuarios de las empresas del cliente (sin contraseñas ni tokens).', 1, 450),
  (N'kronos_list_tickets',           N'Help desk / tickets y actividades', N'Listar tickets',       N'Tickets de mesa de ayuda de las empresas del cliente.', 1, 510),
  (N'kronos_get_ticket',             N'Help desk / tickets y actividades', N'Ver un ticket',        N'Detalle de un ticket.', 1, 520),
  (N'kronos_categorize_case',        N'Help desk / tickets y actividades', N'Categorizar tickets',  N'Asigna categoría, subcategoría y actividad a un ticket.', 1, 530),
  (N'kronos_list_activities',        N'Help desk / tickets y actividades', N'Actividades',          N'Catálogo global de actividades.', 1, 540),
  (N'kronos_metadata',               N'Otros',                 N'Metadatos del servidor',           N'Entidades, campos y alcance de la llave.', 1, 610),
  (N'kronos_search',                 N'Otros',                 N'Búsqueda',                         N'Búsqueda de solicitudes y tickets dentro del alcance.', 1, 620),
  (N'kronos_request_ia_access',      N'Otros',                 N'Solicitar conectores de IA',       N'Radica solicitudes de conectores IA a nombre de una persona. Exige código de agente.', 1, 630),
  /* Catálogo completo (2026-11-09, segunda tanda): las 26 herramientas restantes del MCP. */
  (N'kronos_list_bitacoras',              N'Bitácora de Proceso', N'Listar bitácoras',                N'Bitácoras de proceso (turnos de planta) de las empresas del cliente.', 1, 710),
  (N'kronos_get_bitacora',                N'Bitácora de Proceso', N'Ver una bitácora',                N'Una bitácora completa: encabezado, participantes, registros y firmas.', 1, 720),
  (N'kronos_bitacora_actividad_reciente', N'Bitácora de Proceso', N'Actividad reciente',              N'Registros recientes de las bitácoras abiertas (monitoreo en planta).', 1, 730),
  (N'kronos_list_bitacora_actividades',   N'Bitácora de Proceso', N'Catálogo de intervenciones',      N'Intervenciones de la bitácora por empresa.', 1, 740),
  (N'proyectos_listar',                        N'Proyectos', N'Listar proyectos',                   N'Proyectos que la persona le compartió (concesión de 24 h o turno del chat). Exige código de agente.', 1, 810),
  (N'proyecto_detalle',                        N'Proyectos', N'Ver un proyecto',                    N'Detalle de un proyecto compartido: miembros, asistentes y vínculos. Exige código de agente.', 1, 820),
  (N'proyecto_cronograma',                     N'Proyectos', N'Ver el cronograma',                  N'Tareas y solicitudes vinculadas de un proyecto compartido. Exige código de agente.', 1, 830),
  (N'proyecto_calendario',                     N'Proyectos', N'Ver el calendario',                  N'Eventos de tareas y solicitudes entre dos fechas. Exige código de agente.', 1, 840),
  (N'proyecto_historial',                      N'Proyectos', N'Ver el historial de hilos',          N'Conversaciones del proyecto. Exige código de agente.', 1, 850),
  (N'proyecto_prs',                            N'Proyectos', N'Ver pull requests',                  N'PR mencionados en los hilos o de las ramas del proyecto. Exige código de agente.', 1, 860),
  (N'proyecto_proponer_tarea',                 N'Proyectos', N'Proponer una tarea',                 N'Solo propone: la persona la confirma en SynerLink. Exige código de agente.', 1, 870),
  (N'proyecto_proponer_cambio_tarea',          N'Proyectos', N'Proponer cambios a una tarea',       N'Solo propone: la persona lo confirma en SynerLink. Exige código de agente.', 1, 880),
  (N'proyecto_proponer_vincular_solicitud',    N'Proyectos', N'Proponer vincular una solicitud',    N'Solo propone: la persona lo confirma en SynerLink. Exige código de agente.', 1, 890),
  (N'proyecto_proponer_desvincular_solicitud', N'Proyectos', N'Proponer desvincular una solicitud', N'Solo propone: la persona lo confirma en SynerLink. Exige código de agente.', 1, 900),
  (N'proyecto_proponer_conversacion',          N'Proyectos', N'Proponer una conversación',          N'Solo propone abrir un hilo con un asistente del proyecto. Exige código de agente.', 1, 910),
  (N'proyecto_proponer_invitar',               N'Proyectos', N'Proponer invitar a una persona',     N'Solo propone: la dueña del proyecto lo confirma en SynerLink. Exige código de agente.', 1, 920),
  (N'correo_hilo_compartido',            N'Correo', N'Leer el hilo compartido',           N'Hilo que la persona le compartió desde el Correo (24 h). Exige código de agente y que el servidor tenga encendido «Consultar a un agente».', 1, 1010),
  (N'correo_adjunto_compartido',         N'Correo', N'Descargar un adjunto del hilo',     N'Un adjunto del hilo compartido (máximo 5 MB). Exige código de agente.', 1, 1020),
  (N'correo_proponer_respuesta',         N'Correo', N'Proponer una respuesta',            N'Solo propone: la persona la envía desde su buzón. Exige código de agente.', 1, 1030),
  (N'correo_crear_solicitud_desde_hilo', N'Correo', N'Proponer una solicitud del hilo',   N'Solo propone: la persona la radica en SynerLink. Exige código de agente.', 1, 1040),
  (N'correo_agregar_nota',               N'Correo', N'Proponer una nota en la solicitud', N'Solo propone: la persona la agrega al caso. Exige código de agente.', 1, 1050),
  (N'teams_list_meetings',    N'Teams', N'Listar reuniones',       N'Reuniones de Teams de la cuenta de Microsoft configurada en el servidor. No se filtra por empresa.', 1, 1110),
  (N'teams_list_transcripts', N'Teams', N'Listar transcripciones', N'Transcripciones de una reunión de esa cuenta. No se filtra por empresa.', 1, 1120),
  (N'teams_get_transcript',   N'Teams', N'Leer una transcripción', N'Contenido de una transcripción de esa cuenta. No se filtra por empresa.', 1, 1130),
  (N'kronos_usuarios_consultar', N'Usuarios', N'Consultar usuarios', N'No se puede otorgar todavía: requiere configuración adicional (solicitantes, empresas, departamentos, subprocesos, dominios y topes); hoy solo por archivo (bloque «usuarios»).', 0, 1210),
  (N'kronos_usuarios_crear',     N'Usuarios', N'Crear usuarios',     N'No se puede otorgar todavía: requiere configuración adicional (solicitantes, empresas, departamentos, subprocesos, dominios y topes); hoy solo por archivo (bloque «usuarios»).', 0, 1220)
) AS v(code, group_label, label, description, active, display_order)
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[api_permission] p WHERE p.[code] = v.code);

COMMIT TRANSACTION;

/* BLOQUE-DDL-FIN */

SELECT DB_NAME() AS base,
       OBJECT_ID(N'dbo.api_client', N'U') AS api_client,
       OBJECT_ID(N'dbo.api_client_key', N'U') AS api_client_key,
       OBJECT_ID(N'dbo.api_client_company', N'U') AS api_client_company,
       OBJECT_ID(N'dbo.api_permission', N'U') AS api_permission,
       OBJECT_ID(N'dbo.api_client_permission', N'U') AS api_client_permission,
       OBJECT_ID(N'dbo.api_client_audit', N'U') AS api_client_audit,
       OBJECT_ID(N'dbo.api_external_system', N'U') AS api_external_system,
       (SELECT COUNT(*) FROM [dbo].[api_permission]) AS permisos_catalogo;
