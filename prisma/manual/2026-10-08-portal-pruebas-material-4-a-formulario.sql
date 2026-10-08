/*
  PRUEBAS (KRONOSDB_PRUEBAS, .230) — convierte el material "PERFIL
  SOCIODEMOGRÁFICO SST" (material id 4) del curso "INDUCCIÓN ORGANIZACIONAL -
  SST" (curso id 2), hoy un ENLACE a Microsoft Forms, en el FORMULARIO PROPIO
  SST-01-FR-001. Pedido de Cristian Baldión (2026-10-08).

  ⚠️ Correr SOLO después de desplegar el PR y de aplicar la migración
  20261008160000_portal_formacion_formulario_propio. NO correr en producción.

  - Conserva la POSICIÓN (orden) y el carácter OBLIGATORIO: no los toca.
  - Conserva la URL de Forms en la columna `url` (el tipo FORM la ignora): así
    la reversa devuelve el material exactamente como estaba.
  - Conserva el TÍTULO del material tal como está.
  - NO borra el progreso: quien ya abrió el enlace de Forms antes de este
    cambio sigue con el material completado (se marcó al abrir el enlace).
    Abajo hay un bloque OPCIONAL, comentado, para reiniciar ese progreso si
    Talento Humano quiere que esas personas respondan el formulario propio.

  Seguro: solo actúa si el material 4 sigue siendo el enlace del curso 2 con
  ese título; si no, avisa y no cambia nada. Idempotente.
*/
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @formulario INT = (SELECT [id] FROM [dbo].[portal_formulario] WHERE [codigo] = N'SST-01-FR-001');
IF @formulario IS NULL
  THROW 51211, N'No existe el formulario SST-01-FR-001: aplique antes la migración 20261008160000_portal_formacion_formulario_propio.', 1;

IF EXISTS (SELECT 1 FROM [dbo].[portal_course_material] WHERE [id] = 4 AND [course_id] = 2 AND [type] = N'FORM' AND [formulario_id] = @formulario)
  PRINT N'El material 4 ya es el formulario propio SST-01-FR-001: no hay nada que hacer.';
ELSE IF NOT EXISTS (
  SELECT 1 FROM [dbo].[portal_course_material]
  WHERE [id] = 4 AND [course_id] = 2 AND [type] = N'LINK' AND [eliminado_at] IS NULL
    AND UPPER([title]) LIKE N'%PERFIL SOCIODEMOGR%'
)
  THROW 51212, N'El material 4 no es el enlace "PERFIL SOCIODEMOGRÁFICO SST" vigente del curso 2: revise antes de convertir.', 1;
ELSE
BEGIN
  -- Antes: queda en el resultado para la bitácora del cambio.
  SELECT [id], [course_id], [type], [title], [orden], [required], [url] FROM [dbo].[portal_course_material] WHERE [id] = 4;
  SELECT COUNT(*) AS [personas_con_el_enlace_completado] FROM [dbo].[portal_material_progress] WHERE [material_id] = 4;

  UPDATE [dbo].[portal_course_material]
     SET [type] = N'FORM',
         [formulario_id] = @formulario
   WHERE [id] = 4 AND [course_id] = 2 AND [type] = N'LINK';

  -- Después.
  SELECT [id], [course_id], [type], [title], [orden], [required], [formulario_id] FROM [dbo].[portal_course_material] WHERE [id] = 4;
END

COMMIT TRANSACTION;

/*
  OPCIONAL (decisión de Talento Humano; NO se corre por defecto): reiniciar el
  progreso del material 4 para que quienes lo completaron abriendo el enlace de
  Forms respondan ahora el formulario propio. Un certificado ya emitido NO se
  retira (queda congelado, igual que al desmarcar a mano).

  DELETE p FROM [dbo].[portal_material_progress] p
   WHERE p.[material_id] = 4
     AND NOT EXISTS (SELECT 1 FROM [dbo].[portal_formulario_respuesta] r
                      WHERE r.[material_id] = 4 AND r.[student_email] = p.[student_email]);
*/

/*
  REVERSA (devuelve el material 4 al enlace de Forms: URL, título, orden y
  obligatoriedad nunca se tocaron). Las respuestas que se hayan enviado al
  formulario propio NO se borran: quedan en portal_formulario_respuesta.

  UPDATE [dbo].[portal_course_material]
     SET [type] = N'LINK', [formulario_id] = NULL
   WHERE [id] = 4 AND [course_id] = 2 AND [type] = N'FORM';
*/
