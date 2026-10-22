/*
  Migración: sgc_s19_generador_sin_codificacion
  SGC documental — Sprint 19 del plan del 2026-10-13: el GENERADOR DE
  DOCUMENTOS queda solo para documentos SIN CODIFICACIÓN (R34, RN de Calidad
  OLP del 2026-10-13: «los que sí llevan codificación tienen que ir por la
  solicitud»).

  Qué agrega (100 % ADITIVA, solo en el esquema `sgc`):
    - [sgc].[document_type].[generator_guide] BIT NOT NULL DEFAULT 0: el tipo
        documental es de PLANTILLAS GUÍA del Generador. Solo un vigente de un
        tipo marcado puede ser origen de una plantilla; lo que se genera NO
        lleva código documental (se identifica con un consecutivo de registro
        «GEN-…» y la trazabilidad a la plantilla). Todos los tipos quedan en 0:
        Calidad marca el suyo desde Configuración, con motivo.

  ⚠️ ORDEN DEL PASE: después de 20261010100000_sgc_generador_plantillas y
  ANTES que el código del S19. Idempotente. Cambio controlado del esquema
  `sgc` (lo declara en la sesión).

  REVERSA: prisma/manual/2026-10-14-sgc-s19-generador-sin-codificacion-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261014130000_sgc_s19_generador_sin_codificacion (Sprint 19)';

IF COL_LENGTH(N'sgc.document_type', N'generator_guide') IS NULL
  ALTER TABLE [sgc].[document_type] ADD [generator_guide] BIT NOT NULL CONSTRAINT [document_type_generator_guide_df] DEFAULT 0;

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
