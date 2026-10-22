# SGC: documentos padre e hijos y encabezado con grilla (fase 1)

> **Origen:** reunión con Calidad OLP del 2026-10-19 (carga inicial, documentos padre y encabezados).
> **Rama:** `feat/sgc-padres-hijos-encabezado` (PR hacia `testing`).
> **Estado:** preparado, **sin ejecutar**. Ningún SQL de este documento se ha corrido en PRUEBAS ni en KRONOSDB; solo en la base efímera de la CI.
> **Dependencias nuevas de npm:** ninguna.

## 1. Qué cambia

### Documentos padre e hijos

- El **procedimiento** es documento padre y **no tiene padre**. Calidad puede marcar en Configuración → Tipos documentales cuál o cuáles tipos son «padre», con motivo en el control de cambios. Mientras no haya ningún tipo marcado, el padre es el Procedimiento (código `PR` o un nombre que empiece por «Procedimiento»).
- **Reglas**, en el servidor y en la pantalla:
  - el padre no tiene padre;
  - un hijo tiene un solo padre;
  - el padre debe ser de un tipo padre.

  Aplican a las relaciones «procedimiento padre», «formato» y «anexo», que son las jerárquicas; la «referencia» no cuenta. Se validan en:
  - la solicitud nueva y la carga individual;
  - el formulario de relaciones;
  - las propuestas por código o por el listado maestro, y su confirmación;
  - «Relacionar con padre».
- **Herencia del número:** el hijo hereda el número del padre según el `child_pattern` de la empresa, como desde el S8. Con la nomenclatura del listado de Calidad, la guía sería, por ejemplo, `{PREFIJO}-{PROCESO}-{CONSECUTIVO}-{TIPO}` con 2 dígitos para el padre y `{PREFIJO}-{PROCESO}-{NUMERO_PADRE}-{TIPO}-{CONSECUTIVO}` con 3 dígitos para los hijos. Así, de `OLP-GGC-01-PR` sale `OLP-GGC-01-FR-005`. La configuración la decide Calidad: **este cambio no la toca**.
- **La relación se crea sola** en dos casos:
  - al aprobarse un hijo pedido por solicitud (origen «solicitud»);
  - en la carga individual de un vigente con su padre (origen «carga»).

  En ambos queda confirmada y en `sgc.audit_log` (`relacion.automatica`). La solicitud de un tipo que no hereda el número también puede indicar su padre, que es opcional.
- **Relacionar con arrastre:** en el mapa de relaciones, Calidad arrastra un hijo y lo suelta sobre su procedimiento, que se marca en verde. También puede soltarlo sobre la tarjeta del procedimiento en el árbol documental. En los dos casos se pide confirmación y motivo, y queda en la auditoría (`relacion.padre_asignado`).
- **Alternativa sin arrastre:** el botón «Relacionar con padre» en la ficha y en el árbol. Funciona con teclado y en el celular.
- **Árbol documental** (`/process/sgc-documental/arbol`): cada procedimiento y lo que se desprende de él, en una lista plegable con estado y versión vigente. «Ver» abre el visor seguro, sin descarga. Calidad ve además:
  - los documentos sin padre;
  - un aviso si algún hijo quedó con dos padres antes de la regla.
- El código del padre en el listado maestro se reconoce **con o sin el sufijo de versión**: `OLP-GGC-01-PR` equivale a `OLP-GGC-01-PR-1`, como llega en el listado de Calidad. Solo se reconoce si hay un candidato.

### Encabezado con grilla (fase 1)

- Cada plantilla de encabezado puede tener su **grilla** para la primera página:
  - filas, con su alto en puntos;
  - columnas, con su ancho relativo;
  - celdas combinadas;
  - el **campo** de cada celda: logo, empresa, nombre, código, versión, página, código, versión y página juntos, elaboró, revisó o aprobó con sus nombres, las tres firmas, fecha de emisión, proceso, tipo documental, la fila inferior, un **texto fijo** o una celda vacía;
  - el rótulo de cada celda (propio, ninguno o el de la plantilla) y su alineación.
- El servidor valida que la grilla:
  - cubra todas las casillas sin solaparse;
  - quepa en el alto del encabezado institucional, 142 puntos (el espacio que deja el contenido);
  - lleve nombre, código, versión, página, fecha de emisión y las tres firmas, cada uno una sola vez.
