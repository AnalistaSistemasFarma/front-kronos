/*
  Migración: sgc_s6_endurecimiento
  SGC documental — Sprint 6 (endurecimiento, validación y preparación para
  producción), 2026-10-01.

  Qué agrega (100 % ADITIVA, solo objetos del esquema `sgc` y un trigger de
  base de datos que SOLO actúa sobre `sgc`; no toca ninguna tabla de `dbo`):

    1. Índices de rendimiento (revisión del S6):
       - [sgc].[audit_log] (actor_email, action, occurred_at): el conteo de
         intentos de reautenticación fallidos en cada firma recorría la tabla.
       - [sgc].[request] (id_document, status): solicitudes abiertas de un
         documento, calendario e iCal.
       - [sgc].[review_alert] (id_document_version, alert_key): job de avisos.

    2. Cadena de firmas única en la base: dos firmas de la misma empresa no
       pueden colgar del mismo registro anterior (ni haber dos «génesis»).
       Hoy lo garantiza el bloqueo de la aplicación; ahora también la base.

    3. [sgc].[proteccion_registros]: tabla SIEMPRE VACÍA (CHECK 1 = 0) con
       claves foráneas hacia los registros de solo inserción. SQL Server no
       permite TRUNCATE ni DROP de una tabla referenciada por una clave
       foránea: así un TRUNCATE o DROP «por accidente» de la auditoría, las
       firmas o el historial falla aunque lo intente un administrador de la
       base (los triggers de solo inserción no ven el TRUNCATE ni el DROP).

    4. [sgc].[ddl_event_log] (solo inserción) y el trigger de base de datos
       [sgc_proteger_esquema]: todo cambio de estructura sobre `sgc` queda
       registrado (quién, desde dónde, qué sentencia, cuándo) y los cambios
       destructivos (DROP/ALTER de tablas, triggers e índices, RENAME,
       transferencia de esquema) se RECHAZAN salvo que la sesión declare el
       cambio controlado:
           EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
           EXEC sp_set_session_context N'sgc_ddl_motivo', N'<control de cambios>';
       El mantenimiento de índices (ALTER INDEX) y las estadísticas siguen
       permitidos (se registran).

  LÍMITE HONESTO (documentado en el paquete de validación, probado en PRUEBAS):
  un usuario con permisos de dueño de la base (db_owner/sysadmin) puede QUITAR
  (DROP TRIGGER ... ON DATABASE) o deshabilitar (DISABLE TRIGGER) el trigger
  de base de datos y deshabilitar los triggers de tabla: SQL Server no deja
  que un trigger impida su propia eliminación ni reporta DISABLE TRIGGER como
  evento DDL. Lo que NO puede hacer sin dejar rastro es TRUNCATE o DROP de los
  registros (la tabla de protección lo impide con claves foráneas). Eso solo se cierra con permisos:
  la aplicación debe conectarse con un usuario SIN privilegios de DDL
  (solicitud a infraestructura) y la verificación periódica de integridad
  revisa que ningún trigger del SGC esté deshabilitado.

  ⚠️ ORDEN DEL PASE: va ANTES que el código. Idempotente: cada bloque verifica
  si el objeto existe. Las reversas de S1–S5 deben correr DESPUÉS de la
  reversa de este sprint (o declarar el cambio controlado como arriba).

  REVERSA: prisma/manual/2026-10-01-sgc-s6-endurecimiento-reversa.sql
*/

-- Esta misma migración es un cambio controlado del esquema `sgc`.
EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261001200000_sgc_s6_endurecimiento (Sprint 6)';

BEGIN TRY

BEGIN TRAN;

