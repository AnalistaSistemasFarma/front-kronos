/*
  Migración: add_chat_groups
  Módulo "Asistentes IA" — GRUPOS: conversaciones donde conviven varias
  personas y varios agentes, con menciones y tope contra el bucle.

  Pedido de Nicolás (2026-09-08): "quiero empezar a hacer grupos para poder
  hablar personas y que los agentes se comuniquen entre si en esos grupos".

  -------------------------------------------------------------------------
  PRINCIPIO DE ESTA MIGRACIÓN: el chat directo NO SE TOCA
  -------------------------------------------------------------------------
  El hilo de una persona con un agente lleva días funcionando en producción y
  es el camino que usa toda la flota. Aquí se agregan piezas NUEVAS y los
  grupos pasan por ellas; el camino directo queda idéntico. Si un grupo falla,
  el chat de siempre no se entera.

  De ahí dos decisiones que conviene explicar antes de que parezcan descuido:

  1. `chat_conversation.id_agent` y `.id_user` SIGUEN SIENDO NOT NULL, incluso
     en los grupos. Lo natural sería dejarlos en NULL (un grupo no tiene "un"
     usuario ni "un" agente), pero las dos columnas están dentro de índices
     (`chat_conversation_id_user_archived_last_message_at_idx` y
     `chat_conversation_id_agent_idx`) y SQL Server RECHAZA un ALTER COLUMN
     sobre una columna indexada: habría que tumbar índices y claves ajenas de
     una tabla viva para volverlas a crear. No vale el riesgo. En un grupo:
       - `id_user`  = quien lo creó (queda además como participante 'owner').
       - `id_agent` = el agente ANFITRIÓN, la cara del grupo en la bandeja.
     El permiso y la pertenencia NO se leen de ahí: se leen de
     `chat_participant`. Esas dos columnas son, en un grupo, metadatos.

  2. Todas las consultas del camino directo se anclan a `kind = 'direct'`
     (ver los archivos de lib/chat). Sin ese ancla, la bandeja del anfitrión
     recibiría los mensajes del grupo por el camino viejo, saltándose la regla
     de la mención — que es justo la que evita que ocho agentes contesten todo.

  -------------------------------------------------------------------------
  QUÉ HACE
  -------------------------------------------------------------------------
  ADITIVO (sin ventana, se puede aplicar en caliente):
    - chat_conversation: + kind, + id_company, + created_by
    - chat_message:      + id_user_author, + id_agent_author  (con relleno)
    - tablas nuevas:     chat_participant (con la marca de agua de lectura de
                         cada integrante), chat_message_delivery

  NO ADITIVO (exige la ventana de mantenimiento):
    - chat_agent_status: la clave primaria pasa de (id_conversation) a
      (id_conversation, id_agent). En un grupo hay VARIOS agentes y cada uno
      tiene su propio indicador de "qué está haciendo"; con la clave vieja
      solo cabía uno. La tabla guarda UNA fila por conversación (es un estado
      puntual que se sobrescribe, no un histórico), así que hoy son decenas de
      filas: reconstruir su clave es instantáneo. El relleno sale de
      `chat_conversation.id_agent`, que en todas las filas existentes es el
      agente del hilo directo.

  -------------------------------------------------------------------------
  POR QUÉ `chat_message_delivery` ES TAMBIÉN EL REGISTRO DE LA MENCIÓN
  -------------------------------------------------------------------------
  En un hilo directo, "entregado" es una columna del mensaje
  (`chat_message.delivered_at`) y alcanza porque hay un solo agente. En un
  grupo con tres agentes eso se rompe de una forma silenciosa y fea: el primer
  agente que recoge el mensaje lo marca entregado y LOS OTROS DOS NUNCA LO
  VEN. Por eso la entrega en grupos se lleva por (mensaje, agente).

  Y se aprovecha la misma tabla para la mención: **existe una fila solo si ese
  agente fue mencionado en ese mensaje**. Así "a quién le toca" y "quién ya lo
  recogió" son el mismo hecho, la bandeja es un índice directo y no hay dos
  tablas que puedan contradecirse. Lo que la interfaz pinta en negrita lo
  resuelve leyendo el propio texto del mensaje, sin depender de esta tabla.

  -------------------------------------------------------------------------
  CADENAS DE BORRADO
  -------------------------------------------------------------------------
  SQL Server no admite varias rutas de cascada hacia la MISMA tabla, así que
  cada tabla hija tiene una sola ruta en cascada:
    user -> chat_conversation -> chat_participant                    (CASCADE)
    user -> chat_conversation -> chat_message -> chat_message_delivery (CASCADE)
    user    -> chat_participant.id_user            (NO ACTION)
    user    -> chat_conversation.created_by        (NO ACTION)
    user    -> chat_message.id_user_author         (NO ACTION)
    agent   -> chat_participant.id_agent           (NO ACTION)
    agent   -> chat_message.id_agent_author        (NO ACTION)
    agent   -> chat_message_delivery.id_agent      (NO ACTION)
    agent   -> chat_agent_status.id_agent          (NO ACTION)
    company -> chat_conversation.id_company        (NO ACTION)

  -------------------------------------------------------------------------
  POR QUÉ HAY TANTOS EXEC(N'…')
  -------------------------------------------------------------------------
  Prisma manda el archivo completo como UN SOLO LOTE: no admite `GO`. Y SQL
  Server compila el lote entero antes de ejecutarlo, así que cualquier
  sentencia que nombre una columna AGREGADA EN ESE MISMO LOTE falla al compilar
  con "Invalid column name", aunque el ALTER que la crea esté más arriba. (La
  resolución diferida de nombres cubre TABLAS que no existen todavía, no
  COLUMNAS de una tabla que sí existe.)

  El `EXEC(N'…')` mete esa sentencia en su propio lote, que se compila cuando
  ya se ejecutó el ALTER. De ahí que vaya envuelto TODO lo que menciona `kind`,
  `id_company`, `created_by`, `id_user_author`, `id_agent_author` y el
  `id_agent` de chat_agent_status. Sin eso, esta migración se cae a mitad de
  camino en la ventana de mantenimiento, que es el peor momento posible.

  Idempotente: cada bloque comprueba antes de escribir, así que se puede
  correr dos veces sin romper nada.

  Para registrarla como aplicada en una base que YA tiene estos cambios:
    npx prisma migrate resolve --applied 20260908180000_add_chat_groups
*/

