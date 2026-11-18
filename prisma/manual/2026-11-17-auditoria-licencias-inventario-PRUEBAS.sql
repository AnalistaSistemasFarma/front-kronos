/*
  CARGA INICIAL (PRUEBAS) — inventario de licencias de Anthropic al 2026-11-17 (análisis agente por agente:
  huella del token en cada equipo + sonda de cupo y organización). Idempotente: crea licencias que falten,
  agrega huellas y asigna agentes por código (solo si el agente existe y aún no tiene licencia).
  No pone plan ni costo: los completa Nicolás desde el tablero. Requiere …-auditoria-licencias-PRUEBAS.sql.
*/
SET NOCOUNT ON; SET LOCK_TIMEOUT 5000; SET XACT_ABORT ON;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci') THROW 51704, N'Base no esperada para este script.', 1;
BEGIN TRY BEGIN TRAN;
DECLARE @inv TABLE (codigo NVARCHAR(10), empresa NVARCHAR(100), org NVARCHAR(40), notas NVARCHAR(500));
DECLARE @tok TABLE (huella NVARCHAR(16), codigo NVARCHAR(10), estado NVARCHAR(20), notas NVARCHAR(300));
DECLARE @ag  TABLE (code NVARCHAR(100), codigo NVARCHAR(10));
INSERT @inv VALUES (N'L01', N'GSS', N'GSS principal', NULL);
INSERT @tok VALUES (N'51de66cc7ed6', N'L01', N'activo', NULL);
INSERT @tok VALUES (N'e814032d0513', N'L01', N'activo', NULL);
INSERT @ag VALUES (N'horus', N'L01');
INSERT @ag VALUES (N'mechita', N'L01');
INSERT @ag VALUES (N'sawblaze', N'L01');
INSERT @ag VALUES (N'zoe', N'L01');
INSERT @ag VALUES (N'duo', N'L01');
INSERT @ag VALUES (N'lunaris', N'L01');
INSERT @ag VALUES (N'carter', N'L01');
INSERT @inv VALUES (N'L02', N'GSS', N'GSS principal', N'Mezcla empresas: Cosmo (OLP) y Lisa (UNIDOSSIS) deben salir.');
INSERT @tok VALUES (N'536a7da5951c', N'L02', N'activo', NULL);
INSERT @ag VALUES (N'senhatsumi', N'L02');
INSERT @ag VALUES (N'cosmo', N'L02');
INSERT @ag VALUES (N'lisa', N'L02');
INSERT @inv VALUES (N'L03', N'GSS', N'GSS principal', NULL);
INSERT @tok VALUES (N'f1e857464c76', N'L03', N'activo', NULL);
INSERT @ag VALUES (N'rex', N'L03');
INSERT @inv VALUES (N'L04', N'GSS', N'GSS principal', NULL);
INSERT @tok VALUES (N'8788b40d7ecf', N'L04', N'activo', NULL);
INSERT @ag VALUES (N'lina', N'L04');
INSERT @inv VALUES (N'L05', N'GSS', N'GSS principal', NULL);
INSERT @tok VALUES (N'1119fc8a5441', N'L05', N'activo', NULL);
INSERT @ag VALUES (N'laura', N'L05');
INSERT @ag VALUES (N'gilbert', N'L05');
INSERT @ag VALUES (N'ofi', N'L05');
INSERT @inv VALUES (N'L06', N'GSS', N'GSS principal', NULL);
INSERT @tok VALUES (N'f952a290313f', N'L06', N'activo', NULL);
INSERT @ag VALUES (N'jose', N'L06');
INSERT @inv VALUES (N'L07', N'GSS', N'GSS principal', NULL);
INSERT @tok VALUES (N'0aa8d704a8f0', N'L07', N'activo', NULL);
INSERT @ag VALUES (N'jorge', N'L07');
INSERT @inv VALUES (N'L08', N'GSS', N'GSS principal', NULL);
INSERT @tok VALUES (N'a4b5feee3af9', N'L08', N'activo', NULL);
INSERT @ag VALUES (N'troy', N'L08');
INSERT @inv VALUES (N'L09', N'FARMALOGICA S.A.', N'GSS principal', NULL);
INSERT @tok VALUES (N'73a3f503778e', N'L09', N'activo', NULL);
INSERT @ag VALUES (N'plan', N'L09');
INSERT @inv VALUES (N'L10', N'FARMALOGICA S.A.', N'GSS principal', NULL);
INSERT @tok VALUES (N'84a764505ba2', N'L10', N'activo', NULL);
INSERT @ag VALUES (N'cali', N'L10');
INSERT @inv VALUES (N'L11', N'GSS', N'GSS principal', NULL);
INSERT @tok VALUES (N'a903af131143', N'L11', N'activo', NULL);
INSERT @ag VALUES (N'play', N'L11');
INSERT @inv VALUES (N'L12', N'LABORATORIOS RYAN', N'GSS principal', NULL);
INSERT @tok VALUES (N'993c3b445447', N'L12', N'activo', NULL);
INSERT @ag VALUES (N'hiper', N'L12');
INSERT @inv VALUES (N'L13', N'GSS', N'GSS principal', N'Mezcla empresas: Indi (Abamia) necesita licencia de Abamia.');
INSERT @tok VALUES (N'88849d894746', N'L13', N'activo', NULL);
INSERT @ag VALUES (N'mark', N'L13');
INSERT @ag VALUES (N'indi', N'L13');
INSERT @inv VALUES (N'L14', N'ONELATAMPHARMA', N'OLP', NULL);
INSERT @tok VALUES (N'0de4d7418387', N'L14', N'activo', NULL);
INSERT @tok VALUES (N'01fc2c4eeed6', N'L14', N'activo', NULL);
INSERT @ag VALUES (N'atlas', N'L14');
INSERT @ag VALUES (N'orion', N'L14');
INSERT @inv VALUES (N'L15', N'ONELATAMPHARMA', N'OLP', NULL);
INSERT @tok VALUES (N'902bec6b65aa', N'L15', N'activo', NULL);
INSERT @tok VALUES (N'985872a72540', N'L15', N'activo', NULL);
INSERT @ag VALUES (N'galileo', N'L15');
INSERT @ag VALUES (N'sirio', N'L15');
INSERT @ag VALUES (N'mercurio', N'L15');
INSERT @ag VALUES (N'vega', N'L15');
INSERT @ag VALUES (N'doki', N'L15');
INSERT @inv VALUES (N'L16', N'ONELATAMPHARMA', N'OLP', NULL);
INSERT @tok VALUES (N'1875e233615f', N'L16', N'activo', NULL);
INSERT @ag VALUES (N'kepler', N'L16');
INSERT @inv VALUES (N'L17', N'GSS', N'Pedro (externa)', N'Organización externa con uso adicional pagado activo.');
INSERT @tok VALUES (N'8fbc46e42c12', N'L17', N'activo', NULL);
INSERT @tok VALUES (N'56991746538f', N'L17', N'activo', NULL);
INSERT @tok VALUES (N'd7415287c82c', N'L17', N'activo', NULL);
INSERT @ag VALUES (N'pedro', N'L17');
INSERT @ag VALUES (N'pedroloro', N'L17');
INSERT @ag VALUES (N'scout', N'L17');
INSERT @inv VALUES (N'L18', N'UNIDOSSIS', N'UNIDOSSIS', NULL);
INSERT @tok VALUES (N'b4424d04e80f', N'L18', N'activo', NULL);
INSERT @ag VALUES (N'tesa', N'L18');
INSERT @ag VALUES (N'argo', N'L18');
INSERT @ag VALUES (N'maria', N'L18');
INSERT @ag VALUES (N'pandora', N'L18');
INSERT @ag VALUES (N'sora', N'L18');
INSERT @ag VALUES (N'luna', N'L18');
INSERT @ag VALUES (N'jarvis', N'L18');
INSERT @tok VALUES (N'c65ae1f2f8b3', NULL, N'revocar', N'Llave de API del openclaw retirado de Jorge');
INSERT @tok VALUES (N'21b8770e4d18', NULL, N'revocar', N'Token vencido (401) en el Mac de Andrea');
INSERT @tok VALUES (N'ab495e39ce52', NULL, N'revocar', N'Token sin acceso (403) en el Mac de Andrea');