- El **editor visual** está en Configuración → Encabezados → plantilla → «Grilla propia». «Ver cómo queda» muestra el **PDF real**, compuesto con la misma función que el documento controlado.
- Con grilla:
  - las firmas sugeridas caen en sus celdas «Firma»;
  - la fecha de emisión se estampa en su celda.

  Sin grilla, todo sigue igual que antes.

## 2. Lo que queda (fase 2 y pendientes)

- **Archivo de ejemplo de Calidad:** Calidad enviará el encabezado de ejemplo. Con ese archivo se arma la plantilla en el editor y se ajusta lo que falte.
- **Logo propio por plantilla** y tipografía o tamaño por celda: hoy el logo es el de la empresa y los tamaños son los de la tabla institucional.
- **Encabezado corto de las demás páginas** configurable con su propia grilla: hoy sigue fijo con logo, nombre, código, versión y página.
- **Más alto que 142 puntos:** exige mover el margen superior del contenido (`SGC_INSTITUTIONAL_FIRST_TOP_CM`) por plantilla.
- **Encabezado dentro del Word o del Excel original:** hoy el encabezado se compone en el PDF controlado y en la vista previa. El archivo fuente no se modifica.
- **Importar la grilla desde un Excel de ejemplo**, es decir, leer las celdas combinadas del archivo de Calidad.
- **Árbol de varios niveles** (manual → procedimientos → instructivos): con la regla del 2026-10-19 el procedimiento no tiene padre. Si Calidad marca el manual como tipo padre, sus hijos cuelgan de él, pero un procedimiento no puede colgar de un manual. Hay que confirmarlo con Calidad, porque el 2026-10-02 se habló de un organigrama manual → procedimientos.
- **Retirar o cambiar el padre desde el árbol:** hoy se retira en la ficha («Retirar») y se vuelve a relacionar.

## 3. Pase (igual en PRUEBAS y en producción)

| # | Momento | Archivo | Qué hace |
|---|---|---|---|
| 1 | Antes del código | `prisma/manual/2026-10-19-sgc-padres-hijos-PRUEBAS.sql` (PRUEBAS) o `prisma/manual/2026-10-19-sgc-padres-hijos-PROD.sql` (producción) | Agrega `document_type.is_parent_type = 0` y los orígenes «solicitud» y «carga». Verifica `DB_NAME()` y es idempotente. Es el mismo DDL de `prisma/migrations/20261019100000_sgc_padres_hijos/migration.sql`. |
| 2 | **Código** | Despliegue de la rama | El esquema de Prisma cambia: ventana controlada (`prisma generate` con las apps detenidas). |
| 3 | Después del código | `node scripts/sgc/pase-produccion/registrar-migraciones.mjs > reg.sql` y aplicar `reg.sql` | Registra la migración en `_prisma_migrations`. |

No hay SQL de datos: ningún tipo queda marcado como padre y no se crean relaciones. La guía de codificación (el `child_pattern` de OLP) y la depuración de los documentos ya cargados **no hacen parte de este pase**.

**Reversa:** `prisma/manual/2026-10-19-sgc-padres-hijos-reversa.sql`, después de volver al código anterior.
- Se niega (THROW 51200) si hay tipos marcados como padre o relaciones creadas solas, salvo que se declare `EXEC sp_set_session_context N'sgc_reversa_padres_hijos', 1;`, y solo con la autorización de Nicolás Rivera o Cristian Baldión.
- Con la bandera, esas relaciones **no se borran**: su origen pasa a «manual», y el origen real queda en la auditoría.

## 4. Verificación después del pase

1. `SELECT COL_LENGTH('sgc.document_type','is_parent_type')` no es NULL, y el CHECK `document_relation_origen_estado_ck` admite «solicitud» y «carga».
2. En Configuración → Tipos documentales, el Procedimiento muestra «Documento padre».
3. En Documentos → Árbol documental se ven los procedimientos con sus hijos confirmados.
4. En el mapa, un formato arrastrado sobre su procedimiento pide motivo y queda relacionado.
5. En Configuración → Encabezados, «Grilla propia» → «Ver cómo queda» muestra el PDF con la grilla.
