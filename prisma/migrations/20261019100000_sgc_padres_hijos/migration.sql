/*
  Migración: sgc_padres_hijos
  SGC documental — DOCUMENTOS PADRE E HIJOS (reunión con Calidad OLP del
  2026-10-19, RN rn-sgc-documento-padre-sin-padre): el procedimiento es el
  documento padre y no tiene padre; sus formatos e instructivos son los hijos.

  Qué agrega o cambia (100 % ADITIVA, solo en el esquema `sgc`):
    - [sgc].[document_type].[is_parent_type] BIT NOT NULL DEFAULT 0: el tipo
        documental es «padre» (sus documentos no tienen padre y de ellos se
        desprenden los hijos). Todos los tipos quedan en 0: mientras la
        empresa no marque ninguno, el código trata como padre al
        procedimiento (código PR o nombre «Procedimiento…»). Calidad lo marca
        desde Configuración, con motivo.
    - [sgc].[document_relation] restricción document_relation_origen_estado_ck:
        el origen admite además «solicitud» (la relación que se crea sola al
        aprobar un hijo pedido por solicitud) y «carga» (la carga individual
        de un vigente con su padre). Los valores anteriores siguen igual.

  No toca datos: ninguna fila cambia.

  ⚠️ ORDEN DEL PASE: ANTES que el código de la rama feat/sgc-padres-hijos-encabezado.
  Idempotente. Cambio controlado del esquema `sgc` (lo declara en la sesión).

  REVERSA: prisma/manual/2026-10-19-sgc-padres-hijos-reversa.sql
*/

EXEC sp_set_session_context N'sgc_ddl_autorizado', 1;
EXEC sp_set_session_context N'sgc_ddl_motivo', N'Migración 20261019100000_sgc_padres_hijos (documentos padre e hijos)';

IF COL_LENGTH(N'sgc.document_type', N'is_parent_type') IS NULL
  ALTER TABLE [sgc].[document_type] ADD [is_parent_type] BIT NOT NULL CONSTRAINT [document_type_is_parent_type_df] DEFAULT 0;

/* El CHECK del origen se rehace solo si todavía no admite «solicitud». */
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_relation_origen_estado_ck' AND definition NOT LIKE N'%solicitud%')
  ALTER TABLE [sgc].[document_relation] DROP CONSTRAINT [document_relation_origen_estado_ck];
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'document_relation_origen_estado_ck')
  EXEC sp_executesql N'ALTER TABLE [sgc].[document_relation] ADD CONSTRAINT [document_relation_origen_estado_ck] CHECK ([origin] IN (N''manual'', N''codigo'', N''listado'', N''solicitud'', N''carga'') AND [status] IN (N''propuesta'', N''confirmada''));';

EXEC sp_set_session_context N'sgc_ddl_autorizado', NULL;
EXEC sp_set_session_context N'sgc_ddl_motivo', NULL;