BEGIN TRY

BEGIN TRAN;

/* ==================================================================== */
/* 1) chat_conversation — columnas nuevas (aditivo)                     */
/* ==================================================================== */

-- `kind`: 'direct' (el hilo de siempre) | 'group'. Con DEFAULT para que las
-- filas existentes queden clasificadas como directas sin un UPDATE aparte.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_conversation]') AND name = 'kind'
)
BEGIN
  ALTER TABLE [dbo].[chat_conversation]
    ADD [kind] NVARCHAR(20) NOT NULL
    CONSTRAINT [chat_conversation_kind_df] DEFAULT 'direct';
END;

-- Empresa del grupo. NULL en los hilos directos (ahí la empresa la define el
-- permiso sobre el agente, no el hilo).
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_conversation]') AND name = 'id_company'
)
BEGIN
  ALTER TABLE [dbo].[chat_conversation] ADD [id_company] INT NULL;
END;

-- Quién creó el grupo. Redundante con id_user hoy, pero id_user es "el dueño
-- del hilo" y en un grupo eso no significa lo mismo: dejarlo explícito evita
-- que mañana alguien lea id_user como "el único que puede entrar".
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_conversation]') AND name = 'created_by'
)
BEGIN
  ALTER TABLE [dbo].[chat_conversation] ADD [created_by] NVARCHAR(1000) NULL;
END;

