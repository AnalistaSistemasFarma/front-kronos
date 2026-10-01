/*
  REVERSA de la migración 20261001200000_sgc_s6_endurecimiento (SGC, Sprint 6).

  Deja el esquema `sgc` como estaba al cerrar el Sprint 5: quita el trigger de
  base de datos, el registro de cambios de estructura, la tabla de protección
  contra TRUNCATE/DROP, los índices únicos de la cadena de firmas y los tres
  índices de rendimiento, y borra el registro de la migración en
  _prisma_migrations. NO toca datos de negocio del SGC.

  Es un cambio controlado: declara la sesión antes de cada DROP (el trigger de
  protección rechaza DDL destructivo sin esa declaración).

  Correr ANTES que cualquier reversa de S1–S5. Idempotente.
  ⚠️ El contenido de sgc.ddl_event_log se pierde al quitar la tabla: exportarlo
  antes si se necesita como evidencia (el procedimiento de reversa lo exige).
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Reversa de 20261001200000_sgc_s6_endurecimiento';

IF EXISTS (SELECT 1 FROM sys.triggers WHERE name = N'sgc_proteger_esquema' AND parent_class = 0)
  DROP TRIGGER [sgc_proteger_esquema] ON DATABASE;

IF OBJECT_ID(N'[sgc].[ddl_event_log_solo_insercion]', N'TR') IS NOT NULL
  DROP TRIGGER [sgc].[ddl_event_log_solo_insercion];

IF OBJECT_ID(N'[sgc].[ddl_event_log]', N'U') IS NOT NULL
  DROP TABLE [sgc].[ddl_event_log];

IF OBJECT_ID(N'[sgc].[proteccion_registros]', N'U') IS NOT NULL
  DROP TABLE [sgc].[proteccion_registros];

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'signature_cadena_prev_uq' AND object_id = OBJECT_ID(N'[sgc].[signature]'))
  DROP INDEX [signature_cadena_prev_uq] ON [sgc].[signature];

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'signature_cadena_genesis_uq' AND object_id = OBJECT_ID(N'[sgc].[signature]'))
  DROP INDEX [signature_cadena_genesis_uq] ON [sgc].[signature];

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sgc_audit_log_actor_email_action_occurred_at' AND object_id = OBJECT_ID(N'[sgc].[audit_log]'))
  DROP INDEX [IX_sgc_audit_log_actor_email_action_occurred_at] ON [sgc].[audit_log];

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sgc_request_id_document_status' AND object_id = OBJECT_ID(N'[sgc].[request]'))
  DROP INDEX [IX_sgc_request_id_document_status] ON [sgc].[request];

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_sgc_review_alert_id_document_version_alert_key' AND object_id = OBJECT_ID(N'[sgc].[review_alert]'))
  DROP INDEX [IX_sgc_review_alert_id_document_version_alert_key] ON [sgc].[review_alert];

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261001200000_sgc_s6_endurecimiento';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
