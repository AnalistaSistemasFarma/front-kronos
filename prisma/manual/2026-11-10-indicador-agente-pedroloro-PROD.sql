/*
  PASE MANUAL (PROD) — Registrar a «Pedro loro» (openclaw de Pedro) para medirlo en el indicador de
  automatizaciones (2026-11-10). En PRUEBAS ya existe (id_agent 43, GSS, sin subproceso).

  POR QUÉ: el analizador publica los casos por CÓDIGO de agente (JOIN dbo.agent ON code); en
  KRONOSDB no hay fila con code = 'pedroloro', así que sus casos se descartan al publicar.

  QUÉ TOCA: INSERT de 1 fila en dbo.agent y 1 en dbo.agent_company (empresa GSS = 8, principal), igual
  que en PRUEBAS. id_subprocess queda NULL: el agente NO aparece en el chat para nadie (es solo para
  el indicador). No toca company_user, subprocess_user_company ni el login. Un lote con XACT_ABORT +
  LOCK_TIMEOUT 5000 + TRAN; idempotente.
  ORDEN: antes del script de departamentos (para que Pedro loro quede en GERENCIA) y antes de volver
  a publicar el corte en PROD.
  REVERSA: DELETE dbo.agent_company y dbo.agent WHERE code = 'pedroloro' (al final de este archivo,
  comentada). Ojo: borra en cascada sus casos del indicador.
*/
SET NOCOUNT ON; SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000;
IF DB_NAME() <> N'KRONOSDB' THROW 51613, N'Base no esperada: este script es solo para KRONOSDB.', 1;
BEGIN TRY
  BEGIN TRAN;
  IF NOT EXISTS (SELECT 1 FROM dbo.agent WHERE code = N'pedroloro')
    INSERT INTO dbo.agent (code, display_name, description, is_active, sort_order, es_desarrollo)
    VALUES (N'pedroloro', N'Pedro loro',
            N'Asistente de IA de Pedro en openclaw (Telegram). Registrado para medirlo en el indicador de automatizaciones.',
            1, 100, 0);
  DECLARE @id INT = (SELECT id_agent FROM dbo.agent WHERE code = N'pedroloro');
  IF NOT EXISTS (SELECT 1 FROM dbo.agent_company WHERE id_agent = @id)
    INSERT INTO dbo.agent_company (id_agent, id_company, is_primary) VALUES (@id, 8, 1);
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
SELECT a.id_agent, a.code, a.display_name, a.is_active, a.id_subprocess, ac.id_company, ac.is_primary
FROM dbo.agent a LEFT JOIN dbo.agent_company ac ON ac.id_agent = a.id_agent WHERE a.code = N'pedroloro';

/* REVERSA (no ejecutar con el resto):
SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000; BEGIN TRAN;
DELETE ac FROM dbo.agent_company ac JOIN dbo.agent a ON a.id_agent = ac.id_agent WHERE a.code = N'pedroloro';
DELETE FROM dbo.agent WHERE code = N'pedroloro';
COMMIT TRAN;
*/
