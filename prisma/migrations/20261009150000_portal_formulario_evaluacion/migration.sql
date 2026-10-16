/*
  Migración: FORMACIÓN (Portal TH) — FORMULARIOS TIPO EVALUACIÓN — ADITIVA.

  Pedido de Cristian Baldión (2026-10-09): crear formularios a mano y que el
  formulario sea Encuesta o Evaluación (enunciado, datos de la persona,
  preguntas con respuesta correcta y puntos que suman 100).

  1. `portal_formulario_intento`  cada envío calificado de una evaluación
                                   (aprobado o no), con puntaje y porcentaje.
                                   Solo el intento APROBADO crea además la fila
                                   de `portal_formulario_respuesta` (la que
                                   completa el material); quien reprueba puede
                                   volver a intentar.

  La definición de una evaluación vive en el mismo JSON versionado de
  `portal_formulario_version` (campos `tipo`, `notaMinima`, `puntos`,
  `correcta`): NO cambia ninguna tabla existente. No borra ni modifica datos.

  Generada MANUALMENTE (sin shadow database — P3014, igual que las migraciones
  anteriores del portal). Correr primero contra KRONOSDB_PRUEBAS (.230), ANTES
  del despliegue del código. Idempotente: se puede correr dos veces.
  La REVERSA está al final de este archivo (y en prisma/manual/).
*/

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'portal_formulario_intento' AND schema_id = SCHEMA_ID(N'dbo'))
BEGIN
  CREATE TABLE [dbo].[portal_formulario_intento] (
    [id]                    INT IDENTITY(1,1) NOT NULL,
    [material_id]           INT            NOT NULL,
    [formulario_version_id] INT            NOT NULL,
    [student_email]         NVARCHAR(255)  NOT NULL,
    [respuestas]            NVARCHAR(MAX)  NOT NULL,
    [puntaje]               FLOAT(53)      NOT NULL,
    [puntaje_max]           FLOAT(53)      NOT NULL,
    [porcentaje]            FLOAT(53)      NOT NULL,
    [aprobado]              BIT            NOT NULL,
    [enviado_at]            DATETIME2      NOT NULL CONSTRAINT [DF_portal_formulario_intento_enviado_at] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_portal_formulario_intento] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_portal_formulario_intento_material] FOREIGN KEY ([material_id])
      REFERENCES [dbo].[portal_course_material] ([id]) ON DELETE CASCADE,
    -- NO ACTION: una versión con intentos no se puede borrar (y evita dos caminos de cascada).
    CONSTRAINT [FK_portal_formulario_intento_version] FOREIGN KEY ([formulario_version_id])
      REFERENCES [dbo].[portal_formulario_version] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [CK_portal_formulario_intento_json] CHECK (ISJSON([respuestas]) = 1)
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_formulario_intento]') AND name = N'portal_formulario_intento_material_id_student_email_idx'
)
  CREATE NONCLUSTERED INDEX [portal_formulario_intento_material_id_student_email_idx]
    ON [dbo].[portal_formulario_intento]([material_id] ASC, [student_email] ASC);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_formulario_intento]') AND name = N'portal_formulario_intento_formulario_version_id_idx'
)
  CREATE NONCLUSTERED INDEX [portal_formulario_intento_formulario_version_id_idx]
    ON [dbo].[portal_formulario_intento]([formulario_version_id] ASC);

/*
  ───────────────────────────── REVERSA ─────────────────────────────
  ⚠️ El código desplegado debe volver ANTES a la versión anterior.
  ⚠️ Si ya hay INTENTOS (datos personales, Ley 1581 de 2012), se niega salvo
  que la sesión declare portal_reversa_intentos = 1. Expórtelos antes.

IF OBJECT_ID(N'[dbo].[portal_formulario_intento]', N'U') IS NOT NULL
BEGIN
  DECLARE @intentos INT = 0;
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[portal_formulario_intento]', N'@n INT OUTPUT', @n = @intentos OUTPUT;
  IF @intentos > 0 AND TRY_CAST(SESSION_CONTEXT(N'portal_reversa_intentos') AS INT) IS NULL
    THROW 51203, N'Hay intentos de evaluaciones (datos personales): expórtelos y declare portal_reversa_intentos = 1 antes de la reversa.', 1;
END

DROP TABLE IF EXISTS [dbo].[portal_formulario_intento];

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261009150000_portal_formulario_evaluacion';
*/