/* ==================================================================== */
/* 2) chat_message — autoría (aditivo + relleno)                        */
/* ==================================================================== */
-- En un hilo directo `role` alcanzaba: 'user' = el dueño, 'agent' = el agente
-- del hilo. En un grupo hay que saber CUÁL persona y CUÁL agente escribió.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_message]') AND name = 'id_user_author'
)
BEGIN
  ALTER TABLE [dbo].[chat_message] ADD [id_user_author] NVARCHAR(1000) NULL;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_message]') AND name = 'id_agent_author'
)
BEGIN
  ALTER TABLE [dbo].[chat_message] ADD [id_agent_author] INT NULL;
END;

/* ==================================================================== */
/* 3) chat_participant — quién está en el grupo                          */
/* ==================================================================== */
-- Una fila por integrante. Exactamente UNA de id_user / id_agent va con
-- valor: una fila es o una persona o un agente, nunca las dos ni ninguna
-- (lo garantiza el CHECK de más abajo).
IF OBJECT_ID(N'[dbo].[chat_participant]', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_participant] (
      [id_participant] INT NOT NULL IDENTITY(1,1),
      [id_conversation] INT NOT NULL,
      [id_user] NVARCHAR(1000),
      [id_agent] INT,
      -- 'owner' = puede agregar y quitar integrantes; 'member' = solo participa.
      [role] NVARCHAR(20) NOT NULL CONSTRAINT [chat_participant_role_df] DEFAULT 'member',
      -- Marca de agua de lectura: el id del último mensaje que esta persona ya
      -- vio. Los "no leídos" de un grupo NO pueden salir de
      -- `chat_message.read_at`, que es una sola columna por mensaje: en un
      -- grupo de cinco, el primero que leyera lo marcaría leído para los otros
      -- cuatro. Con la marca de agua cada quien tiene su propia cuenta y
      -- alcanza con un entero, sin una tabla de lecturas por persona.
      [last_read_message_id] INT NULL,
      [added_at] DATETIME2 NOT NULL CONSTRAINT [chat_participant_added_at_df] DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT [chat_participant_pkey] PRIMARY KEY CLUSTERED ([id_participant])
  );
END;

/* ==================================================================== */
/* 4) chat_message_delivery — entrega POR AGENTE (y registro de mención) */
/* ==================================================================== */
IF OBJECT_ID(N'[dbo].[chat_message_delivery]', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[chat_message_delivery] (
      [id_message] INT NOT NULL,
      [id_agent] INT NOT NULL,
      [delivered_at] DATETIME2,
      CONSTRAINT [chat_message_delivery_pkey] PRIMARY KEY CLUSTERED ([id_message],[id_agent])
  );
END;

/* ==================================================================== */
/* 5) Índices                                                            */
/* ==================================================================== */

-- Una persona no puede estar dos veces en el mismo grupo. Índice ÚNICO
-- FILTRADO (mismo criterio que UX_agent_id_subprocess): SQL Server solo admite
-- un NULL en un índice único no filtrado, y aquí la mitad de las filas tiene
-- id_user en NULL a propósito (son los agentes).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_chat_participant_user' AND object_id = OBJECT_ID(N'[dbo].[chat_participant]'))
BEGIN
  CREATE UNIQUE INDEX [UX_chat_participant_user]
      ON [dbo].[chat_participant] ([id_conversation], [id_user])
      WHERE [id_user] IS NOT NULL;
END;

-- Y un agente tampoco.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_chat_participant_agent' AND object_id = OBJECT_ID(N'[dbo].[chat_participant]'))
BEGIN
  CREATE UNIQUE INDEX [UX_chat_participant_agent]
      ON [dbo].[chat_participant] ([id_conversation], [id_agent])
      WHERE [id_agent] IS NOT NULL;
END;

-- "¿En qué grupos estoy?" — la bandeja del usuario.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_participant_id_user_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_participant]'))
BEGIN
  CREATE NONCLUSTERED INDEX [chat_participant_id_user_idx] ON [dbo].[chat_participant]([id_user]);
END;

-- "¿En qué grupos está este agente?" — la bandeja del agente.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_participant_id_agent_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_participant]'))
BEGIN
  CREATE NONCLUSTERED INDEX [chat_participant_id_agent_idx] ON [dbo].[chat_participant]([id_agent]);
