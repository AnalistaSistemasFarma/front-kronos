/*
  PASE MANUAL — SGC documental, Sprint 1: maestros de One Latam Pharma (datos).
  Autorizado por Nicolás Rivera el 2026-09-30 (plan del SGC documental de OLP,
  ejecución sprint por sprint hasta testing).

  PRERREQUISITO: migración 20260930150000_sgc_s1_repositorio aplicada y OLP
  (id_company = 3) con fila en sgc.company_config.

  QUÉ HACE (idempotente, solo INSERT de lo que falta; no modifica lo que
  Calidad ya haya ajustado desde «Configuración del SGC»):
    1. Guía de codificación de OLP: prefijo OLP, patrón estilo Farmalógica
       {PREFIJO}-{PROCESO}-{TIPO}-{CONSECUTIVO} con 3 dígitos → OLP-GC-PR-001.
    2. Tipos de proceso: Estratégicos (E), Misionales (M), Soporte o apoyo (S)
       y Funciones y responsabilidades (F).
    3. Procesos: PROPUESTA INICIAL a partir de los departamentos existentes,
       para que Calidad la ajuste (nombres, códigos, dueños) en la pantalla de
       configuración. El departamento se busca por nombre; si no existe queda
       sin dueño.
    4. Tipos documentales del SGC: MA, PR, IN, FO, PT, PL, ES, AN, con
       revisión cada 36 meses, alerta 2 meses antes y capacitación obligatoria
       (decisión de Nicolás del 2026-09-30).
  Cada alta queda en sgc.audit_log (maestro.creado / guia_codificacion.editada).

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env (memoria
  "correr-sql-servidores-front-kronos"). Primero en KRONOSDB_PRUEBAS; en
  KRONOSDB solo con autorización del pase. Imprime antes y después.

  REVERSA: prisma/manual/2026-09-30-sgc-s1-repositorio-reversa.sql
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @IdCompany INT = 3;
DECLARE @Actor NVARCHAR(255) = N'nicolas.rivera@gsslatam.com';
DECLARE @Motivo NVARCHAR(1000) = N'Sprint 1: maestros iniciales de One Latam Pharma (propuesta para ajuste de Calidad), autorizado por Nicolás Rivera el 2026-09-30.';

/* Estado ANTES */
SELECT 'antes' AS momento,
  (SELECT COUNT(*) FROM [sgc].[coding_guide]  WHERE id_company = @IdCompany) AS guia,
  (SELECT COUNT(*) FROM [sgc].[process_type]  WHERE id_company = @IdCompany) AS tipos_proceso,
  (SELECT COUNT(*) FROM [sgc].[process_map]   WHERE id_company = @IdCompany) AS procesos,
  (SELECT COUNT(*) FROM [sgc].[document_type] WHERE id_company = @IdCompany) AS tipos_documentales;

