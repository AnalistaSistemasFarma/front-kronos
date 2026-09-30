/*
  PASE MANUAL — "Decisiones por artículo" del módulo Predicciones (FASE 1).
  Aprobado por Nicolás Rivera el 2026-09-30.

  QUÉ ES: dos tablas nuevas, sin tocar ninguna existente.
    - dbo.predictivo_decisiones           una fila por (empresa, fecha de corte, artículo, decisión).
                                          La llena analytics/predictivo/publicar_decisiones.js
                                          (DELETE de la empresa+fecha y bulk insert, en transacción).
    - dbo.predictivo_decisiones_resultado lo que realmente pasó N días después (para medir aciertos).
                                          En F1 solo se crea; se empieza a llenar en F2/F3.

  No hay modelo Prisma: la API las lee con $queryRaw (igual que predictivo_snapshots), así
  que el código NO falla si la tabla aún no existe (devuelve "sin datos").

  CÓMO CORRERLO: script Node con `mssql` que lee DATABASE_URL del .env del proyecto
  (ver la memoria "correr-sql-servidores-front-kronos"), subido por scp y borrado al
  terminar. Primero en KRONOSDB_PRUEBAS; en KRONOSDB solo con autorización del pase.

  Es idempotente: cada objeto se crea solo si no existe. Imprime el estado antes y después.
*/

SET XACT_ABORT ON;

/* Estado ANTES */
SELECT 'antes' AS momento, name AS tabla FROM sys.tables
WHERE name IN ('predictivo_decisiones', 'predictivo_decisiones_resultado');

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.predictivo_decisiones', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.predictivo_decisiones (
      id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_predictivo_decisiones PRIMARY KEY,
      company_id    INT            NOT NULL,
      fecha_corte   DATE           NOT NULL,
      generado_en   DATETIME2(0)   NOT NULL CONSTRAINT DF_predictivo_decisiones_generado DEFAULT SYSDATETIME(),
      version_motor VARCHAR(20)    NOT NULL,
      item_code     NVARCHAR(50)   NOT NULL,
      item_nombre   NVARCHAR(200)  NULL,
      decision      VARCHAR(4)     NOT NULL,   -- D1 reabastecer, D2 quiebre 30 d, D3 vencimiento, D7 registro sanitario
      opcion        VARCHAR(20)    NOT NULL,
      probabilidad  DECIMAL(5,4)   NULL,       -- probabilidad del evento (NULL en reglas determinísticas, p. ej. D7)
      cantidad      DECIMAL(18,2)  NULL,       -- D1: unidades sugeridas; D3: unidades que quedarían sin vender
      impacto_cop   DECIMAL(18,2)  NULL,       -- impacto en pesos colombianos
      prioridad     DECIMAL(18,2)  NULL,       -- probabilidad x impacto
      calidad       VARCHAR(5)     NOT NULL,   -- calidad del dato: alta / media / baja
      accionable    BIT            NOT NULL,
      motivo        NVARCHAR(400)  NOT NULL,   -- una línea en español sencillo
      detalle       NVARCHAR(MAX)  NULL,       -- JSON con los insumos del cálculo
      CONSTRAINT UQ_predictivo_decisiones UNIQUE (company_id, fecha_corte, item_code, decision),
      CONSTRAINT CK_predictivo_decisiones_decision CHECK (decision IN ('D1','D2','D3','D4','D5','D6','D7','D8')),
      CONSTRAINT CK_predictivo_decisiones_calidad CHECK (calidad IN ('alta','media','baja')),
      CONSTRAINT CK_predictivo_decisiones_prob CHECK (probabilidad IS NULL OR (probabilidad >= 0 AND probabilidad <= 1)),
      CONSTRAINT CK_predictivo_decisiones_detalle CHECK (detalle IS NULL OR ISJSON(detalle) = 1)
    );
    -- EXEC: el índice se compila después de crear la tabla (mismo lote)
    EXEC(N'CREATE INDEX IX_predictivo_decisiones_consulta
      ON dbo.predictivo_decisiones (company_id, fecha_corte, decision, accionable, prioridad DESC)
      INCLUDE (opcion, probabilidad, calidad)');
  END;

  IF OBJECT_ID(N'dbo.predictivo_decisiones_resultado', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.predictivo_decisiones_resultado (
      id               BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_predictivo_decisiones_resultado PRIMARY KEY,
      company_id       INT           NOT NULL,
      fecha_corte      DATE          NOT NULL,   -- la de la decisión evaluada
      item_code        NVARCHAR(50)  NOT NULL,
      decision         VARCHAR(4)    NOT NULL,
      opcion           VARCHAR(20)   NOT NULL,   -- la opción que se había sugerido (copia: la decisión se reemplaza cada noche)
      probabilidad     DECIMAL(5,4)  NULL,
      horizonte_dias   INT           NOT NULL,
      fecha_evaluacion DATE          NOT NULL,
      evento_ocurrio   BIT           NULL,       -- p. ej. D2: ¿hubo quiebre en los 30 días?
      valor_real       DECIMAL(18,2) NULL,       -- p. ej. demanda real del periodo
      detalle          NVARCHAR(MAX) NULL,
      creado_en        DATETIME2(0)  NOT NULL CONSTRAINT DF_predictivo_decisiones_resultado_creado DEFAULT SYSDATETIME(),
      CONSTRAINT UQ_predictivo_decisiones_resultado UNIQUE (company_id, fecha_corte, item_code, decision, horizonte_dias),
      CONSTRAINT CK_predictivo_decisiones_resultado_detalle CHECK (detalle IS NULL OR ISJSON(detalle) = 1)
    );
    EXEC(N'CREATE INDEX IX_predictivo_decisiones_resultado_eval
      ON dbo.predictivo_decisiones_resultado (company_id, decision, fecha_evaluacion)');
  END;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

/* Estado DESPUÉS */
SELECT 'despues' AS momento, t.name AS tabla, COUNT(c.column_id) AS columnas
FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id
WHERE t.name IN ('predictivo_decisiones', 'predictivo_decisiones_resultado')
GROUP BY t.name;
SELECT 'despues' AS momento, OBJECT_NAME(object_id) AS tabla, name AS indice
FROM sys.indexes
WHERE object_id IN (OBJECT_ID(N'dbo.predictivo_decisiones'), OBJECT_ID(N'dbo.predictivo_decisiones_resultado'))
  AND name IS NOT NULL;