END;

-- EL índice del long-poll de los grupos: "mis menciones sin recoger", en
-- orden de llegada. Es la consulta que corre cada 400 ms por cada agente
-- conectado, así que va cubierta por este índice y no toca la tabla.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_message_delivery_pendiente_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_message_delivery]'))
BEGIN
  CREATE NONCLUSTERED INDEX [chat_message_delivery_pendiente_idx]
      ON [dbo].[chat_message_delivery]([id_agent], [delivered_at], [id_message]);
END;

-- Autoría: "todo lo que escribió este agente" (auditoría del bucle).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_message_id_agent_author_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_message]'))
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_message_id_agent_author_idx] ON [dbo].[chat_message]([id_agent_author]);');
END;

-- Bandeja del usuario, grupos incluidos: se ordena por kind + actividad.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'chat_conversation_kind_last_message_at_idx' AND object_id = OBJECT_ID(N'[dbo].[chat_conversation]'))
BEGIN
  EXEC(N'CREATE NONCLUSTERED INDEX [chat_conversation_kind_last_message_at_idx]
      ON [dbo].[chat_conversation]([kind], [archived], [last_message_at] DESC);');
END;

/* ==================================================================== */
/* 6) Restricciones CHECK                                                */
/* ==================================================================== */

-- Una fila de participante es una persona O un agente. Nunca las dos, nunca
-- ninguna. Si esto no fuera un CHECK sino "una regla de la aplicación", el
-- primer endpoint que se olvide de validarlo mete basura que después nadie
-- entiende.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_participant_uno_de_dos_ck')
BEGIN
  ALTER TABLE [dbo].[chat_participant] WITH CHECK
    ADD CONSTRAINT [chat_participant_uno_de_dos_ck]
    CHECK (
      ([id_user] IS NOT NULL AND [id_agent] IS NULL)
      OR ([id_user] IS NULL AND [id_agent] IS NOT NULL)
    );
END;

-- `kind` solo admite los dos valores conocidos.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chat_conversation_kind_ck')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_conversation] WITH CHECK
    ADD CONSTRAINT [chat_conversation_kind_ck]
    CHECK ([kind] IN (''direct'', ''group''));');
END;

/* ==================================================================== */
/* 7) Claves ajenas                                                      */
/* ==================================================================== */

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'chat_conversation_id_company_fkey')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_conversation] ADD CONSTRAINT [chat_conversation_id_company_fkey]
    FOREIGN KEY ([id_company]) REFERENCES [dbo].[company]([id_company]) ON DELETE NO ACTION ON UPDATE NO ACTION;');
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'chat_conversation_created_by_fkey')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_conversation] ADD CONSTRAINT [chat_conversation_created_by_fkey]
    FOREIGN KEY ([created_by]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;');
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'chat_message_id_user_author_fkey')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_message] ADD CONSTRAINT [chat_message_id_user_author_fkey]
    FOREIGN KEY ([id_user_author]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;');
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'chat_message_id_agent_author_fkey')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_message] ADD CONSTRAINT [chat_message_id_agent_author_fkey]
    FOREIGN KEY ([id_agent_author]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION;');
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'chat_participant_id_conversation_fkey')
BEGIN
  ALTER TABLE [dbo].[chat_participant] ADD CONSTRAINT [chat_participant_id_conversation_fkey]
    FOREIGN KEY ([id_conversation]) REFERENCES [dbo].[chat_conversation]([id]) ON DELETE CASCADE ON UPDATE CASCADE;
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'chat_participant_id_user_fkey')
BEGIN
  ALTER TABLE [dbo].[chat_participant] ADD CONSTRAINT [chat_participant_id_user_fkey]
    FOREIGN KEY ([id_user]) REFERENCES [dbo].[user]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'chat_participant_id_agent_fkey')
BEGIN
  ALTER TABLE [dbo].[chat_participant] ADD CONSTRAINT [chat_participant_id_agent_fkey]
    FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'chat_message_delivery_id_message_fkey')
