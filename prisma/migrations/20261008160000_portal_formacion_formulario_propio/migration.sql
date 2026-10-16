/*
  Migración: FORMACIÓN (Portal TH) — FORMULARIO PROPIO del curso — ADITIVA.

  Pedido de Cristian Baldión (2026-10-08): "toma todas las preguntas que
  están ahí y créame el formulario en el curso, así como el enlace que te
  pasé, pero que sea un formulario propio del curso". Un material de tipo
  'FORM' que se responde DENTRO del portal; las respuestas quedan en SynerLink
  y el material se completa al ENVIAR.

  1. `portal_formulario`            el formulario (código único, versión vigente).
  2. `portal_formulario_version`    definición JSON versionada (preguntas, tipo,
                                    obligatoria, opciones, orden). Nunca se
                                    modifica: editar = versión nueva.
  3. `portal_formulario_respuesta`  una respuesta por persona y material
                                    (índice único), con la versión respondida y
                                    la prueba de la autorización de datos
                                    (Ley 1581 de 2012).
  4. `portal_course_material.formulario_id`  (solo type = 'FORM').
  5. SIEMBRA del primer formulario: SST-01-FR-001 PERFIL SOCIODEMOGRÁFICO SST
     (40 preguntas), generada desde lib/portal/formularios/sst-01-fr-001.json.

  No borra ni modifica datos existentes; NO agrega ni convierte materiales (el
  formulario se agrega al curso aparte con
  prisma/manual/2026-10-08-portal-pruebas-agregar-formulario-sst.sql, después
  del despliegue). Generada MANUALMENTE (sin shadow database — P3014, igual
  que las migraciones anteriores del portal). Correr primero contra
  KRONOSDB_PRUEBAS (.230). Idempotente: se puede correr dos veces.

  Las sentencias que tocan la columna nueva de `portal_course_material` van
  en EXEC: SQL Server compila el lote completo antes de correrlo y fallaría
  al no encontrar la columna en una tabla que ya existe.
*/

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'portal_formulario' AND schema_id = SCHEMA_ID(N'dbo'))
BEGIN
  CREATE TABLE [dbo].[portal_formulario] (
    [id]             INT IDENTITY(1,1) NOT NULL,
    [codigo]         NVARCHAR(60)  NOT NULL,
    [titulo]         NVARCHAR(255) NOT NULL,
    [version_actual] INT           NOT NULL CONSTRAINT [DF_portal_formulario_version_actual] DEFAULT 1,
    [created_by]     NVARCHAR(255) NOT NULL,
    [created_at]     DATETIME2     NOT NULL CONSTRAINT [DF_portal_formulario_created_at] DEFAULT SYSUTCDATETIME(),
    [updated_at]     DATETIME2     NOT NULL CONSTRAINT [DF_portal_formulario_updated_at] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_portal_formulario] PRIMARY KEY CLUSTERED ([id] ASC)
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_formulario]') AND name = N'portal_formulario_codigo_key'
)
  CREATE UNIQUE NONCLUSTERED INDEX [portal_formulario_codigo_key] ON [dbo].[portal_formulario]([codigo] ASC);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'portal_formulario_version' AND schema_id = SCHEMA_ID(N'dbo'))
BEGIN
  CREATE TABLE [dbo].[portal_formulario_version] (
    [id]            INT IDENTITY(1,1) NOT NULL,
    [formulario_id] INT            NOT NULL,
    [version]       INT            NOT NULL,
    [definicion]    NVARCHAR(MAX)  NOT NULL,
    [created_by]    NVARCHAR(255)  NOT NULL,
    [created_at]    DATETIME2      NOT NULL CONSTRAINT [DF_portal_formulario_version_created_at] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_portal_formulario_version] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_portal_formulario_version_formulario] FOREIGN KEY ([formulario_id])
      REFERENCES [dbo].[portal_formulario] ([id]) ON DELETE CASCADE,
    -- La definición debe ser JSON válido (la aplicación la valida además campo por campo).
    CONSTRAINT [CK_portal_formulario_version_definicion_json] CHECK (ISJSON([definicion]) = 1)
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_formulario_version]') AND name = N'portal_formulario_version_formulario_id_version_key'
)
  CREATE UNIQUE NONCLUSTERED INDEX [portal_formulario_version_formulario_id_version_key]
    ON [dbo].[portal_formulario_version]([formulario_id] ASC, [version] ASC);

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'portal_formulario_respuesta' AND schema_id = SCHEMA_ID(N'dbo'))
BEGIN
  CREATE TABLE [dbo].[portal_formulario_respuesta] (
    [id]                    INT IDENTITY(1,1) NOT NULL,
    [material_id]           INT            NOT NULL,
    [formulario_version_id] INT            NOT NULL,
    [student_email]         NVARCHAR(255)  NOT NULL,
    [respuestas]            NVARCHAR(MAX)  NOT NULL,
    [autorizacion_version]  NVARCHAR(60)   NULL,
    [autorizado_at]         DATETIME2      NULL,
    [enviada_at]            DATETIME2      NOT NULL CONSTRAINT [DF_portal_formulario_respuesta_enviada_at] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PK_portal_formulario_respuesta] PRIMARY KEY CLUSTERED ([id] ASC),
    CONSTRAINT [FK_portal_formulario_respuesta_material] FOREIGN KEY ([material_id])
      REFERENCES [dbo].[portal_course_material] ([id]) ON DELETE CASCADE,
    -- NO ACTION: una versión con respuestas no se puede borrar (y evita dos
    -- caminos de cascada, que SQL Server no permite).
    CONSTRAINT [FK_portal_formulario_respuesta_version] FOREIGN KEY ([formulario_version_id])
      REFERENCES [dbo].[portal_formulario_version] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT [CK_portal_formulario_respuesta_json] CHECK (ISJSON([respuestas]) = 1)
  );
