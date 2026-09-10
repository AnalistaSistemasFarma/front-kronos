/*
  Parametrización de "Gestión Documental" (id_process_category = 86) con el mecanismo
  GENÉRICO de campos de proceso (process_form_field / process_form_field_option) que
  usan TODOS los demás procesos de SynerLink -- pedido explícito de Nicolás tras revisar
  el Sprint 5, donde estos campos (tipo de documento, código, próxima fecha de revisión,
  restringido) vivían hardcodeados en un formulario aparte
  (app/(hub)/process/request-general/create-request/page.tsx, Card "Datos del documento")
  en vez de leerse dinámicamente como cualquier otro campo de proceso.

  Con este seed, create-request/page.tsx los renderiza y valida con el MISMO bloque
  genérico "Información adicional" (visibleFields) que ya usa cualquier proceso -- ver
  app/api/requests-general/process-fields/route.js. El servidor
  (app/api/document-management/create-request/route.ts vía
  lib/document-management/genericFields.ts) resuelve esos valores genéricos
  (id_field/id_option/value_text) a los parámetros concretos que sigue necesitando
  createDocumentAndStartWorkflow (workflowEngine.ts) -- companyId, documentTypeId, code,
  dueReviewDate, isRestricted -- y ADEMÁS los persiste tal cual en request_form_value
  (misma tabla que cualquier otro proceso), para que aparezcan en
  /api/requests-general/request-form-values como en cualquier otra solicitud.

  Las opciones de "Tipo de documento" se generan a partir de document_type (is_active=1).
  El POST de /api/document-management/types ya sincroniza la opción nueva automáticamente
  al crear un tipo de documento; este script solo hace falta re-correrlo si se necesita
  reparar/resembrar manualmente.

  APPEND-ONLY, idempotente (WHERE NOT EXISTS): se puede volver a correr sin duplicar filas.
  SQL Server (provider sqlserver), sin GO (se ejecuta como un único batch, igual que
  document-management-regulatory-subprocess.sql).
*/

DECLARE @idProcess INT = (
  SELECT id FROM process_category
  WHERE process = N'Gestión Documental — Ciclo de vida del documento' AND active = 1
);

IF @idProcess IS NOT NULL
BEGIN
  -- 1) Tipo de documento (select, obligatorio)
  IF NOT EXISTS (SELECT 1 FROM process_form_field WHERE id_process_category = @idProcess AND field_label = N'Tipo de documento')
    INSERT INTO process_form_field (id_process_category, field_label, field_type, required, active, display_order)
    VALUES (@idProcess, N'Tipo de documento', N'select', 1, 1, 1);

  -- 2) Código del documento (texto libre, obligatorio)
  IF NOT EXISTS (SELECT 1 FROM process_form_field WHERE id_process_category = @idProcess AND field_label = N'Código del documento')
    INSERT INTO process_form_field (id_process_category, field_label, field_type, required, active, display_order)
    VALUES (@idProcess, N'Código del documento', N'text', 1, 1, 2);

  -- 3) Próxima fecha de revisión (fecha, opcional)
  IF NOT EXISTS (SELECT 1 FROM process_form_field WHERE id_process_category = @idProcess AND field_label = N'Próxima fecha de revisión')
    INSERT INTO process_form_field (id_process_category, field_label, field_type, required, active, display_order)
    VALUES (@idProcess, N'Próxima fecha de revisión', N'date', 0, 1, 3);

  -- 4) Documento restringido (select Sí/No, opcional -- ausencia de respuesta = No)
  IF NOT EXISTS (SELECT 1 FROM process_form_field WHERE id_process_category = @idProcess AND field_label = N'Documento restringido')
    INSERT INTO process_form_field (id_process_category, field_label, field_type, required, active, display_order)
    VALUES (@idProcess, N'Documento restringido', N'select', 0, 1, 4);

  -- Opciones de "Tipo de documento": una por cada document_type activo. La etiqueta
  -- ("Nombre (PREFIJO)") es el mismo texto que ya mostraba el Select hardcodeado del
  -- Sprint 5; el prefijo (document_type.code_prefix, UNIQUE) es lo que se usa del lado
  -- del servidor para resolver de vuelta al id_document_type real -- ver
  -- lib/document-management/genericFields.ts.
  INSERT INTO process_form_field_option (id_form_field, option_label, active, display_order)
  SELECT ff.id, dt.name + N' (' + dt.code_prefix + N')', 1, dt.id_document_type
  FROM document_type dt
  CROSS JOIN (
    SELECT id FROM process_form_field
    WHERE id_process_category = @idProcess AND field_label = N'Tipo de documento'
  ) ff
  WHERE dt.is_active = 1
    AND NOT EXISTS (
      SELECT 1 FROM process_form_field_option o
      WHERE o.id_form_field = ff.id AND o.option_label = dt.name + N' (' + dt.code_prefix + N')'
    );

  -- Opciones de "Documento restringido": No / Sí (en ese orden -- No por defecto).
  INSERT INTO process_form_field_option (id_form_field, option_label, active, display_order)
  SELECT ff.id, v.label, 1, v.ord
  FROM (
    SELECT id FROM process_form_field
    WHERE id_process_category = @idProcess AND field_label = N'Documento restringido'
  ) ff
  CROSS JOIN (VALUES (N'No', 1), (N'Sí', 2)) v(label, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM process_form_field_option o
    WHERE o.id_form_field = ff.id AND o.option_label = v.label
  );
END

-- Diagnóstico: campos + opciones que quedaron sembrados para Gestión Documental.
SELECT ff.id AS id_form_field, ff.field_label, ff.field_type, ff.required, ff.display_order,
       o.id AS id_option, o.option_label
FROM process_form_field ff
LEFT JOIN process_form_field_option o ON o.id_form_field = ff.id
WHERE ff.id_process_category = (
  SELECT id FROM process_category WHERE process = N'Gestión Documental — Ciclo de vida del documento' AND active = 1
)
ORDER BY ff.display_order, ff.id, o.display_order, o.id;
