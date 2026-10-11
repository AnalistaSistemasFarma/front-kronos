/*
  Migración: sgc_s3_firma_pdf_calidad
  SGC documental — Sprint 3 (firma electrónica propia, PDF controlado,
  lista de chequeo de Calidad y edición en la app del borrador), 2026-09-30.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`; no toca ninguna tabla
  de `dbo` — el diff de Prisma contra el esquema del S2 solo trae cambios en
  `sgc`):
    - [sgc].[signature]          firmas electrónicas del SGC (SOLO INSERCIÓN):
                                 significado, motivo, sello de tiempo del
                                 servidor, hash del contenido firmado, método
                                 de reautenticación, evidencia en el espacio
                                 de la empresa y encadenamiento (record_hash)
    - [sgc].[signature_consent]  aceptación del consentimiento legal (SOLO INSERCIÓN)
    - [sgc].[signature_master]   maestro de firmas de Calidad (no se borra: se revoca)
    - [sgc].[draft_revision]     revisiones del borrador editado en la app (SOLO INSERCIÓN)
    - [sgc].[quality_check]      lista de chequeo de Calidad (SOLO INSERCIÓN)
    - Columnas nuevas (todas NULL o con DEFAULT):
        document_version.id_request / signed_content_sha256 / manifest_json
        flow_form_field.quality_check (BIT, 0)
        request.id_document_version / controlled_pdf_status / controlled_pdf_error
        task_assignee.id_signature
    - Datos: los puntos de firma del S2 pasan de «pendiente_s3» a «pendiente»
      (aún por firmar) o a «sin_firma_s2» (se decidieron en el S2, antes de
      que existiera la firma propia: quedan marcados, no se falsean).
    - Triggers de solo inserción en signature, signature_consent,
      draft_revision y quality_check; signature_master rechaza DELETE y solo
      admite UPDATE de las columnas de revocación.

  La SIN dependencia de Orión es de diseño: ninguna tabla referencia a
  ORIONDB ni a dbo.orion_document_event.

  Los DATOS (flujo documental v2 con la lista de chequeo de Calidad de OLP)
  van en prisma/manual/2026-09-30-sgc-s3-firma-calidad-olp.sql.

  ⚠️ ORDEN DEL PASE: va ANTES que el código (Prisma lee los modelos nuevos).
  Idempotente: cada bloque verifica si el objeto ya existe.

  REVERSA: prisma/manual/2026-09-30-sgc-s3-firma-reversa.sql
*/

BEGIN TRY

BEGIN TRAN;

IF COL_LENGTH(N'[sgc].[document_version]', N'id_request') IS NULL
  ALTER TABLE [sgc].[document_version] ADD [id_request] INT, [manifest_json] NVARCHAR(max), [signed_content_sha256] CHAR(64);

IF COL_LENGTH(N'[sgc].[flow_form_field]', N'quality_check') IS NULL
  ALTER TABLE [sgc].[flow_form_field] ADD [quality_check] BIT NOT NULL CONSTRAINT [flow_form_field_quality_check_df] DEFAULT 0;

IF COL_LENGTH(N'[sgc].[request]', N'id_document_version') IS NULL
  ALTER TABLE [sgc].[request] ADD [controlled_pdf_error] NVARCHAR(1000), [controlled_pdf_status] NVARCHAR(20), [id_document_version] INT;

IF COL_LENGTH(N'[sgc].[task_assignee]', N'id_signature') IS NULL
  ALTER TABLE [sgc].[task_assignee] ADD [id_signature] INT;

