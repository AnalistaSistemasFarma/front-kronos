/*
  PRUEBAS (KRONOSDB_PRUEBAS, .230) — AGREGA la evaluación "Evaluación Inducción
  Organizacional y SST Farmalógica SA 2025" como un material NUEVO, al final
  del curso "INDUCCIÓN ORGANIZACIONAL - SST" (curso id 2). Pedido de Cristian
  Baldión (2026-10-09): "toma ese enlace y créame el primer formulario tipo
  Evaluación en el curso de INDUCCIÓN ORGANIZACIONAL - SST".

  Las 10 preguntas son las del Microsoft Forms que pasó Cristian (con 3 erratas
  evidentes corregidas: "ARL,diligenciar", "l único punto" y "Responsalidad").
  Las 10 respuestas correctas las validó Cristian (2026-10-09): la 7 (opción b)
  y la 10 ("1 año") las dio él; las otras 8 eran propuestas de Senhatsumi que
  él confirmó. La evaluación entra PUBLICADA (sin borrador).
  Definición: lib/portal/formularios/eva-induccion-sst-2025.json (el test
  evaluacion-induccion-sst.test.ts comprueba que este SQL trae la misma).

  ⚠️ Correr SOLO después de aplicar la migración
  20261009150000_portal_formulario_evaluacion Y de DESPLEGAR el código (con el
  código anterior, una evaluación se mostraría como una encuesta y se enviarían las respuestas correctas al navegador). Se
  niega a correr fuera de KRONOSDB_PRUEBAS. Todo va en una transacción.
  Idempotente: si el curso ya tiene la evaluación, no hace nada.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() <> N'KRONOSDB_PRUEBAS'
  THROW 51231, N'Este script es solo para KRONOSDB_PRUEBAS.', 1;

DECLARE @Curso INT = 2;
DECLARE @Obligatorio BIT = 1;
DECLARE @Codigo NVARCHAR(60) = N'EVA-INDUCCION-SST-2025';

IF OBJECT_ID(N'[dbo].[portal_formulario_intento]', N'U') IS NULL
  THROW 51232, N'Falta la migración 20261009150000_portal_formulario_evaluacion: aplíquela antes.', 1;

IF NOT EXISTS (SELECT 1 FROM [dbo].[portal_course] WHERE [id] = @Curso AND UPPER([title]) LIKE N'%INDUCCI%SST%')
  THROW 51233, N'El curso 2 no es "INDUCCIÓN ORGANIZACIONAL - SST": revise antes de agregar la evaluación.', 1;

BEGIN TRANSACTION;

SELECT N'antes' AS [momento], [id], [type], [title], [orden], [required], [formulario_id]
  FROM [dbo].[portal_course_material]
 WHERE [course_id] = @Curso AND [eliminado_at] IS NULL
 ORDER BY [orden], [id];

DECLARE @formulario INT = (SELECT [id] FROM [dbo].[portal_formulario] WHERE [codigo] = @Codigo);

IF @formulario IS NULL
BEGIN
  DECLARE @definicion NVARCHAR(MAX) = N'{"formato":1,"codigo":"EVA-INDUCCION-SST-2025","titulo":"Evaluación Inducción Organizacional y SST Farmalógica SA 2025","descripcion":"A continuación encontrará 10 preguntas de selección múltiple con única respuesta: seleccione la opción que considere correcta. Puntaje mínimo para aprobar la evaluación: 80 % (8 de 10 preguntas).","datosSensibles":true,"autorizacion":{"version":"AUT-DATOS-FORMULARIOS-2026-10-09-BORRADOR","titulo":"Aviso de privacidad y autorización de tratamiento de datos personales","texto":["En cumplimiento de la Ley 1581 de 2012 y del Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015), le informamos que la empresa del grupo Group Shared Services Latinoamérica con la que usted tiene vínculo laboral, como responsable del tratamiento, recolectará, almacenará, usará y conservará los datos que registre en este formulario (nombre, correo y número de documento) con la finalidad de gestionar su formación, dejar constancia de su participación y de su resultado y cumplir las obligaciones legales en seguridad y salud en el trabajo.","Sus respuestas solo las consultan las personas autorizadas de Talento Humano y del SG-SST, no se publican y se conservan durante el tiempo que exija la normativa aplicable.","Como titular, usted tiene derecho a conocer, actualizar y rectificar sus datos, solicitar prueba de esta autorización, ser informado(a) sobre su uso, revocar la autorización o pedir la supresión cuando proceda y presentar quejas ante la Superintendencia de Industria y Comercio. Puede ejercerlos a través del área de Talento Humano, conforme a la política de tratamiento de datos personales de la empresa."],"casilla":"He leído el aviso y autorizo de manera previa, expresa e informada el tratamiento de mis datos personales para las finalidades descritas.","pendienteValidacion":true},"tipo":"evaluacion","notaMinima":80,"preguntas":[{"id":"dato_nombre","texto":"Nombre completo","tipo":"texto","obligatoria":true,"prellenar":"nombre"},{"id":"dato_cedula","texto":"Número de cédula","tipo":"texto","obligatoria":true},{"id":"q1","texto":"Según el reglamento de Higiene y Seguridad Industrial, ¿cuáles son los principales riesgos existentes en Farmalogica S.A.?","tipo":"seleccion","obligatoria":true,"opciones":["Mecánico, trabajo en alturas, químico, biomecánico, físico y psicosocial","Solo riesgos químicos y biológicos","Únicamente riesgos biomecánicos y fenómenos naturales","Riesgos psicosociales exclusivamente"],"puntos":10,"correcta":0},{"id":"q2","texto":"¿Cuáles son las prohibiciones establecidas en la política de prevención de alcohol, tabaco y sustancias psicoactivas?","tipo":"seleccion","obligatoria":true,"opciones":["Solo está prohibido el consumo de alcohol durante la jornada laboral","Está prohibido el consumo, pero se permite presentarse al trabajo con efectos residuales","No está permitido el consumo antes y durante la jornada laboral, presentarse bajo influencia, ni posesión/venta dentro de las instalaciones","Solo está prohibido el consumo dentro de las instalaciones"],"puntos":10,"correcta":2},{"id":"q3","texto":"¿Qué es un accidente de trabajo según la información proporcionada en el documento?","tipo":"seleccion","obligatoria":true,"opciones":["Cualquier lesión que ocurra al empleado, independientemente del lugar y circunstancia","Todo acontecimiento repentino que suceda por causa o con ocasión del trabajo que cause lesión, perturbación funcional, invalidez o muerte","Solo aquellos eventos que ocurren dentro de las instalaciones de la empresa","Lesiones que se producen exclusivamente por manipulación de equipos específicos"],"puntos":10,"correcta":1},{"id":"q4","texto":"Si ocurre un accidente de trabajo, ¿cuál es el procedimiento correcto para reportarlo en Farmalogica S.A.?","tipo":"seleccion","obligatoria":true,"opciones":["Reportarlo directamente a la ARL sin informar a la empresa","Reportarlo al finalizar la semana laboral","Esperar a que el trabajador se recupere para realizar el reporte","Reportarlo inmediatamente al jefe directo, generar reporte a la ARL, diligenciar el formato, informar al área de SST"],"puntos":10,"correcta":3},{"id":"q5","texto":"¿Cuáles son las responsabilidades de los trabajadores ante el Sistema de Gestión de Seguridad y Salud en el Trabajo (SG-SST)?","tipo":"seleccion","obligatoria":true,"opciones":["Solo realizar pausas activas diariamente","Procurar el cuidado de su salud, suministrar información sobre su estado de salud, cumplir normas y participar en identificación de peligros","Únicamente reportar accidentes cuando ocurran","Solamente cumplir con el uso de EPP cuando se lo indiquen"],"puntos":10,"correcta":1},{"id":"q6","texto":"En relación con la prevención del riesgo químico y el Sistema Globalmente Armonizado (SGA) en Farmalogica S.A., seleccione la opción que incluye correctamente todas las medidas y procedimientos establecidos:","tipo":"seleccion","obligatoria":true,"opciones":["La plataforma SOLUQUIM permite únicamente el etiquetado de productos químicos; las fichas de seguridad (FDS) deben solicitarse por correo electrónico; es permitido trabajar con productos sin etiqueta de SOLUQUIM; y no es necesario diligenciar permisos de trabajo para desinfección y limpieza.","En cumplimiento de la resolución 773 de 2021, Farmalogica utiliza la plataforma SOLUQUIM que permite inventariar productos químicos, acceder a fichas de seguridad (FDS) y generar etiquetas; se deben utilizar los EPP indicados en las FDS; los productos químicos deben almacenarse según matriz de compatibilidad; y debe diligenciarse el permiso de trabajo SST-04-FR-023 antes de iniciar trabajos de desinfección y limpieza.","La prevención del riesgo químico solo aplica para el personal de laboratorio; no es obligatorio que todos los productos estén etiquetados; la plataforma SOLUQUIM solo permite acceder a las fichas de seguridad; y los EPP se utilizan a criterio del trabajador.","Farmalogica utiliza SOLUQUIM para cumplir con el SGA, pero solo permite el inventario de productos; no es necesario seguir la matriz de compatibilidad para almacenamiento; y los permisos de trabajo solo aplican para tareas en espacios confinados"],"puntos":10,"correcta":1},{"id":"q7","texto":"¿Cuáles son los puntos de encuentro designados en caso de evacuación para las diferentes sedes de Farmalogica S.A.?","tipo":"seleccion","obligatoria":true,"opciones":["Para todas las sedes, el punto de encuentro es la Bahía Arbofarma","Para la sede administrativa: Bahía Arbofarma; para la sede planta: Bahía Copetran","El único punto de encuentro es la entrada principal de cada sede","Para la sede administrativa: Bahía Copetran; para la sede operativa: Bahía Arbofarma"],"puntos":10,"correcta":1},{"id":"q8","texto":"Seleccione la opción correcta según el siguiente enunciado: Debo registrar mi huella en el biométrico cuando en el turno:","tipo":"seleccion","obligatoria":true,"opciones":["Ingreso, voy y regreso del break y salgo","Voy y regreso del baño","No debo registrar la huella","Ninguna de las anteriores"],"puntos":10,"correcta":0},{"id":"q9","texto":"¿Cuál de los siguientes valores no es corporativo?","tipo":"seleccion","obligatoria":true,"opciones":["Responsabilidad","Tolerancia","Honestidad","Respeto"],"puntos":10,"correcta":1},{"id":"q10","texto":"¿Con cuánto tiempo de vinculación a la compañía puedo solicitar mis vacaciones?","tipo":"seleccion","obligatoria":true,"opciones":["15 días","6 meses","1 año","2 años"],"puntos":10,"correcta":2}]}';
  DECLARE @nuevo TABLE ([id] INT);
  INSERT INTO [dbo].[portal_formulario] ([codigo], [titulo], [version_actual], [created_by])
    OUTPUT INSERTED.[id] INTO @nuevo
    VALUES (@Codigo, N'Evaluación Inducción Organizacional y SST Farmalógica SA 2025', 1, N'senhatsumi-20261009');
  INSERT INTO [dbo].[portal_formulario_version] ([formulario_id], [version], [definicion], [created_by])
    SELECT [id], 1, @definicion, N'senhatsumi-20261009' FROM @nuevo;
  SELECT @formulario = [id] FROM @nuevo;
END

IF EXISTS (SELECT 1 FROM [dbo].[portal_course_material]
            WHERE [course_id] = @Curso AND [type] = N'FORM' AND [formulario_id] = @formulario AND [eliminado_at] IS NULL)
BEGIN
  PRINT N'El curso ya tiene la evaluación: no hay nada que hacer.';
  COMMIT TRANSACTION;
  RETURN;
END

INSERT INTO [dbo].[portal_course_material] ([course_id], [type], [title], [orden], [required], [formulario_id])
VALUES (
  @Curso,
  N'FORM',
  N'Evaluación Inducción Organizacional y SST Farmalógica SA 2025',
  ISNULL((SELECT MAX([orden]) FROM [dbo].[portal_course_material] WHERE [course_id] = @Curso AND [eliminado_at] IS NULL), -1) + 1,
  @Obligatorio,
  @formulario);

SELECT N'despues' AS [momento], [id], [type], [title], [orden], [required], [formulario_id]
  FROM [dbo].[portal_course_material]
 WHERE [course_id] = @Curso AND [eliminado_at] IS NULL
 ORDER BY [orden], [id];

COMMIT TRANSACTION;

/*
  REVERSA (solo PRUEBAS): quita la evaluación del curso y su definición.
  Si ya hay intentos o respuestas (datos personales), exporte/borre antes: las
  FK impiden borrar el material y la versión.

  SET XACT_ABORT ON;
  BEGIN TRANSACTION;
  DECLARE @f INT = (SELECT [id] FROM [dbo].[portal_formulario] WHERE [codigo] = N'EVA-INDUCCION-SST-2025');
  IF @f IS NOT NULL
  BEGIN
    DELETE FROM [dbo].[portal_material_progress] WHERE [material_id] IN (SELECT [id] FROM [dbo].[portal_course_material] WHERE [formulario_id] = @f);
    DELETE FROM [dbo].[portal_course_material] WHERE [formulario_id] = @f;
    DELETE FROM [dbo].[portal_formulario] WHERE [id] = @f;
  END
  COMMIT TRANSACTION;
*/