END

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_formulario_respuesta]') AND name = N'portal_formulario_respuesta_material_id_student_email_key'
)
  CREATE UNIQUE NONCLUSTERED INDEX [portal_formulario_respuesta_material_id_student_email_key]
    ON [dbo].[portal_formulario_respuesta]([material_id] ASC, [student_email] ASC);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_formulario_respuesta]') AND name = N'portal_formulario_respuesta_formulario_version_id_idx'
)
  CREATE NONCLUSTERED INDEX [portal_formulario_respuesta_formulario_version_id_idx]
    ON [dbo].[portal_formulario_respuesta]([formulario_version_id] ASC);

IF COL_LENGTH(N'dbo.portal_course_material', N'formulario_id') IS NULL
  ALTER TABLE [dbo].[portal_course_material] ADD [formulario_id] INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_portal_course_material_formulario')
  EXEC(N'ALTER TABLE [dbo].[portal_course_material]
    ADD CONSTRAINT [FK_portal_course_material_formulario] FOREIGN KEY ([formulario_id])
      REFERENCES [dbo].[portal_formulario] ([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;');

-- <SIEMBRA-SST>
-- Generado por scripts/portal-th/generar-sql-formulario-sst.py desde
-- lib/portal/formularios/sst-01-fr-001.json. No editar a mano.
IF NOT EXISTS (SELECT 1 FROM [dbo].[portal_formulario] WHERE [codigo] = N'SST-01-FR-001')
BEGIN
  DECLARE @definicion NVARCHAR(MAX) =
    CAST(N'{"formato":1,"codigo":"SST-01-FR-001","titulo":"SST-01-FR-001 PERFIL SOCIODEMOGRÁFICO SST","descripcion":"Perfil sociodemográfico del Sistema de Gestión de Seguridad y Salud en el Trabajo.","datosSensibles":true,"autorizacion":{"version":"AUT-DATOS-SST-2026-10-08-BORRADOR","pendienteValidacion":true,"titulo":"Aviso de privacidad y autorización de tratamiento de datos personales","texto":["En cumplimiento de la Ley 1581 de 2012 y del Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015), le informamos que la empresa del grupo Group Shared Services Latinoamérica con la que usted tiene vínculo laboral, como responsable del tratamiento, recolectará, almacenará, usará y conservará los datos que registre en este formulario con la finalidad de construir el perfil sociodemográfico del Sistema de Gestión de Seguridad y Salud en el Trabajo (SG-SST), planear las actividades de promoción y prevención, atender emergencias y cumplir las obligaciones legales en seguridad y salud en el trabajo.","Este formulario incluye datos SENSIBLES (salud, discapacidad, pertenencia étnica, grupo sanguíneo y RH, hábitos de consumo) y datos de sus familiares y contactos de emergencia. Usted no está obligado(a) a autorizar el tratamiento de datos sensibles ni a responder las preguntas sobre ellos. Al registrar datos de terceros, usted declara que cuenta con su autorización para entregarlos con esta finalidad.","Sus respuestas solo las consultan las personas autorizadas de Talento Humano y del SG-SST, no se publican y se conservan durante el tiempo que exija la normativa de seguridad y salud en el trabajo.","Como titular, usted tiene derecho a conocer, actualizar y rectificar sus datos, solicitar prueba de esta autorización, ser informado(a) sobre su uso, revocar la autorización o pedir la supresión cuando proceda y presentar quejas ante la Superintendencia de Industria y Comercio. Puede ejercerlos a través del área de Talento Humano, conforme a la política de tratamiento de datos personales de la empresa."],"casilla":"He leído el aviso y autorizo de manera previa, expresa e informada el tratamiento de mis datos personales, incluidos los sensibles, para las finalidades descritas."},"preguntas":[{"id":"p01","texto":"CORREO","tipo":"texto","obligatoria":true,"prellenar":"correo"},{"id":"p02","texto":"APELLIDOS Y NOMBRES","tipo":"texto","obligatoria":true,"prellenar":"nombre"},{"id":"p03","texto":"CÉDULA","tipo":"texto","obligatoria":true},{"id":"p04","texto":"EDAD","tipo":"texto","obligatoria":true},{"id":"p05","texto":"SEXO ASIGNADO AL NACER","tipo":"seleccion","opciones":["MASCULINO","FEMENINO"],"obligatoria":true},{"id":"p06","texto":"¿USTED SE RECONOCE CÓMO?","tipo":"seleccion","opciones":["HOMBRE","MUJER","PERSONA NO BINARIA","PREFIERO NO DECIR"],"permiteOtra":true,"obligatoria":true},{"id":"p07","texto":"FECHA DE NACIMIENTO","tipo":"fecha","obligatoria":true},{"id":"p08","texto":"LUGAR DE NACIMIENTO","tipo":"texto","obligatoria":true},{"id":"p09","texto":"ESTADO CIVIL"' AS NVARCHAR(MAX))
    + CAST(N',"tipo":"seleccion","opciones":["CASADO(A)","SOLTERO(A)","UNIÓN LIBRE","VIUDO(A)"],"obligatoria":true},{"id":"p10","texto":"¿PRESENTA ALGUNA DISCAPACIDAD?","tipo":"seleccion","opciones":["SI","NO","PREFIERO NO DECIR"],"obligatoria":true},{"id":"p11","texto":"¿TIPO DE DISCAPACIDAD?","tipo":"seleccion","opciones":["DISCAPACIDAD VISUAL","DISCAPACIDAD MÚLTIPLE","DISCAPACIDAD FÍSICA","DISCAPACIDAD AUDITIVA","SIN DISCAPACIDAD","DISCAPACIDAD PSICOSOCIAL"],"permiteOtra":true,"obligatoria":true},{"id":"p12","texto":"PERTENENCIA ÉTNICA","tipo":"seleccion","opciones":["NINGUNO DE LOS ANTERIORES","AFROCOLOMBIANO/A","PALENQUERO","ROM (GITANO/A)","INDÍGENA"],"permiteOtra":true,"obligatoria":true},{"id":"p13","texto":"NACIONALIDAD","tipo":"seleccion","opciones":["COLOMBIANA","OTRA"],"obligatoria":true},{"id":"p14","texto":"SI SU RESPUESTA ES OTRA, INDIQUE CUAL","tipo":"texto","obligatoria":false},{"id":"p15","texto":"DIRECCIÓN DE RESIDENCIA","tipo":"texto","obligatoria":true},{"id":"p16","texto":"BARRIO","tipo":"texto","obligatoria":true},{"id":"p17","texto":"ESTRATO SOCIO ECONOMICO","tipo":"seleccion","opciones":["ESTRATO 1","ESTRATO 2","ESTRATO 3","ESTRATO 4","ESTRATO 5","ESTRATO 6"],"obligatoria":true},{"id":"p18","texto":"NUMERO DE CELULAR","tipo":"texto","obligatoria":true},{"id":"p19","texto":"RH","tipo":"texto","obligatoria":true},{"id":"p20","texto":"ESCOLARIDAD","tipo":"seleccion","opciones":["BACHILLERATO","TECNICO","TECNOLOGO","PREGRADO","POSGRADO","MAESTRIA","DOCTORADO"],"obligatoria":true},{"id":"p21","texto":"DATOS FAMILIARES (CÓNYUGE) 1-NOMBRE APELLIDOS 2-NUMERO CELULAR, TELÉFONO FIJO 3-EDAD","tipo":"texto","obligatoria":true},{"id":"p22","texto":"DATOS FAMILIARES (PADRE) 1-NOMBRE APELLIDOS 2-NUMERO CELULAR, TELÉFONO FIJO 3-EDAD","tipo":"texto","obligatoria":false},{"id":"p23","texto":"DATOS FAMILIARES (MADRE) 1-NOMBRE APELLIDOS 2-NUMERO CELULAR, TELÉFONO FIJO 3-EDAD","tipo":"texto","obligatoria":false},{"id":"p24","texto":"DATOS FAMILIARES (HIJOS) SI ES MAS DE UN HIJO SEPARE CON / ENTRE CADA HIJO 1-NOMBRE APELLIDOS 2-NUMERO CELULAR, TELÉFONO FIJO 3-EDAD","tipo":"texto","obligatoria":false},{"id":"p25","texto":"POSEE PERSONAS A SU CARGO","tipo":"si_no","obligatoria":true},{"id":"p26","texto":"INDIQUE EL NUMERO DE PERSONAS A SU CARGO, MENCIONE EL PARENTESCO","tipo":"texto","obligatoria":false},{"id":"p27","texto":"RESIDE EN VIVIENDA","tipo":"seleccion","opciones":["PROPIA","ARRIENDO","FAMILIAR"],"obligatoria":true},{"id":"p28","texto":"CUANTO TIEMPO DEMORA DE SU LUGAR DE RESIDENCIA HASTA EL LUGAR DE TRABAJO","tipo":"texto","obligatoria":true},{"id":"p29","texto":"QUE MEDIO DE TRASPORTE UTILIZA PARA DESPLAZARSE DEL LUGAR DE TRABAJO HASTA SU CASA.","tipo":"seleccion","opciones":["A PIE","BICICLETA","MOTO","CARRO","TRANSPORTE PUBLICO"],"obligatoria":true},{"id":"p30","texto":"FUMA","tipo":"seleccion","opciones":["SI","NO"],"obligatoria":true},{"id":"p31","texto":"SI SU RESPUESTA ES SI,CON QUE FRECUENCIA","tipo":"texto","obligatoria":false},{"id":"p32' AS NVARCHAR(MAX))
    + CAST(N'","texto":"CONSUME BEBIDAS ALCOHÓLICAS","tipo":"seleccion","opciones":["SI","NO"],"obligatoria":true},{"id":"p33","texto":"SI SU RESPUESTA ES SI,CON QUE FRECUENCIA","tipo":"texto","obligatoria":false},{"id":"p34","texto":"PRACTICA DEPORTE","tipo":"seleccion","opciones":["SI","NO"],"obligatoria":true},{"id":"p35","texto":"SI SU RESPUESTA ES SI, CUÁL","tipo":"texto","obligatoria":false},{"id":"p36","texto":"CON QUE FRECUENCIA","tipo":"texto","obligatoria":false},{"id":"p37","texto":"CONOCE LOS EJERCICIOS DE PAUSAS ACTIVAS","tipo":"seleccion","opciones":["SI","NO"],"obligatoria":true},{"id":"p38","texto":"SI SU RESPUESTA ES SI,CADA CUANTO LAS PRACTICA?","tipo":"texto","obligatoria":false},{"id":"p39","texto":"HACE CUANTO FUE SU ULTIMA CONSULTA MEDICA?","tipo":"seleccion","opciones":["1- 3 MESES","4 - 5 MESES","MAYOR DE 6 MESES","NO CONSULTÓ"],"obligatoria":true},{"id":"p40","texto":"INFORMACIÓN EN CASO DE EMERGENCIA(NOMBRE,CELULAR, PARENTESCO)","tipo":"texto","obligatoria":true}]}' AS NVARCHAR(MAX));
  DECLARE @formulario TABLE ([id] INT);
  INSERT INTO [dbo].[portal_formulario] ([codigo], [titulo], [version_actual], [created_by])
    OUTPUT INSERTED.[id] INTO @formulario
    VALUES (N'SST-01-FR-001', N'SST-01-FR-001 PERFIL SOCIODEMOGRÁFICO SST', 1, N'migracion-20261008160000');
  INSERT INTO [dbo].[portal_formulario_version] ([formulario_id], [version], [definicion], [created_by])
    SELECT [id], 1, @definicion, N'migracion-20261008160000' FROM @formulario;
END
-- </SIEMBRA-SST>

/*
  REVERSA: prisma/manual/2026-10-08-portal-formulario-propio-reversa.sql (la
  misma de abajo, con un candado si ya hay respuestas). ANTES, si algún
  curso ya tiene el formulario como material, quitarlo con la reversa de
  prisma/manual/2026-10-08-portal-pruebas-agregar-formulario-sst.sql. OJO: borra las
  respuestas de los formularios (datos personales); respáldelas antes si se
  necesitan (exportación a Excel desde el portal).

  IF OBJECT_ID(N'dbo.FK_portal_course_material_formulario', N'F') IS NOT NULL
    ALTER TABLE [dbo].[portal_course_material] DROP CONSTRAINT [FK_portal_course_material_formulario];
  IF COL_LENGTH(N'dbo.portal_course_material', N'formulario_id') IS NOT NULL
    ALTER TABLE [dbo].[portal_course_material] DROP COLUMN [formulario_id];

  DROP TABLE IF EXISTS [dbo].[portal_formulario_respuesta];
  DROP TABLE IF EXISTS [dbo].[portal_formulario_version];
  DROP TABLE IF EXISTS [dbo].[portal_formulario];
*/