INSERT dbo.ai_license (codigo, id_company, organizacion, notas, updated_by)
SELECT i.codigo, c.id_company, i.org, i.notas, N'carga-inicial-2026-11-17'
FROM @inv i JOIN dbo.company c ON RTRIM(c.company) = i.empresa
WHERE NOT EXISTS (SELECT 1 FROM dbo.ai_license l WHERE l.codigo = i.codigo);

INSERT dbo.ai_license_token (huella, id_license, estado, notas)
SELECT t.huella, ISNULL(l.id_license, 0), t.estado, t.notas
FROM @tok t LEFT JOIN dbo.ai_license l ON l.codigo = t.codigo
WHERE NOT EXISTS (SELECT 1 FROM dbo.ai_license_token x WHERE x.huella = t.huella);

INSERT dbo.ai_license_agent (id_agent, id_license, updated_by)
SELECT a.id_agent, l.id_license, N'carga-inicial-2026-11-17'
FROM @ag g JOIN dbo.agent a ON a.code = g.code JOIN dbo.ai_license l ON l.codigo = g.codigo
WHERE NOT EXISTS (SELECT 1 FROM dbo.ai_license_agent x WHERE x.id_agent = a.id_agent);

SELECT (SELECT COUNT(*) FROM dbo.ai_license) AS licencias, (SELECT COUNT(*) FROM dbo.ai_license_token) AS huellas, (SELECT COUNT(*) FROM dbo.ai_license_agent) AS agentes_asignados;
COMMIT;
END TRY
BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK; THROW; END CATCH;
