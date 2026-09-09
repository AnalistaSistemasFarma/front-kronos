/*
  Migración: portal_access_code
  Portal de Talento Humano — códigos de un solo uso para el ingreso.

  Pedido de Cristian Baldión (2026-09-09): un portal donde los colaboradores
  consulten políticas, reglamentos y anuncios de Talento Humano. Entra quien
  tenga correo de una de las empresas del grupo, más una lista de excepciones
  para quien no tiene correo corporativo. La identidad se comprueba con un
  código enviado a ese correo, igual que en el tablero de salas.

  ATENCIÓN: generada MANUALMENTE, mismo patrón que las anteriores de este
  repositorio (sin permiso de shadow database en este entorno — P3014).

  POR QUÉ EN LA BASE Y NO EN MEMORIA. Producción corre en CLÚSTER de dos
  instancias de pm2: un código guardado en memoria lo emite una instancia y lo
  verifica la otra, que no lo tiene. El usuario vería "código incorrecto" la
  mitad de las veces, de forma intermitente e imposible de reproducir.

  QUÉ SE GUARDA Y QUÉ NO:
    - `code_hash` (SHA-256), NUNCA el código en claro. Quien lea la tabla no
      puede entrar con lo que ve; si se filtra un respaldo, no hay códigos
      utilizables adentro.
    - `attempts` para poder frenar la fuerza bruta: seis dígitos son un millón
      de combinaciones, y sin tope se prueban en minutos.
    - `used_at` para que un código sirva UNA vez: sin esto, el que se quede con
      el correo reenviado entra cuantas veces quiera hasta que expire.

  Idempotente: se puede re-correr sin efecto.
*/

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'portal_access_code')
BEGIN
  CREATE TABLE [dbo].[portal_access_code] (
    [id]         INT IDENTITY(1,1) NOT NULL,
    [email]      NVARCHAR(255) NOT NULL,
    [code_hash]  NVARCHAR(64)  NOT NULL,
    [created_at] DATETIME2     NOT NULL CONSTRAINT [DF_portal_access_code_created] DEFAULT SYSDATETIME(),
    [expires_at] DATETIME2     NOT NULL,
    [used_at]    DATETIME2     NULL,
    [attempts]   INT           NOT NULL CONSTRAINT [DF_portal_access_code_attempts] DEFAULT 0,
    CONSTRAINT [PK_portal_access_code] PRIMARY KEY CLUSTERED ([id] ASC)
  );
END

/* El correo en minúsculas y el más reciente primero: es exactamente como se
   consulta al verificar un código. */
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_access_code]')
    AND name = N'portal_access_code_email_id_idx'
)
BEGIN
  CREATE NONCLUSTERED INDEX [portal_access_code_email_id_idx]
    ON [dbo].[portal_access_code]([email] ASC, [id] DESC);
END

/* Para poder borrar los vencidos sin recorrer la tabla entera. */
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[portal_access_code]')
    AND name = N'portal_access_code_expires_idx'
)
BEGIN
  CREATE NONCLUSTERED INDEX [portal_access_code_expires_idx]
    ON [dbo].[portal_access_code]([expires_at] ASC);
END
