/*
  Migración: agent_avatar_blob
  Módulo Chat — el avatar de un agente deja de ser un archivo del repositorio
  y pasa a guardarse en la base. Pedido de Nicolás el 2026-09-09: "cuando le
  dé click a Orus o la foto de perfil debería ver el detalle del agente, y en
  ese detalle poderle cambiar la imagen".

  POR QUÉ EN LA BASE Y NO EN DISCO. Hoy `agent.avatar_url` apunta a un archivo
  dentro de /public, y Next resuelve esa carpeta con una lista armada en
  TIEMPO DE COMPILACIÓN: un archivo copiado al servidor da 404 hasta el
  siguiente despliegue (verificado el 2026-09-07 con orus.jpg respondiendo 200
  y mechita.jpg 404 estando los dos en el disco). Con eso, un botón de
  "cambiar la foto" sería mentira. En disco tampoco sirve: los dos frentes
  —producción y pruebas— son máquinas distintas sin almacenamiento
  compartido; la base sí es común a cada entorno. Y es poca cosa: 512×512 en
  JPEG son unas decenas de kilobytes por agente.

  A OneDrive tampoco: los adjuntos del chat sí van allá (lib/chat/attachmentStorage.ts),
  pero un adjunto se abre de vez en cuando y un avatar se pinta en CADA tarjeta
  de la lista. Una llamada a Graph por avatar sería un peaje permanente.

  ATENCIÓN: generada MANUALMENTE, mismo patrón que las anteriores de este
  repositorio (sin permiso de shadow database en este entorno — P3014).

  Qué agrega (100% ADITIVA — tres columnas nullable, sin tocar nada más):
    - agent.avatar_blob (VARBINARY(MAX) NULL): la imagen. NULL = no le han
      subido ninguna y la interfaz sigue con `avatar_url` o con la inicial.
    - agent.avatar_mime (NVARCHAR(100) NULL): el tipo, para devolverlo en la
      respuesta del endpoint que la sirve.
    - agent.avatar_updated_at (DATETIME2 NULL): cuándo se subió. Sirve para
      DOS cosas: saber si hay imagen en base sin traerse los bytes, y como
      número de versión en la URL (?v=...) para poder cachear la imagen de
      forma agresiva y que igual cambie al instante cuando la reemplacen.

  Idempotente: se puede re-correr sin efecto.
*/

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[agent]') AND name = N'avatar_blob'
)
BEGIN
  ALTER TABLE [dbo].[agent] ADD [avatar_blob] VARBINARY(MAX) NULL;
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[agent]') AND name = N'avatar_mime'
)
BEGIN
  ALTER TABLE [dbo].[agent] ADD [avatar_mime] NVARCHAR(100) NULL;
END

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[agent]') AND name = N'avatar_updated_at'
)
BEGIN
  ALTER TABLE [dbo].[agent] ADD [avatar_updated_at] DATETIME2 NULL;
END
