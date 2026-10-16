/*
  Migración: portal_banner
  Portal de Talento Humano — los anuncios que se cargan DESDE el portal.

  Pedido de Cristian Baldión (2026-09-09): "colócame un banner donde yo pueda
  cargar imágenes desde el portal, pero que únicamente yo pueda hacer
  modificaciones".

  POR QUÉ EN LA BASE Y NO EN SHAREPOINT. Subirlas al SharePoint sería lo
  natural —allá vive el resto del contenido—, pero el conector que usa el
  portal para leer ese sitio es de SOLO LECTURA a propósito, y agregarle una
  herramienta de escritura significaría darle capacidad de ESCRIBIR en todo el
  tenant de GSS a una credencial que ya tiene más permisos de los que debería
  (ver la revisión de la aplicación de Entra del 2026-09-09). No vale la pena
  abrir esa puerta para subir un anuncio: la base ya es un sitio adecuado, y
  quien los sube es una sola persona.

  Mismo patrón que `agent.avatar_blob`, y por las mismas razones: los archivos
  en /public solo aparecen al desplegar, y en disco no sirven porque los dos
  frentes son máquinas distintas.

  ATENCIÓN: generada MANUALMENTE (sin permiso de shadow database — P3014).

  Idempotente: se puede re-correr sin efecto.
*/

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'portal_banner')
BEGIN
  CREATE TABLE [dbo].[portal_banner] (
    [id]          INT IDENTITY(1,1) NOT NULL,
    [file_name]   NVARCHAR(255)  NOT NULL,
    [mime]        NVARCHAR(100)  NOT NULL,
    [contenido]   VARBINARY(MAX) NOT NULL,
    -- Para poder ordenarlos a mano más adelante sin migrar otra vez.
    [orden]       INT            NOT NULL CONSTRAINT [DF_portal_banner_orden] DEFAULT 0,
    -- Quién lo subió. Es un portal de comunicaciones internas: si mañana
    -- aparece un anuncio que nadie reconoce, hay que poder saber de dónde
    -- salió.
    [uploaded_by] NVARCHAR(255)  NOT NULL,
    [created_at]  DATETIME2      NOT NULL CONSTRAINT [DF_portal_banner_created] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_portal_banner] PRIMARY KEY CLUSTERED ([id] ASC)
  );
END

/* Se listan por orden y luego por el más reciente: es la única consulta. */
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_banner]') AND name = N'portal_banner_orden_idx'
)
BEGIN
  CREATE NONCLUSTERED INDEX [portal_banner_orden_idx]
    ON [dbo].[portal_banner]([orden] ASC, [id] DESC);
END
