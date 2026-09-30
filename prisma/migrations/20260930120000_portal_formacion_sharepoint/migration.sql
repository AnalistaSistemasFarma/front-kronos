/*
  Migración: archivos de FORMACIÓN (Portal TH) en SharePoint — ADITIVA.

  Pedido de Cristian Baldión (2026-09-30): "todo tipo de archivo que yo suba
  en la sección de Formación debe quedar en la carpeta FORMACION del sitio de
  SharePoint de Talento Humano". Los archivos pasan a vivir en
  TalentoHumano / Documentos compartidos / FORMACION / <slug-curso>-<id> /
  {materiales|certificados}; la base solo guarda la REFERENCIA.

  Solo AGREGA columnas nulas. No borra ni modifica nada existente.

  ⚠️ `portal_course_material.contenido` (VARBINARY) QUEDA EN DESUSO: el código
  ya no escribe ahí. Se conserva para no perder los materiales que se
  subieron antes de este cambio (la descarga todavía los sirve si la fila no
  tiene `sp_drive_item_id`). RETIRO POSTERIOR, en otro PR: (1) migrar esas
  filas a SharePoint, (2) verificar que ninguna quede con `contenido` y sin
  `sp_drive_item_id`, (3) recién entonces `ALTER TABLE ... DROP COLUMN
  contenido`.

  ATENCIÓN: generada MANUALMENTE (sin shadow database — P3014, igual que las
  migraciones anteriores del portal). Correr primero contra KRONOSDB_PRUEBAS
  (.230). Idempotente: se puede re-correr sin efecto.
*/

-- Curso: nombre de la carpeta en SharePoint, fijado en la PRIMERA subida.
-- Así, si el curso cambia de título después, sus archivos no se reparten en
-- dos carpetas distintas.
IF COL_LENGTH(N'dbo.portal_course', N'sp_folder_name') IS NULL
  ALTER TABLE [dbo].[portal_course] ADD [sp_folder_name] NVARCHAR(200) NULL;

-- Material: referencia al archivo en SharePoint (file_name y mime ya existen).
IF COL_LENGTH(N'dbo.portal_course_material', N'sp_drive_item_id') IS NULL
  ALTER TABLE [dbo].[portal_course_material] ADD [sp_drive_item_id] NVARCHAR(200) NULL;
IF COL_LENGTH(N'dbo.portal_course_material', N'sp_web_url') IS NULL
  ALTER TABLE [dbo].[portal_course_material] ADD [sp_web_url] NVARCHAR(1000) NULL;
IF COL_LENGTH(N'dbo.portal_course_material', N'file_size') IS NULL
  ALTER TABLE [dbo].[portal_course_material] ADD [file_size] BIGINT NULL;

-- Certificado: el PDF emitido queda archivado en SharePoint.
IF COL_LENGTH(N'dbo.portal_certificate', N'sp_drive_item_id') IS NULL
  ALTER TABLE [dbo].[portal_certificate] ADD [sp_drive_item_id] NVARCHAR(200) NULL;
IF COL_LENGTH(N'dbo.portal_certificate', N'sp_web_url') IS NULL
  ALTER TABLE [dbo].[portal_certificate] ADD [sp_web_url] NVARCHAR(1000) NULL;
IF COL_LENGTH(N'dbo.portal_certificate', N'file_name') IS NULL
  ALTER TABLE [dbo].[portal_certificate] ADD [file_name] NVARCHAR(255) NULL;
IF COL_LENGTH(N'dbo.portal_certificate', N'file_size') IS NULL
  ALTER TABLE [dbo].[portal_certificate] ADD [file_size] BIGINT NULL;