/* 1. Índices de rendimiento. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sgc_audit_log_actor_email_action_occurred_at' AND object_id = OBJECT_ID(N'[sgc].[audit_log]'))
  CREATE NONCLUSTERED INDEX [IX_sgc_audit_log_actor_email_action_occurred_at] ON [sgc].[audit_log]([actor_email], [action], [occurred_at]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sgc_request_id_document_status' AND object_id = OBJECT_ID(N'[sgc].[request]'))
  CREATE NONCLUSTERED INDEX [IX_sgc_request_id_document_status] ON [sgc].[request]([id_document], [status]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sgc_review_alert_id_document_version_alert_key' AND object_id = OBJECT_ID(N'[sgc].[review_alert]'))
  CREATE NONCLUSTERED INDEX [IX_sgc_review_alert_id_document_version_alert_key] ON [sgc].[review_alert]([id_document_version], [alert_key]);

/* 3. Tabla de protección contra TRUNCATE/DROP (siempre vacía). */
IF OBJECT_ID(N'[sgc].[proteccion_registros]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[proteccion_registros] (
      [id] INT NOT NULL,
      [id_audit_log] BIGINT NULL,
      [id_config_change] BIGINT NULL,
      [id_interaction] BIGINT NULL,
      [id_signature] INT NULL,
      [id_signature_consent] INT NULL,
      [id_quality_check] INT NULL,
      [id_draft_revision] INT NULL,
      [id_training_upload] INT NULL,
      [id_training_result] INT NULL,
      [id_review_alert] INT NULL,
      CONSTRAINT [proteccion_registros_pkey] PRIMARY KEY CLUSTERED ([id]),
      CONSTRAINT [proteccion_registros_siempre_vacia_ck] CHECK (1 = 0),
      CONSTRAINT [proteccion_registros_audit_log_fk] FOREIGN KEY ([id_audit_log]) REFERENCES [sgc].[audit_log]([id_audit_log]),
      CONSTRAINT [proteccion_registros_config_change_log_fk] FOREIGN KEY ([id_config_change]) REFERENCES [sgc].[config_change_log]([id_config_change]),
      CONSTRAINT [proteccion_registros_interaction_fk] FOREIGN KEY ([id_interaction]) REFERENCES [sgc].[interaction]([id_interaction]),
      CONSTRAINT [proteccion_registros_signature_fk] FOREIGN KEY ([id_signature]) REFERENCES [sgc].[signature]([id_signature]),
      CONSTRAINT [proteccion_registros_signature_consent_fk] FOREIGN KEY ([id_signature_consent]) REFERENCES [sgc].[signature_consent]([id_signature_consent]),
      CONSTRAINT [proteccion_registros_quality_check_fk] FOREIGN KEY ([id_quality_check]) REFERENCES [sgc].[quality_check]([id_quality_check]),
      CONSTRAINT [proteccion_registros_draft_revision_fk] FOREIGN KEY ([id_draft_revision]) REFERENCES [sgc].[draft_revision]([id_draft_revision]),
      CONSTRAINT [proteccion_registros_training_upload_fk] FOREIGN KEY ([id_training_upload]) REFERENCES [sgc].[training_upload]([id_training_upload]),
      CONSTRAINT [proteccion_registros_training_result_fk] FOREIGN KEY ([id_training_result]) REFERENCES [sgc].[training_result]([id_training_result]),
      CONSTRAINT [proteccion_registros_review_alert_fk] FOREIGN KEY ([id_review_alert]) REFERENCES [sgc].[review_alert]([id_review_alert])
  );
END;

/* 4. Registro de cambios de estructura del esquema sgc (solo inserción). */
IF OBJECT_ID(N'[sgc].[ddl_event_log]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[ddl_event_log] (
      [id_ddl_event] BIGINT NOT NULL IDENTITY(1,1),
      [event_type] NVARCHAR(100) NOT NULL,
      [object_type] NVARCHAR(100) NULL,
      [object_name] NVARCHAR(256) NULL,
      [target_object] NVARCHAR(256) NULL,
      [login_name] NVARCHAR(256) NULL,
      [host_name] NVARCHAR(256) NULL,
      [app_name] NVARCHAR(256) NULL,
      [authorized] BIT NOT NULL,
      [motivo] NVARCHAR(400) NULL,
      [tsql] NVARCHAR(MAX) NULL,
      [occurred_at] DATETIME2 NOT NULL CONSTRAINT [ddl_event_log_occurred_at_df] DEFAULT SYSUTCDATETIME(),
      CONSTRAINT [ddl_event_log_pkey] PRIMARY KEY CLUSTERED ([id_ddl_event])
  );
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH;