BEGIN
  ALTER TABLE [dbo].[chat_message_delivery] ADD CONSTRAINT [chat_message_delivery_id_message_fkey]
    FOREIGN KEY ([id_message]) REFERENCES [dbo].[chat_message]([id]) ON DELETE CASCADE ON UPDATE CASCADE;
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'chat_message_delivery_id_agent_fkey')
BEGIN
  ALTER TABLE [dbo].[chat_message_delivery] ADD CONSTRAINT [chat_message_delivery_id_agent_fkey]
    FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION;
END;

/* ==================================================================== */
/* 8) Relleno de la autoría de los mensajes existentes                   */
/* ==================================================================== */
-- Todo lo que existe hoy son hilos directos, así que el autor se deduce sin
-- ambigüedad: 'user' -> el dueño del hilo, 'agent' -> el agente del hilo.
-- Los mensajes 'system' quedan sin autor, que es lo correcto: no los escribió
-- nadie.
EXEC(N'
UPDATE m
   SET m.[id_user_author] = c.[id_user]
  FROM [dbo].[chat_message] m
  JOIN [dbo].[chat_conversation] c ON c.[id] = m.[id_conversation]
 WHERE m.[role] = ''user'' AND m.[id_user_author] IS NULL;

UPDATE m
   SET m.[id_agent_author] = c.[id_agent]
  FROM [dbo].[chat_message] m
  JOIN [dbo].[chat_conversation] c ON c.[id] = m.[id_conversation]
 WHERE m.[role] = ''agent'' AND m.[id_agent_author] IS NULL;
');

/* ==================================================================== */
/* 9) chat_agent_status — un indicador POR AGENTE (NO aditivo)           */
/* ==================================================================== */
-- Único cambio de esta migración que reconstruye una clave primaria. La tabla
-- tiene una fila por conversación (estado puntual, no histórico), así que hoy
-- son decenas de filas y la reconstrucción es inmediata.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_agent_status]') AND name = 'id_agent'
)
BEGIN
  -- (a) la columna entra permitiendo NULL, para poder rellenarla…
  ALTER TABLE [dbo].[chat_agent_status] ADD [id_agent] INT NULL;
END;

-- …(b) relleno desde el agente del hilo. Va en su propio lote porque el
-- UPDATE no puede referirse a una columna creada en el mismo lote.
EXEC(N'
UPDATE s
   SET s.[id_agent] = c.[id_agent]
  FROM [dbo].[chat_agent_status] s
  JOIN [dbo].[chat_conversation] c ON c.[id] = s.[id_conversation]
 WHERE s.[id_agent] IS NULL;
');

-- (c) si quedara alguna fila huérfana sin agente, se borra: es un estado
-- puntual sin valor histórico y no puede quedar violando el NOT NULL.
EXEC(N'DELETE FROM [dbo].[chat_agent_status] WHERE [id_agent] IS NULL;');

-- (d) ahora sí, NOT NULL y clave primaria compuesta.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'[dbo].[chat_agent_status]') AND name = 'id_agent' AND is_nullable = 1
)
BEGIN
  IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'chat_agent_status_pkey')
  BEGIN
    ALTER TABLE [dbo].[chat_agent_status] DROP CONSTRAINT [chat_agent_status_pkey];
  END;

  EXEC(N'ALTER TABLE [dbo].[chat_agent_status] ALTER COLUMN [id_agent] INT NOT NULL;');

  EXEC(N'ALTER TABLE [dbo].[chat_agent_status]
    ADD CONSTRAINT [chat_agent_status_pkey] PRIMARY KEY CLUSTERED ([id_conversation],[id_agent]);');
END;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'chat_agent_status_id_agent_fkey')
BEGIN
  EXEC(N'ALTER TABLE [dbo].[chat_agent_status] ADD CONSTRAINT [chat_agent_status_id_agent_fkey]
    FOREIGN KEY ([id_agent]) REFERENCES [dbo].[agent]([id_agent]) ON DELETE NO ACTION ON UPDATE NO ACTION;');
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
