/*
  PRUEBAS (KRONOSDB_PRUEBAS, .230) — AGREGA el formulario propio
  SST-01-FR-001 PERFIL SOCIODEMOGRÁFICO SST como un material NUEVO del curso
  "INDUCCIÓN ORGANIZACIONAL - SST" (curso id 2), ubicado ANTES del video
  "INDUCCIÓN SST". Pedido de Cristian Baldión (2026-10-08).

  Reemplaza al script que convertía el material 4 (enlace a Microsoft Forms)
  en el formulario: Cristian pidió expresamente NO borrar ni cambiar el enlace
  de Forms "porque la gente lo sigue usando". Por eso:

  - El material 4 (enlace de Forms) NO se toca: ni tipo, ni URL, ni título, ni
    orden, ni obligatoriedad. El script verifica al final que quedó idéntico.
  - El formulario entra en la posición del primer video vigente del curso y
    ese video, junto con los materiales que vienen después, se corre una
    posición (orden + 1). Orden resultante esperado en PRUEBAS:
      0  PERFIL SOCIODEMOGRÁFICO SST (enlace de Forms, material 4, sin cambios)
      1  SST-01-FR-001 PERFIL SOCIODEMOGRÁFICO SST (formulario propio, NUEVO)
      2  INDUCCIÓN SST (video, material 3)
  - @Obligatorio define si el formulario cuenta para el 100 % del curso.

  ⚠️ Correr SOLO después de desplegar el PR y de aplicar la migración
  20261008160000_portal_formacion_formulario_propio. Se niega a correr fuera
  de KRONOSDB_PRUEBAS. Todo va en una transacción. Idempotente: si el curso ya
  tiene el formulario SST-01-FR-001 vigente, no hace nada.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() <> N'KRONOSDB_PRUEBAS'
  THROW 51221, N'Este script es solo para KRONOSDB_PRUEBAS.', 1;

DECLARE @Curso INT = 2;
DECLARE @MaterialForms INT = 4;
DECLARE @Obligatorio BIT = 1;

BEGIN TRANSACTION;

DECLARE @formulario INT, @titulo NVARCHAR(255);
SELECT @formulario = [id], @titulo = [titulo] FROM [dbo].[portal_formulario] WHERE [codigo] = N'SST-01-FR-001';
IF @formulario IS NULL
  THROW 51222, N'No existe el formulario SST-01-FR-001: aplique antes la migración 20261008160000_portal_formacion_formulario_propio.', 1;

IF NOT EXISTS (SELECT 1 FROM [dbo].[portal_course] WHERE [id] = @Curso AND UPPER([title]) LIKE N'%INDUCCI%SST%')
  THROW 51223, N'El curso 2 no es "INDUCCIÓN ORGANIZACIONAL - SST": revise antes de agregar el formulario.', 1;

-- Antes: queda en el resultado para la bitácora del cambio.
SELECT N'antes' AS [momento], [id], [type], [title], [orden], [required], [formulario_id]
  FROM [dbo].[portal_course_material]
 WHERE [course_id] = @Curso AND [eliminado_at] IS NULL
 ORDER BY [orden], [id];

IF EXISTS (SELECT 1 FROM [dbo].[portal_course_material]
            WHERE [course_id] = @Curso AND [type] = N'FORM' AND [formulario_id] = @formulario AND [eliminado_at] IS NULL)
BEGIN
  PRINT N'El curso ya tiene el formulario propio SST-01-FR-001: no hay nada que hacer.';
  COMMIT TRANSACTION;
  RETURN;
END

-- Foto del enlace de Forms para comprobar al final que no cambió nada.
DECLARE @formsAntes INT = (
  SELECT CHECKSUM([type], [title], [orden], [required], [url], [eliminado_at], [formulario_id])
    FROM [dbo].[portal_course_material]
   WHERE [id] = @MaterialForms AND [course_id] = @Curso);
IF @formsAntes IS NULL
  THROW 51224, N'No se encontró el material 4 (enlace de Forms) en el curso 2: revise antes de agregar el formulario.', 1;

-- Posición del primer video vigente del curso.
DECLARE @ordenVideo INT = (
  SELECT TOP 1 [orden] FROM [dbo].[portal_course_material]
   WHERE [course_id] = @Curso AND [eliminado_at] IS NULL AND [type] = N'DOCUMENT' AND [mime] LIKE N'video/%'
   ORDER BY [orden], [id]);
IF @ordenVideo IS NULL
  THROW 51225, N'El curso 2 no tiene un video vigente: revise antes de agregar el formulario.', 1;

-- Correr el video y lo que sigue no debe arrastrar el enlace de Forms.
IF EXISTS (SELECT 1 FROM [dbo].[portal_course_material]
            WHERE [id] = @MaterialForms AND [orden] >= @ordenVideo)
  THROW 51226, N'El enlace de Forms está después del video: revise el orden antes de agregar el formulario.', 1;

UPDATE [dbo].[portal_course_material]
   SET [orden] = [orden] + 1
 WHERE [course_id] = @Curso AND [eliminado_at] IS NULL AND [orden] >= @ordenVideo AND [id] <> @MaterialForms;

INSERT INTO [dbo].[portal_course_material] ([course_id], [type], [title], [orden], [required], [formulario_id])
VALUES (@Curso, N'FORM', LEFT(@titulo, 255), @ordenVideo, @Obligatorio, @formulario);

IF (SELECT CHECKSUM([type], [title], [orden], [required], [url], [eliminado_at], [formulario_id])
      FROM [dbo].[portal_course_material] WHERE [id] = @MaterialForms) <> @formsAntes
  THROW 51227, N'El enlace de Forms cambió: se deshace todo.', 1;

-- Después.
SELECT N'despues' AS [momento], [id], [type], [title], [orden], [required], [formulario_id]
  FROM [dbo].[portal_course_material]
 WHERE [course_id] = @Curso AND [eliminado_at] IS NULL
 ORDER BY [orden], [id];

COMMIT TRANSACTION;

/*
  REVERSA (solo PRUEBAS): quita el formulario del curso y devuelve el orden.
  Las respuestas enviadas al formulario quedan en portal_formulario_respuesta;
  bórrelas antes (Respuestas → Reabrir) si también deben desaparecer, porque
  la FK de las respuestas impide borrar el material.

  SET XACT_ABORT ON;
  BEGIN TRANSACTION;
  DECLARE @m INT, @o INT;
  SELECT @m = m.[id], @o = m.[orden]
    FROM [dbo].[portal_course_material] m
    JOIN [dbo].[portal_formulario] f ON f.[id] = m.[formulario_id] AND f.[codigo] = N'SST-01-FR-001'
   WHERE m.[course_id] = 2 AND m.[type] = N'FORM' AND m.[eliminado_at] IS NULL;
  IF @m IS NOT NULL
  BEGIN
    DELETE FROM [dbo].[portal_material_progress] WHERE [material_id] = @m;
    DELETE FROM [dbo].[portal_material_vista] WHERE [material_id] = @m;
    DELETE FROM [dbo].[portal_course_material] WHERE [id] = @m;
    UPDATE [dbo].[portal_course_material] SET [orden] = [orden] - 1
     WHERE [course_id] = 2 AND [eliminado_at] IS NULL AND [orden] > @o AND [id] <> 4;
  END
  COMMIT TRANSACTION;
*/