/* 2. Cadena de firmas única (índices únicos filtrados). */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'signature_cadena_prev_uq' AND object_id = OBJECT_ID(N'[sgc].[signature]'))
  EXEC sp_executesql N'CREATE UNIQUE NONCLUSTERED INDEX [signature_cadena_prev_uq] ON [sgc].[signature]([id_company], [prev_record_hash]) WHERE [prev_record_hash] IS NOT NULL;';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'signature_cadena_genesis_uq' AND object_id = OBJECT_ID(N'[sgc].[signature]'))
  EXEC sp_executesql N'CREATE UNIQUE NONCLUSTERED INDEX [signature_cadena_genesis_uq] ON [sgc].[signature]([id_company]) WHERE [prev_record_hash] IS NULL;';

/* El registro de cambios de estructura no se modifica ni se borra. */
IF OBJECT_ID(N'[sgc].[ddl_event_log_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[ddl_event_log_solo_insercion]
ON [sgc].[ddl_event_log]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51040, N''sgc.ddl_event_log es de solo inserción: no se modifica ni se borra.'', 1;
END;';

-- [solo-base-real-inicio] (la restauración en un esquema temporal omite este bloque)
/*
  Trigger de BASE DE DATOS: solo mira eventos del esquema `sgc`. Para todo lo
  demás (dbo y otros esquemas) sale de inmediato sin hacer nada.
*/
IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = N'sgc_proteger_esquema' AND parent_class = 0)
  EXEC sp_executesql N'CREATE TRIGGER [sgc_proteger_esquema]
ON DATABASE
FOR DDL_DATABASE_LEVEL_EVENTS
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @e XML = EVENTDATA();
  DECLARE @schema SYSNAME = @e.value(''(/EVENT_INSTANCE/SchemaName)[1]'', ''sysname'');
  DECLARE @otype NVARCHAR(100) = @e.value(''(/EVENT_INSTANCE/ObjectType)[1]'', ''nvarchar(100)'');
  DECLARE @oname NVARCHAR(256) = @e.value(''(/EVENT_INSTANCE/ObjectName)[1]'', ''nvarchar(256)'');
  -- Solo eventos del esquema sgc o sobre el propio esquema. (Un trigger de base de datos no puede
  -- impedir que lo quiten o deshabiliten: eso lo cubren los permisos y la verificación periódica.)
  IF NOT (@schema = N''sgc'' OR (@otype = N''SCHEMA'' AND @oname = N''sgc'')) RETURN;

  DECLARE @event NVARCHAR(100) = @e.value(''(/EVENT_INSTANCE/EventType)[1]'', ''nvarchar(100)'');
  DECLARE @ok BIT = CASE WHEN TRY_CAST(SESSION_CONTEXT(N''sgc_ddl_autorizado'') AS INT) = 1 THEN 1 ELSE 0 END;

  IF @ok = 0 AND @event IN (N''DROP_TABLE'', N''ALTER_TABLE'', N''DROP_TRIGGER'', N''ALTER_TRIGGER'', N''DROP_INDEX'', N''DROP_SCHEMA'', N''ALTER_SCHEMA'', N''RENAME'', N''DROP_VIEW'', N''DROP_PROCEDURE'', N''DROP_FUNCTION'')
  BEGIN
    ROLLBACK;
    THROW 51041, N''Cambio de estructura del esquema sgc (sistema validado) RECHAZADO: requiere control de cambios. Declare la sesión con sp_set_session_context N''''sgc_ddl_autorizado'''', 1 y el motivo.'', 1;
  END;

  IF OBJECT_ID(N''[sgc].[ddl_event_log]'', N''U'') IS NOT NULL
    INSERT INTO [sgc].[ddl_event_log] ([event_type], [object_type], [object_name], [target_object], [login_name], [host_name], [app_name], [authorized], [motivo], [tsql])
    VALUES (@event, @otype, @oname,
            @e.value(''(/EVENT_INSTANCE/TargetObjectName)[1]'', ''nvarchar(256)''),
            ORIGINAL_LOGIN(), HOST_NAME(), APP_NAME(), @ok,
            LEFT(CAST(SESSION_CONTEXT(N''sgc_ddl_motivo'') AS NVARCHAR(400)), 400),
            @e.value(''(/EVENT_INSTANCE/TSQLCommand/CommandText)[1]'', ''nvarchar(max)''));
END;';
-- [solo-base-real-fin]

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
