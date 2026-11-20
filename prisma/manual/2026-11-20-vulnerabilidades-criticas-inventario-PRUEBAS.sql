/*
  CARGA INICIAL (PRUEBAS) — inventario de software de terceros para «Lo más reciente y crítico». 2026-11-20.
  Versiones recolectadas en SOLO LECTURA el 2026-11-20 (ver traspasos/vulnerabilidades-criticas-tab-20261120/INVENTARIO.md).
  SIN direcciones IP ni nombres de servidor: solo el rol del equipo.
  Idempotente: inserta cada producto+rol solo si no existe; NO pisa lo que la administración haya editado.
  REQUIERE: 2026-11-20-vulnerabilidades-criticas-PRUEBAS.sql. REVERSA: la de las tablas (o borrar las filas con updated_by NULL).
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;
IF DB_NAME() NOT IN (N'KRONOSDB_PRUEBAS', N'kronos_ci')
  THROW 51645, N'Base no esperada.', 1;
BEGIN TRY
BEGIN TRAN;
DECLARE @s TABLE (rol NVARCHAR(100), producto NVARCHAR(150), fabricante NVARCHAR(100), version NVARCHAR(80), cpe NVARCHAR(400), palabras NVARCHAR(300), notas NVARCHAR(500));
INSERT INTO @s VALUES
  (N'Servidor SAP y base de datos', N'Windows Server 2025', N'Microsoft', N'10.0.26100.2033', N'microsoft:windows_server_2025', N'windows,win32k', NULL),
  (N'Servidor SAP y base de datos', N'Apache Tomcat (SAP B1 Server Tools)', N'Apache', N'8.5.81', N'apache:tomcat', N'tomcat', N'Rama 8.5 sin soporte de Apache desde marzo de 2024.'),
  (N'Servidor SAP y base de datos', N'SAP JVM 8', N'SAP', N'1.8.0_341', N'sap:jvm,oracle:jdk,oracle:jre,oracle:openjdk', N'java se,java,jre,jdk', N'JVM de SAP basada en HotSpot (build 8.1.089, julio de 2022). Los CVE de Oracle Java SE 8 se revisan contra ella.'),
  (N'Servidor SAP y base de datos', N'Apache HTTP Server (Service Layer)', N'Apache', N'2.4.54', N'apache:http_server', N'http server,httpd', NULL),
  (N'Servidor SAP y base de datos', N'OpenSSL (Service Layer)', N'OpenSSL', N'1.1.1n', N'openssl:openssl', N'openssl', N'Rama 1.1.1 sin soporte público desde septiembre de 2023.'),
  (N'Servidor SAP y base de datos', N'SAP Business One (Server Tools, Service Layer, SLD)', N'SAP', N'10.00.191', N'sap:business_one,sap:business_one_service_layer', N'business one', NULL),
  (N'Servidor SAP y base de datos', N'Crystal Reports para SAP Business One', N'SAP', N'14.3.2.4121', N'sap:crystal_reports,sap:businessobjects_business_intelligence_platform', N'crystal reports', NULL),
  (N'Servidor SAP y base de datos', N'SQL Server 2019', N'Microsoft', N'15.0.2000.5', N'microsoft:sql_server_2019,microsoft:sql_server', N'sql server', N'Versión inicial (RTM), sin actualizaciones acumulativas.'),
  (N'Servidor SAP y base de datos', N'OpenSSH para Windows', N'Microsoft', N'9.5p1', N'openbsd:openssh,microsoft:openssh', N'openssh', NULL),
  (N'Servidor SAP y base de datos', N'.NET Framework', N'Microsoft', N'4.8.1', N'microsoft:.net_framework', N'.net framework', NULL),
  (N'Servidor SAP y base de datos', N'WinRAR', N'RARLAB', N'7.20', N'rarlab:winrar', N'winrar', NULL),
  (N'Servidor SAP (clientes)', N'Windows Server 2019', N'Microsoft', N'10.0.17763.8880', N'microsoft:windows_server_2019', N'windows,win32k', NULL),
  (N'Servidor SAP (clientes)', N'Internet Information Services (IIS)', N'Microsoft', N'10.0', N'microsoft:internet_information_services', N'iis,internet information services', NULL),
  (N'Servidor SAP (clientes)', N'Adobe Acrobat Reader', N'Adobe', N'26.002.22031', N'adobe:acrobat_reader_dc,adobe:acrobat_reader', N'acrobat reader,acrobat', NULL),
  (N'Servidor SAP (clientes)', N'Kaspersky Security for Windows Server', N'Kaspersky', N'10.1.2.996', N'kaspersky:security_for_windows_server', N'kaspersky', NULL),
  (N'Servidor SAP (clientes)', N'OpenSSH para Windows', N'Microsoft', N'9.5p2', N'openbsd:openssh,microsoft:openssh', N'openssh', NULL),
  (N'Servidor de base de datos', N'Windows Server 2019', N'Microsoft', N'10.0.17763.9376', N'microsoft:windows_server_2019', N'windows,win32k', NULL),
  (N'Servidor de base de datos', N'SQL Server 2014 Express', N'Microsoft', N'12.0.2269.0', N'microsoft:sql_server_2014,microsoft:sql_server', N'sql server', N'SQL Server 2014 sin soporte extendido desde julio de 2024.'),
  (N'Servidor de base de datos', N'Internet Information Services (IIS)', N'Microsoft', N'10.0', N'microsoft:internet_information_services', N'iis,internet information services', NULL),
  (N'Servidor de base de datos', N'OpenSSH para Windows', N'Microsoft', N'9.5p2', N'openbsd:openssh,microsoft:openssh', N'openssh', NULL),
  (N'Servidor de aplicaciones (producción)', N'Windows Server 2019', N'Microsoft', N'10.0.17763.9245', N'microsoft:windows_server_2019', N'windows,win32k', NULL),
  (N'Servidor de aplicaciones (producción)', N'Internet Information Services (IIS) con ARR y URL Rewrite', N'Microsoft', N'10.0', N'microsoft:internet_information_services,microsoft:application_request_routing,microsoft:url_rewrite', N'iis,internet information services', NULL),
  (N'Servidor de aplicaciones (producción)', N'Node.js', N'OpenJS Foundation', N'20.14.0', N'nodejs:node.js', N'node.js,nodejs', N'Node.js 20 sin soporte desde abril de 2026.'),
  (N'Servidor de aplicaciones (producción)', N'Next.js (SynerLink)', N'Vercel', N'15.5.28', N'vercel:next.js', N'next.js', NULL),
  (N'Servidor de aplicaciones (producción)', N'Next.js (SAPSEND)', N'Vercel', N'16.2.6', N'vercel:next.js', N'next.js', NULL),
  (N'Servidor de aplicaciones (producción)', N'PM2', N'Keymetrics', N'5.3.0', N'keymetrics:pm2,pm2_project:pm2', N'pm2', NULL),
  (N'Servidor de aplicaciones (producción)', N'Git para Windows', N'Git', N'2.42.0', N'git-scm:git,git_for_windows_project:git_for_windows', N'git', NULL),
  (N'Servidor de aplicaciones (producción)', N'OpenSSL', N'OpenSSL', N'3.3.0', N'openssl:openssl', N'openssl', NULL),
  (N'Servidor de aplicaciones (producción)', N'Google Chrome', N'Google', N'158.0.8127.36', N'google:chrome', N'chromium,chrome', NULL),
  (N'Servidor de aplicaciones (producción)', N'OpenSSH para Windows', N'Microsoft', N'9.5p2', N'openbsd:openssh,microsoft:openssh', N'openssh', NULL),
  (N'Servidor de aplicaciones (pruebas)', N'Windows 10 Pro 22H2', N'Microsoft', N'10.0.19045.6456', N'microsoft:windows_10_22h2,microsoft:windows_10', N'windows,win32k', N'Windows 10 sin soporte general desde octubre de 2025.'),
  (N'Servidor de aplicaciones (pruebas)', N'Internet Information Services (IIS)', N'Microsoft', N'10.0', N'microsoft:internet_information_services', N'iis,internet information services', NULL),
  (N'Servidor de aplicaciones (pruebas)', N'Node.js', N'OpenJS Foundation', N'20.14.0', N'nodejs:node.js', N'node.js,nodejs', NULL),
  (N'Servidor de aplicaciones (pruebas)', N'Next.js (SynerLink pruebas)', N'Vercel', N'15.5.28', N'vercel:next.js', N'next.js', NULL),
  (N'Servidor de aplicaciones (pruebas)', N'PM2', N'Keymetrics', N'7.0.1', N'keymetrics:pm2,pm2_project:pm2', N'pm2', NULL),
  (N'Servidor de aplicaciones (pruebas)', N'cloudflared', N'Cloudflare', N'2026.6.1', N'cloudflare:cloudflared', N'cloudflared', NULL),
  (N'Servidor de aplicaciones (pruebas)', N'Docker Desktop', N'Docker', N'4.60.1', N'docker:desktop', N'docker desktop', NULL),
  (N'Servidor de aplicaciones (pruebas)', N'AnyDesk', N'AnyDesk', N'9.6.11', N'anydesk:anydesk', N'anydesk', NULL),
  (N'Servidor de aplicaciones (pruebas)', N'FileZilla Client', N'FileZilla', N'3.67.1', N'filezilla-project:filezilla_client', N'filezilla', NULL),
  (N'Mac de agentes', N'macOS', N'Apple', N'26.3', N'apple:macos,apple:mac_os_x', N'macos', N'Versión más antigua entre las Mac de agentes (26.3 a 26.5).'),
  (N'Mac de agentes', N'Node.js', N'OpenJS Foundation', N'24.18.1', N'nodejs:node.js', N'node.js,nodejs', N'Versión más antigua entre las Mac de agentes (24.18.1 a 26.8.1).'),
  (N'Mac de agentes', N'Claude Code', N'Anthropic', N'2.1.212', N'anthropic:claude_code', N'claude code', N'Versión más antigua entre las Mac de agentes.'),
  (N'Mac de agentes', N'openclaw', N'openclaw', N'2026.7.1', N'openclaw:openclaw', N'openclaw', N'Versión más antigua entre las Mac de agentes.'),
  (N'Mac de agentes', N'cloudflared', N'Cloudflare', N'2026.8.2', N'cloudflare:cloudflared', N'cloudflared', NULL),
  (N'Mac de agentes', N'Python', N'Python Software Foundation', N'3.9.6', N'python:python', N'python', N'Python del sistema en una Mac de agentes.'),
  (N'Mac de agentes', N'OpenSSH', N'OpenBSD', N'10.2p1', N'openbsd:openssh', N'openssh', NULL),
  (N'Todos los servidores Windows', N'Symantec Endpoint Protection', N'Broadcom', N'16.0.0', N'broadcom:symantec_endpoint_protection,symantec:endpoint_protection', N'endpoint protection,symantec', NULL),
  (N'Todos los servidores Windows', N'Acronis Cyber Protect', N'Acronis', N'26.11.43564', N'acronis:cyber_protect,acronis:cyber_protect_cloud_agent', N'cyber protect', NULL);
INSERT INTO dbo.agent_threat_inventory (rol, producto, fabricante, version, cpe, palabras, notas, activo, updated_by)
SELECT s.rol, s.producto, s.fabricante, s.version, s.cpe, s.palabras, s.notas, 1, NULL
FROM @s s
WHERE NOT EXISTS (SELECT 1 FROM dbo.agent_threat_inventory i WHERE i.rol = s.rol AND i.producto = s.producto);
SELECT @@ROWCOUNT AS insertados;
COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
SELECT COUNT(*) AS filas_inventario FROM dbo.agent_threat_inventory;
