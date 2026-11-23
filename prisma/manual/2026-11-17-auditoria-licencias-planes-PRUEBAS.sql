/*
  PLANES Y COSTOS (PRUEBAS) — licencias de la organización principal de Anthropic según la factura
  4BIGCYYD-0008 (22-oct-2026, plan Team: Premium US$125 × 5 y Standard US$25 × 9 = US$850/mes) y el
  listado de miembros del 17-nov-2026. Idempotente. Requiere …-auditoria-licencias-PRUEBAS.sql e …-inventario-PRUEBAS.sql.
    - Pone plan, costo, renovación (22 de cada mes) y el correo del puesto (responsable) en L01–L13.
    - L02 es el puesto cosmo@gsslatam.com → la paga ONELATAMPHARMA (Senhatsumi y Lisa quedan marcados como «otra empresa»).
    - L20: puesto Standard agente.pedro@gsslatam.com, pagado y SIN agentes (Pedro usa una organización externa).
  Reversa: dejar plan/costo/responsable en NULL y borrar L20 (ver final del archivo, comentado).
*/
SET NOCOUNT ON; SET LOCK_TIMEOUT 5000; SET XACT_ABORT ON;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci') THROW 51706, N'Base no esperada para este script.', 1;
BEGIN TRY BEGIN TRAN;
DECLARE @p TABLE (codigo NVARCHAR(10), [plan] NVARCHAR(40), costo DECIMAL(12,2), correo NVARCHAR(200), empresa NVARCHAR(100));
INSERT @p VALUES (N'L01', N'Team Premium', 125, N'automatizacion@gsslatam.com', NULL);
INSERT @p VALUES (N'L02', N'Team Premium', 125, N'cosmo@gsslatam.com', N'ONELATAMPHARMA');
INSERT @p VALUES (N'L03', N'Team Standard', 25, N'agente.rex@gsslatam.com', NULL);
INSERT @p VALUES (N'L04', N'Team Premium', 125, N'agente.tina@gsslatam.com', NULL);
INSERT @p VALUES (N'L05', N'Team Premium', 125, N'agente.lexa@gsslatam.com', NULL);
INSERT @p VALUES (N'L06', N'Team Premium', 125, N'agente.vision@gsslatam.com', NULL);
INSERT @p VALUES (N'L07', N'Team Standard', 25, N'agente.nancy@gsslatam.com', NULL);
INSERT @p VALUES (N'L08', N'Team Standard', 25, N'agente.troy@gsslatam.com', NULL);
INSERT @p VALUES (N'L09', N'Team Standard', 25, N'agente.plan@gsslatam.com', NULL);
INSERT @p VALUES (N'L10', N'Team Standard', 25, N'agente.cali@gsslatam.com', NULL);
INSERT @p VALUES (N'L11', N'Team Standard', 25, N'agente.play@gsslatam.com', NULL);
INSERT @p VALUES (N'L12', N'Team Standard', 25, N'agente.hyper@gsslatam.com', NULL);
INSERT @p VALUES (N'L13', N'Team Standard', 25, N'agente.mark@gsslatam.com', NULL);

UPDATE l SET [plan] = p.[plan], costo_mensual = p.costo, moneda = N'USD', renovacion = '2026-11-22',
       responsable = p.correo,
       id_company = ISNULL((SELECT c.id_company FROM dbo.company c WHERE RTRIM(c.company) = p.empresa), l.id_company),
       updated_at = SYSUTCDATETIME(), updated_by = N'factura-4BIGCYYD-0008'
FROM dbo.ai_license l JOIN @p p ON p.codigo = l.codigo;

IF NOT EXISTS (SELECT 1 FROM dbo.ai_license WHERE codigo = N'L20')
  INSERT dbo.ai_license (codigo, id_company, organizacion, [plan], costo_mensual, moneda, renovacion, responsable, notas, updated_by)
  SELECT N'L20', c.id_company, N'GSS principal', N'Team Standard', 25, N'USD', '2026-11-22', N'agente.pedro@gsslatam.com',
         N'Puesto pagado sin agentes: Pedro usa una organización externa.', N'factura-4BIGCYYD-0008'
  FROM dbo.company c WHERE RTRIM(c.company) = N'GSS';

SELECT codigo, [plan], costo_mensual, responsable FROM dbo.ai_license ORDER BY codigo;
COMMIT;
END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK; THROW; END CATCH;
/* REVERSA:
UPDATE dbo.ai_license SET [plan] = NULL, costo_mensual = NULL, renovacion = NULL, responsable = NULL WHERE updated_by = N'factura-4BIGCYYD-0008';
UPDATE dbo.ai_license SET id_company = (SELECT id_company FROM dbo.company WHERE RTRIM(company) = N'GSS') WHERE codigo = N'L02';
DELETE dbo.ai_license WHERE codigo = N'L20';
*/