IF OBJECT_ID(N'[sgc].[signature]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[signature] (
      [id_signature] INT NOT NULL IDENTITY(1,1),
      [signature_uid] CHAR(36) NOT NULL,
      [id_company] INT NOT NULL,
      [id_request] INT NOT NULL,
      [id_task] INT NOT NULL,
      [id_task_assignee] INT NOT NULL,
      [signer_email] NVARCHAR(255) NOT NULL,
      [signer_name] NVARCHAR(255),
      [meaning] NVARCHAR(20) NOT NULL,
      [reason] NVARCHAR(1000) NOT NULL,
      [signed_at] DATETIME2 NOT NULL,
      [content_kind] NVARCHAR(30) NOT NULL,
      [content_ref] NVARCHAR(60) NOT NULL,
      [content_name] NVARCHAR(260) NOT NULL,
      [content_sha256] CHAR(64) NOT NULL,
      [auth_method] NVARCHAR(40) NOT NULL,
      [consent_version] NVARCHAR(60) NOT NULL,
      [id_signature_master] INT,
      [master_sha256] CHAR(64),
      [ip] NVARCHAR(64),
      [user_agent] NVARCHAR(400),
      [evidence_item_id] NVARCHAR(200) NOT NULL,
      [evidence_path] NVARCHAR(600) NOT NULL,
      [evidence_sha256] CHAR(64) NOT NULL,
      [prev_record_hash] CHAR(64),
      [record_hash] CHAR(64) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [signature_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [signature_pkey] PRIMARY KEY CLUSTERED ([id_signature]),
      CONSTRAINT [signature_signature_uid_key] UNIQUE NONCLUSTERED ([signature_uid]),
      CONSTRAINT [signature_record_hash_key] UNIQUE NONCLUSTERED ([record_hash])
  );

  CREATE NONCLUSTERED INDEX [signature_id_company_id_signature_idx] ON [sgc].[signature]([id_company], [id_signature]);
  CREATE NONCLUSTERED INDEX [signature_id_request_idx] ON [sgc].[signature]([id_request]);
  CREATE NONCLUSTERED INDEX [signature_signer_email_idx] ON [sgc].[signature]([signer_email]);
  ALTER TABLE [sgc].[signature] ADD CONSTRAINT [signature_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [sgc].[signature] ADD CONSTRAINT [signature_id_task_assignee_fkey] FOREIGN KEY ([id_task_assignee]) REFERENCES [sgc].[task_assignee]([id_task_assignee]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[signature_consent]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[signature_consent] (
      [id_signature_consent] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [consent_version] NVARCHAR(60) NOT NULL,
      [text_sha256] CHAR(64) NOT NULL,
      [accepted_at] DATETIME2 NOT NULL,
      [ip] NVARCHAR(64),
      [user_agent] NVARCHAR(400),
      CONSTRAINT [signature_consent_pkey] PRIMARY KEY CLUSTERED ([id_signature_consent]),
      CONSTRAINT [signature_consent_id_company_user_email_consent_version_key] UNIQUE NONCLUSTERED ([id_company],[user_email],[consent_version])
  );

  ALTER TABLE [sgc].[signature_consent] ADD CONSTRAINT [signature_consent_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[signature_master]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[signature_master] (
      [id_signature_master] INT NOT NULL IDENTITY(1,1),
      [id_company] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [version_number] INT NOT NULL,
      [image_png] NVARCHAR(max) NOT NULL,
      [image_sha256] CHAR(64) NOT NULL,
      [registered_by] NVARCHAR(255) NOT NULL,
      [registered_at] DATETIME2 NOT NULL,
      [reason] NVARCHAR(1000) NOT NULL,
      [revoked_at] DATETIME2,
      [revoked_by] NVARCHAR(255),
      [revoke_reason] NVARCHAR(1000),
      CONSTRAINT [signature_master_pkey] PRIMARY KEY CLUSTERED ([id_signature_master]),
      CONSTRAINT [signature_master_id_company_user_email_version_number_key] UNIQUE NONCLUSTERED ([id_company],[user_email],[version_number])
  );

  ALTER TABLE [sgc].[signature_master] ADD CONSTRAINT [signature_master_id_company_fkey] FOREIGN KEY ([id_company]) REFERENCES [sgc].[company_config]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[draft_revision]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[draft_revision] (
      [id_draft_revision] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [revision_number] INT NOT NULL,
      [origin] NVARCHAR(20) NOT NULL,
      [origin_ref] NVARCHAR(200),
      [content_html] NVARCHAR(max) NOT NULL,
      [sha256] CHAR(64) NOT NULL,
      [size_bytes] INT NOT NULL,
      [note] NVARCHAR(500),
      [saved_by] NVARCHAR(255) NOT NULL,
      [saved_at] DATETIME2 NOT NULL,
      CONSTRAINT [draft_revision_pkey] PRIMARY KEY CLUSTERED ([id_draft_revision]),
      CONSTRAINT [draft_revision_id_request_revision_number_key] UNIQUE NONCLUSTERED ([id_request],[revision_number])
  );

  ALTER TABLE [sgc].[draft_revision] ADD CONSTRAINT [draft_revision_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF OBJECT_ID(N'[sgc].[quality_check]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[quality_check] (
      [id_quality_check] INT NOT NULL IDENTITY(1,1),
      [id_request] INT NOT NULL,
      [id_task] INT NOT NULL,
      [id_task_assignee] INT NOT NULL,
      [id_signature] INT,
      [items_json] NVARCHAR(max) NOT NULL,
      [result] NVARCHAR(20) NOT NULL,
      [checked_by] NVARCHAR(255) NOT NULL,
      [checked_at] DATETIME2 NOT NULL,
      CONSTRAINT [quality_check_pkey] PRIMARY KEY CLUSTERED ([id_quality_check])
  );

  CREATE NONCLUSTERED INDEX [quality_check_id_request_idx] ON [sgc].[quality_check]([id_request]);
  ALTER TABLE [sgc].[quality_check] ADD CONSTRAINT [quality_check_id_request_fkey] FOREIGN KEY ([id_request]) REFERENCES [sgc].[request]([id_request]) ON DELETE NO ACTION ON UPDATE NO ACTION;
  ALTER TABLE [sgc].[quality_check] ADD CONSTRAINT [quality_check_id_task_assignee_fkey] FOREIGN KEY ([id_task_assignee]) REFERENCES [sgc].[task_assignee]([id_task_assignee]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

/* Estados de firma y resultado de la lista de chequeo (catálogo cerrado). */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'signature_meaning_ck')
  ALTER TABLE [sgc].[signature] ADD CONSTRAINT [signature_meaning_ck]
    CHECK ([meaning] IN (N'elaboro', N'reviso', N'aprobo', N'leyo', N'capacito') AND LEN([reason]) >= 5);

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'quality_check_result_ck')
  ALTER TABLE [sgc].[quality_check] ADD CONSTRAINT [quality_check_result_ck]
    CHECK ([result] IN (N'conforme', N'no_conforme'));

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH;

/*
  Datos del S2: los puntos de firma quedaron como «pendiente_s3». Los que aún
  esperan decisión pasan a «pendiente» (se firmarán con la firma propia); los
  que se decidieron en el S2 pasan a «sin_firma_s2» (se decidieron con la
  sesión, sin firma electrónica: se deja constancia, no se inventa una firma).
  Idempotente (solo toca filas con el valor viejo). Lote aparte: la columna
  id_signature debe existir antes de compilar este UPDATE.
*/
EXEC sp_executesql N'UPDATE [sgc].[task_assignee]
  SET signature_status = CASE WHEN status = N''pendiente'' THEN N''pendiente'' ELSE N''sin_firma_s2'' END
  WHERE signature_status = N''pendiente_s3'';';

/*
  Firmas, consentimientos, revisiones del borrador y listas de chequeo
  INMODIFICABLES: el trigger INSTEAD OF rechaza cualquier UPDATE o DELETE.
  El maestro de firmas no se borra y solo admite la REVOCACIÓN (las columnas
  del trazo, su hash, a quién pertenece y quién lo registró no cambian).
*/
IF OBJECT_ID(N'[sgc].[signature_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[signature_solo_insercion]
ON [sgc].[signature]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51003, N''sgc.signature es de solo inserción: una firma electrónica no se modifica ni se borra.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[signature_consent_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[signature_consent_solo_insercion]
ON [sgc].[signature_consent]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51004, N''sgc.signature_consent es de solo inserción: la aceptación del consentimiento no se modifica ni se borra.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[draft_revision_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[draft_revision_solo_insercion]
ON [sgc].[draft_revision]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51005, N''sgc.draft_revision es de solo inserción: cada guardado del borrador es una revisión nueva.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[quality_check_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[quality_check_solo_insercion]
ON [sgc].[quality_check]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51006, N''sgc.quality_check es de solo inserción: la lista de chequeo de Calidad no se modifica ni se borra.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[signature_master_sin_borrado]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[signature_master_sin_borrado]
ON [sgc].[signature_master]
INSTEAD OF DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51007, N''sgc.signature_master no se borra: una firma registrada se revoca con motivo.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[signature_master_solo_revocacion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[signature_master_solo_revocacion]
ON [sgc].[signature_master]
AFTER UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  IF UPDATE(image_png) OR UPDATE(image_sha256) OR UPDATE(user_email) OR UPDATE(id_company) OR UPDATE(version_number) OR UPDATE(registered_by) OR UPDATE(registered_at) OR UPDATE(reason)
     OR EXISTS (SELECT 1 FROM deleted d WHERE d.revoked_at IS NOT NULL)
    THROW 51008, N''sgc.signature_master solo admite revocar una firma vigente (una vez); el trazo registrado no cambia.'', 1;
END;';
