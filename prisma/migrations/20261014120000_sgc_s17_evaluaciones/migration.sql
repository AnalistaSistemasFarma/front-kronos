/*
  Migración: sgc_s17_evaluaciones
  SGC documental — Sprints 17 y 18 del plan del 2026-10-13: EVALUACIONES
  PROPIAS EN SYNERLINK (R30), que conviven con Microsoft Forms y Google Forms.

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`):
    - [sgc].[training_question] y [sgc].[training_option]: banco de preguntas
        (opción única, múltiple y verdadero o falso) que arma el creador del
        documento o Calidad. Se reemplaza mientras nadie ha presentado la
        evaluación; con intentos queda congelado (lo valida el servidor y la
        clave foránea desde las respuestas).
    - [sgc].[training_attempt] y [sgc].[training_answer]: cada intento
        calificado EN EL SERVIDOR, con su huella; SOLO INSERCIÓN (triggers) y
        protegidos contra TRUNCATE/DROP (claves desde
        [sgc].[proteccion_registros]).
    - CHECK de [sgc].[training]: el proveedor de la evaluación admite
        «synerlink» además de «microsoft» y «google».

  ⚠️ ORDEN DEL PASE: después de la del S16 y ANTES que el código del S17.
  Idempotente. Cambio controlado del esquema `sgc` (lo declara en la sesión).

  REVERSA: prisma/manual/2026-10-14-sgc-s17-evaluaciones-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261014120000_sgc_s17_evaluaciones (Sprints 17 y 18)';

BEGIN TRY

BEGIN TRAN;

IF OBJECT_ID(N'[sgc].[training_question]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[training_question] (
      [id_training_question] INT NOT NULL IDENTITY(1,1),
      [id_training] INT NOT NULL,
      [sort_order] INT NOT NULL,
      [kind] NVARCHAR(20) NOT NULL,
      [text] NVARCHAR(1000) NOT NULL,
      [points] DECIMAL(9,2) NOT NULL,
      [created_by] NVARCHAR(255) NOT NULL,
      [created_at] DATETIME2 NOT NULL CONSTRAINT [training_question_created_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [training_question_pkey] PRIMARY KEY CLUSTERED ([id_training_question]),
      CONSTRAINT [training_question_id_training_fkey] FOREIGN KEY ([id_training]) REFERENCES [sgc].[training]([id_training]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [training_question_id_training_idx] ON [sgc].[training_question]([id_training]);
END;

IF OBJECT_ID(N'[sgc].[training_option]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[training_option] (
      [id_training_option] INT NOT NULL IDENTITY(1,1),
      [id_training_question] INT NOT NULL,
      [sort_order] INT NOT NULL,
      [text] NVARCHAR(500) NOT NULL,
      [is_correct] BIT NOT NULL CONSTRAINT [training_option_is_correct_df] DEFAULT 0,
      CONSTRAINT [training_option_pkey] PRIMARY KEY CLUSTERED ([id_training_option]),
      CONSTRAINT [training_option_id_training_question_fkey] FOREIGN KEY ([id_training_question]) REFERENCES [sgc].[training_question]([id_training_question]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [training_option_id_training_question_idx] ON [sgc].[training_option]([id_training_question]);
END;

IF OBJECT_ID(N'[sgc].[training_attempt]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[training_attempt] (
      [id_training_attempt] INT NOT NULL IDENTITY(1,1),
      [id_training] INT NOT NULL,
      [user_email] NVARCHAR(255) NOT NULL,
      [attempt_number] INT NOT NULL,
      [score] DECIMAL(9,2) NOT NULL,
      [max_score] DECIMAL(9,2) NOT NULL,
      [percent] DECIMAL(5,1) NOT NULL,
      [passed] BIT NOT NULL,
      [min_score_pct] DECIMAL(5,2) NOT NULL,
      [bank_sha256] CHAR(64) NOT NULL,
      [record_sha256] CHAR(64) NOT NULL,
      [submitted_at] DATETIME2 NOT NULL,
      [ip] NVARCHAR(64) NULL,
      [user_agent] NVARCHAR(500) NULL,
      CONSTRAINT [training_attempt_pkey] PRIMARY KEY CLUSTERED ([id_training_attempt]),
      CONSTRAINT [training_attempt_id_training_user_email_attempt_number_key] UNIQUE NONCLUSTERED ([id_training], [user_email], [attempt_number]),
      CONSTRAINT [training_attempt_id_training_fkey] FOREIGN KEY ([id_training]) REFERENCES [sgc].[training]([id_training]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
END;

IF OBJECT_ID(N'[sgc].[training_answer]', N'U') IS NULL
BEGIN
  CREATE TABLE [sgc].[training_answer] (
      [id_training_answer] INT NOT NULL IDENTITY(1,1),
      [id_training_attempt] INT NOT NULL,
      [id_training_question] INT NOT NULL,
      [selected_json] NVARCHAR(400) NOT NULL,
      [is_correct] BIT NOT NULL,
      [points] DECIMAL(9,2) NOT NULL,
      CONSTRAINT [training_answer_pkey] PRIMARY KEY CLUSTERED ([id_training_answer]),
      CONSTRAINT [training_answer_id_training_attempt_fkey] FOREIGN KEY ([id_training_attempt]) REFERENCES [sgc].[training_attempt]([id_training_attempt]) ON DELETE NO ACTION ON UPDATE NO ACTION,
      CONSTRAINT [training_answer_id_training_question_fkey] FOREIGN KEY ([id_training_question]) REFERENCES [sgc].[training_question]([id_training_question]) ON DELETE NO ACTION ON UPDATE NO ACTION
  );
  CREATE NONCLUSTERED INDEX [training_answer_id_training_attempt_idx] ON [sgc].[training_answer]([id_training_attempt]);
END;

IF COL_LENGTH(N'sgc.proteccion_registros', N'id_training_attempt') IS NULL
  ALTER TABLE [sgc].[proteccion_registros] ADD [id_training_attempt] INT NULL;
IF COL_LENGTH(N'sgc.proteccion_registros', N'id_training_answer') IS NULL
  ALTER TABLE [sgc].[proteccion_registros] ADD [id_training_answer] INT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'training_question_valores_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[training_question] ADD CONSTRAINT [training_question_valores_ck] CHECK ([kind] IN (N''unica'', N''multiple'', N''vf'') AND [points] > 0 AND LEN([text]) >= 5);';
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'training_attempt_valores_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[training_attempt] ADD CONSTRAINT [training_attempt_valores_ck] CHECK ([attempt_number] BETWEEN 1 AND 5 AND [score] >= 0 AND [score] <= [max_score] AND [percent] BETWEEN 0 AND 100);';

-- El proveedor de la evaluación admite «synerlink» (se reemplaza el CHECK del S10 solo si aún no lo admite).
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'training_intentos_proveedor_ck' AND [definition] NOT LIKE N'%synerlink%')
  ALTER TABLE [sgc].[training] DROP CONSTRAINT [training_intentos_proveedor_ck];
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'training_intentos_proveedor_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[training] ADD CONSTRAINT [training_intentos_proveedor_ck] CHECK ([max_attempts] BETWEEN 1 AND 5 AND ([evaluation_provider] IS NULL OR [evaluation_provider] IN (N''microsoft'', N''google'', N''synerlink'')));';

IF OBJECT_ID(N'[sgc].[proteccion_registros_training_attempt_fk]', N'F') IS NULL
  EXEC sp_executesql N'ALTER TABLE [sgc].[proteccion_registros] ADD CONSTRAINT [proteccion_registros_training_attempt_fk] FOREIGN KEY ([id_training_attempt]) REFERENCES [sgc].[training_attempt]([id_training_attempt]);';
IF OBJECT_ID(N'[sgc].[proteccion_registros_training_answer_fk]', N'F') IS NULL
  EXEC sp_executesql N'ALTER TABLE [sgc].[proteccion_registros] ADD CONSTRAINT [proteccion_registros_training_answer_fk] FOREIGN KEY ([id_training_answer]) REFERENCES [sgc].[training_answer]([id_training_answer]);';

IF OBJECT_ID(N'[sgc].[training_attempt_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[training_attempt_solo_insercion]
ON [sgc].[training_attempt]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51170, N''sgc.training_attempt es de solo inserción: un intento de evaluación no se cambia ni se borra.'', 1;
END;';

IF OBJECT_ID(N'[sgc].[training_answer_solo_insercion]', N'TR') IS NULL
  EXEC sp_executesql N'CREATE TRIGGER [sgc].[training_answer_solo_insercion]
ON [sgc].[training_answer]
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51171, N''sgc.training_answer es de solo inserción: una respuesta de evaluación no se cambia ni se borra.'', 1;
END;';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
