/*
  Seed de CONFIGURACIÓN DE DISPERSIÓN por empresa para el Asistente de Pagos.
  SQL Server (provider sqlserver). IDEMPOTENTE: crea la tabla si no existe e
  inserta solo las filas que falten. NO contiene DROP/ALTER/TRUNCATE.

  La cabecera (Registro 1) del archivo DISFON del Banco de Bogotá necesita, por
  empresa dispersora, los datos que NO viven en SAP: la cuenta dispersora, su
  tipo, el NIT (con dígito de chequeo), el tipo de movimiento, la ciudad, la
  oficina y el tipo de identificación. Esta tabla los guarda por id_company.

  Se aplica SOLO a KRONOSDB_PRUEBAS (base de pruebas). NO tocar producción.

  IMPORTANTE: la fila que se inserta abajo para Farmalógica es un EJEMPLO con
  valores PLACEHOLDER (cuenta '00000000000', NIT placeholder). Antes de generar
  un DISFON real hay que reemplazarlos por los datos verdaderos de tesorería.
*/

/* 1) Crear la tabla si no existe. */
IF OBJECT_ID('dbo.payment_dispersion_config', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[payment_dispersion_config] (
    [id]               INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [id_company]       INT           NOT NULL UNIQUE,
    [cuenta_dispersora] VARCHAR(20)  NOT NULL,
    [tipo_cuenta]      VARCHAR(1)    NOT NULL,               -- 1 cte / 2 ahorros / 5 rotativo
    [nit]              VARCHAR(20)   NOT NULL,               -- con dígito de chequeo
    [tipo_movimiento]  VARCHAR(3)    NOT NULL DEFAULT '002', -- 002 proveedores
    [codigo_ciudad]    VARCHAR(4)    NOT NULL DEFAULT '0000',
    [codigo_oficina]   VARCHAR(3)    NOT NULL DEFAULT '000',
    [tipo_id]          VARCHAR(1)    NOT NULL DEFAULT 'N',   -- N NIT / L cédula / I extranjero
    [nombre_empresa]   VARCHAR(100)  NULL
  );
END

/* 2) Insertar una fila de EJEMPLO (PLACEHOLDER) para Farmalógica, si no existe
      ya una configuración para su id_company. Se resuelve el id_company por el
      nombre de la empresa para no depender de un id fijo entre ambientes. */
DECLARE @FarmaId INT = (
  SELECT TOP 1 id_company FROM [dbo].[company]
  WHERE company LIKE '%Farmal%gica%' ORDER BY id_company
);

IF @FarmaId IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM [dbo].[payment_dispersion_config] WHERE id_company = @FarmaId)
BEGIN
  INSERT INTO [dbo].[payment_dispersion_config]
    (id_company, cuenta_dispersora, tipo_cuenta, nit, tipo_movimiento,
     codigo_ciudad, codigo_oficina, tipo_id, nombre_empresa)
  VALUES
    (@FarmaId, '00000000000', '1', '00000000000', '002',
     '0000', '000', 'N', 'FARMALOGICA S.A. (PLACEHOLDER)');
END

/* Diagnóstico: qué configuración quedó cargada. */
SELECT c.id_company, comp.company, c.cuenta_dispersora, c.tipo_cuenta, c.nit,
       c.tipo_movimiento, c.codigo_ciudad, c.codigo_oficina, c.tipo_id, c.nombre_empresa
FROM [dbo].[payment_dispersion_config] c
LEFT JOIN [dbo].[company] comp ON comp.id_company = c.id_company
ORDER BY c.id_company;
