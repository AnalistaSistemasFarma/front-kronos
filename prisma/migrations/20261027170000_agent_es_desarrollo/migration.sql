/*
  Migración: AGENTE DE DESARROLLO (2026-10-27).
  Regla de Nicolás Rivera (2026-10-27, 16:08 COT): «el tema de los proyectos de desarrollo sí, solo
  debería ser de los agentes que desarrollan». En el módulo Proyectos, el nivel de código y los
  repositorios solo se asignan a agentes de desarrollo (lib/proyectos/agentes-desarrollo.ts).

  SOLO ADITIVO e IDEMPOTENTE. Agrega UNA columna a agent:

    - es_desarrollo  BIT NOT NULL DEFAULT 0  1 = agente de desarrollo. Todo agente existente o nuevo
                                             nace en 0 («de negocio»).

  La MARCA de los agentes (hoy solo horus y pedro) NO va aquí: va en los scripts manuales
  prisma/manual/2026-10-27-agente-desarrollo-PRUEBAS.sql / -PROD.sql.

  ⚠️ ORDEN: ANTES del código. El modelo Agent de Prisma incluye la columna: sin ella, cualquier
  lectura de agent sin `select` falla.

  BLOQUE-DDL-INICIO (los scripts manuales de PRUEBAS y PROD repiten este bloque tal cual;
  lib/proyectos/__tests__/agentes-desarrollo-sql.test.ts verifica que no se separen).
*/

SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.agent', N'U') IS NULL
  THROW 51730, N'Falta la tabla agent (chat de agentes).', 1;

IF COL_LENGTH(N'dbo.agent', N'es_desarrollo') IS NULL
  ALTER TABLE [dbo].[agent] ADD [es_desarrollo] BIT NOT NULL CONSTRAINT [agent_es_desarrollo_df] DEFAULT 0;

/* BLOQUE-DDL-FIN */