IF NOT EXISTS (SELECT 1 FROM [sgc].[company_config] WHERE id_company = @IdCompany)
  THROW 51001, N'OLP no está configurada en sgc.company_config (falta el pase del S0).', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  /* sgc.audit_log tiene un trigger (solo inserción) y SQL Server no permite
     OUTPUT INTO directo a una tabla con triggers: se recoge en @Alta y se
     inserta después. */
  DECLARE @Alta TABLE (entity NVARCHAR(60), entity_id NVARCHAR(60), after_json NVARCHAR(MAX));

  /* 1) Guía de codificación */
  IF NOT EXISTS (SELECT 1 FROM [sgc].[coding_guide] WHERE id_company = @IdCompany)
  BEGIN
    INSERT INTO [sgc].[coding_guide] (id_company, prefix, pattern, sequence_digits, updated_by, change_reason, created_at, updated_at)
    VALUES (@IdCompany, N'OLP', N'{PREFIJO}-{PROCESO}-{TIPO}-{CONSECUTIVO}', 3, @Actor, @Motivo, SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, after_json, detail)
    VALUES (@IdCompany, SYSUTCDATETIME(), @Actor, N'guia_codificacion.editada', N'coding_guide', CAST(@IdCompany AS NVARCHAR(60)),
            N'{"prefix":"OLP","pattern":"{PREFIJO}-{PROCESO}-{TIPO}-{CONSECUTIVO}","sequence_digits":3}', @Motivo);
  END

  /* 2) Tipos de proceso */
  DECLARE @Tipos TABLE (code NVARCHAR(10), name NVARCHAR(150), color NVARCHAR(20), sort_order INT);
  INSERT INTO @Tipos VALUES
    (N'E', N'Procesos estratégicos', N'indigo', 1),
    (N'M', N'Procesos misionales', N'teal', 2),
    (N'S', N'Procesos de soporte o apoyo', N'blue', 3),
    (N'F', N'Funciones y responsabilidades', N'grape', 4);

  INSERT INTO [sgc].[process_type] (id_company, code, name, color, sort_order, is_active, created_at, updated_at)
  OUTPUT N'process_type', CAST(inserted.id_process_type AS NVARCHAR(60)),
         CONCAT(N'{"code":"', inserted.code, N'","name":"', inserted.name, N'"}')
    INTO @Alta (entity, entity_id, after_json)
  SELECT @IdCompany, t.code, t.name, t.color, t.sort_order, 1, SYSUTCDATETIME(), SYSUTCDATETIME()
  FROM @Tipos t
  WHERE NOT EXISTS (SELECT 1 FROM [sgc].[process_type] x WHERE x.id_company = @IdCompany AND x.code = t.code);

  /* 3) Procesos (propuesta inicial; el dueño se busca por nombre de departamento) */
  DECLARE @Procesos TABLE (tipo NVARCHAR(10), code NVARCHAR(10), name NVARCHAR(200), dept NVARCHAR(255), sort_order INT);
  INSERT INTO @Procesos VALUES
    (N'E', N'GE', N'Gerencia general', N'GERENCIA', 1),
    (N'E', N'GC', N'Gestión de calidad', N'GARANTÍA DE CALIDAD', 2),
    (N'E', N'CU', N'Cumplimiento', N'OFICIAL DE CUMPLIMIENTO', 3),
    (N'M', N'DT', N'Dirección técnica', N'DIRECCIÓN TÉCNICA', 1),
    (N'M', N'CO', N'Comercial', N'COMERCIAL', 2),
    (N'M', N'AC', N'Abastecimiento y comercio exterior', N'ABASTECIMIENTO Y COMEX', 3),
    (N'M', N'LO', N'Logística', N'LOGÍSTICA', 4),
    (N'S', N'TH', N'Talento humano', N'TALENTO HUMANO', 1),
    (N'S', N'CF', N'Contabilidad y finanzas', N'CONTABILIDAD Y FINANZAS', 2),
    (N'S', N'TE', N'Tesorería', N'TESORERIA', 3),
    (N'S', N'CA', N'Cartera', N'CARTERA', 4),
    (N'S', N'SI', N'Sistemas', N'SISTEMAS%', 5),
    (N'S', N'AD', N'Administración', N'ADMINISTRACIÓN', 6),
    (N'S', N'JU', N'Jurídica', N'ABOGADOS', 7),
    (N'F', N'FR', N'Perfiles de cargo: funciones y responsabilidades', N'TALENTO HUMANO', 1);

  INSERT INTO [sgc].[process_map] (id_company, id_process_type, code, name, id_department, sort_order, is_active, created_at, updated_at)
  OUTPUT N'process_map', CAST(inserted.id_process_map AS NVARCHAR(60)),
         CONCAT(N'{"code":"', inserted.code, N'","name":"', inserted.name, N'","id_department":', COALESCE(CAST(inserted.id_department AS NVARCHAR(20)), N'null'), N'}')
    INTO @Alta (entity, entity_id, after_json)
  SELECT @IdCompany, pt.id_process_type, p.code, p.name,
         (SELECT TOP 1 d.id_department FROM [dbo].[department] d WHERE d.department LIKE p.dept ORDER BY d.id_department),
         p.sort_order, 1, SYSUTCDATETIME(), SYSUTCDATETIME()
  FROM @Procesos p
  JOIN [sgc].[process_type] pt ON pt.id_company = @IdCompany AND pt.code = p.tipo
  WHERE NOT EXISTS (SELECT 1 FROM [sgc].[process_map] x WHERE x.id_company = @IdCompany AND x.code = p.code);

  /* 4) Tipos documentales */
  DECLARE @TiposDoc TABLE (code NVARCHAR(10), name NVARCHAR(100), plural_name NVARCHAR(100), sort_order INT);
  INSERT INTO @TiposDoc VALUES
    (N'MA', N'Manual', N'Manuales', 1),
    (N'PR', N'Procedimiento', N'Procedimientos', 2),
    (N'IN', N'Instructivo', N'Instructivos', 3),
    (N'FO', N'Formato', N'Formatos', 4),
    (N'PT', N'Protocolo', N'Protocolos', 5),
    (N'PL', N'Plan', N'Planes', 6),
    (N'ES', N'Especificación', N'Especificaciones', 7),
    (N'AN', N'Anexo', N'Anexos', 8);

  INSERT INTO [sgc].[document_type] (id_company, code, name, plural_name, requires_training, review_months, alert_months, sort_order, is_active, created_at, updated_at)
  OUTPUT N'document_type', CAST(inserted.id_document_type AS NVARCHAR(60)),
         CONCAT(N'{"code":"', inserted.code, N'","name":"', inserted.name, N'","review_months":36,"alert_months":2,"requires_training":true}')
    INTO @Alta (entity, entity_id, after_json)
  SELECT @IdCompany, t.code, t.name, t.plural_name, 1, 36, 2, t.sort_order, 1, SYSUTCDATETIME(), SYSUTCDATETIME()
  FROM @TiposDoc t
  WHERE NOT EXISTS (SELECT 1 FROM [sgc].[document_type] x WHERE x.id_company = @IdCompany AND x.code = t.code);

  INSERT INTO [sgc].[audit_log] (id_company, occurred_at, actor_email, action, entity, entity_id, after_json, detail)
  SELECT @IdCompany, SYSUTCDATETIME(), @Actor, N'maestro.creado', a.entity, a.entity_id, a.after_json, @Motivo FROM @Alta a;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Estado DESPUÉS */
SELECT 'despues' AS momento, prefix, pattern, sequence_digits FROM [sgc].[coding_guide] WHERE id_company = @IdCompany;
SELECT 'despues' AS momento, pt.code AS tipo, p.code, p.name, d.department
FROM [sgc].[process_map] p
JOIN [sgc].[process_type] pt ON pt.id_process_type = p.id_process_type
LEFT JOIN [dbo].[department] d ON d.id_department = p.id_department
WHERE p.id_company = @IdCompany ORDER BY pt.sort_order, p.sort_order;
SELECT 'despues' AS momento, code, name, review_months, alert_months, requires_training FROM [sgc].[document_type] WHERE id_company = @IdCompany ORDER BY sort_order;
