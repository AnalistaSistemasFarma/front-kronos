/*
  REVERSA de la migración 20261009180000_portal_eventos (Portal TH · calendario · eventos de la empresa).
  Quita portal_evento. Idempotente. Si hay eventos, se niega salvo portal_reversa_eventos = 1.
*/

IF OBJECT_ID(N'[dbo].[portal_evento]', N'U') IS NOT NULL
BEGIN
  DECLARE @eventos INT = 0;
  EXEC sp_executesql N'SELECT @n = COUNT(*) FROM [dbo].[portal_evento]', N'@n INT OUTPUT', @n = @eventos OUTPUT;
  IF @eventos > 0 AND TRY_CAST(SESSION_CONTEXT(N'portal_reversa_eventos') AS INT) IS NULL
    THROW 51205, N'Hay eventos del calendario del portal: respáldelos y declare portal_reversa_eventos = 1 antes de la reversa.', 1;
END

DROP TABLE IF EXISTS [dbo].[portal_evento];

IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'20261009180000_portal_eventos';
