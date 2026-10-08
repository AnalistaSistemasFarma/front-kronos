# Avatar estilo Notion (Perfil y asistentes del chat) — DiceBear · Lorelei

Editor de avatar en **Perfil → Mi avatar** y, para los asistentes de los que la persona es responsable (o si es administradora), en **Perfil → Avatar de mis asistentes**.

![Muestra Lorelei](avatar-notion/lorelei-muestra.png)

## Versión 4 (2026-10-08): DiceBear + Lorelei

Por decisión de Nicolás Rivera, el dibujo ya no sale de un motor de piezas propio (versiones 1 a 3: piezas Noto, animales, planetas, constelaciones y el prototipo a lápiz). Ahora se usa la librería **DiceBear** con el estilo **Lorelei**:

```
npm install @dicebear/core@^9.4.3 @dicebear/lorelei@^9.4.3
```

- El servidor (`GET /api/avatar/user/<id>` y `GET /api/avatar/agent/<code>`) genera el SVG con `createAvatar(lorelei, opciones)`.
- El editor del Perfil usa **el mismo módulo** (`lib/avatar/compose.ts`) para la vista previa en el navegador; lo que se ve es exactamente lo que se guarda y lo que se sirve.
- Las opciones del editor salen del **esquema real** de la versión instalada de Lorelei (`lorelei.schema`), no de una lista copiada.

### Por qué la versión 9 y no la 10 de @dicebear/core

`npm install @dicebear/core @dicebear/lorelei` sin versión **no resuelve**: `@dicebear/core@latest` es la 10.x, pero `@dicebear/lorelei` (último 9.4.3) exige `@dicebear/core ^9` como dependencia par (ERESOLVE). En la versión 10, DiceBear reemplazó los paquetes por estilo por `@dicebear/styles` y además exige Node ≥ 22, mientras la CI y los servidores usan Node 20. Por eso se fijan ambos paquetes en **9.4.3** (etiqueta `v9-lts`). Migrar a la 10 es un cambio aparte (Node 22 + `@dicebear/styles`).

### Opciones que se pueden elegir

| Botón | Opción de Lorelei | Valores |
|---|---|---|
| Cabello | `hair` | 48 variantes |
| Cara | `head` | 4 |
| Ojos | `eyes` | 24 |
| Cejas | `eyebrows` | 13 |
| Boca | `mouth` | 18 sonrisas + 9 serias |
| Nariz | `nose` | 6 |
| Lentes | `glasses` | ninguno + 5 |
| Barba | `beard` | ninguna + 2 |
| Aretes | `earrings` | ninguno + 3 |
| Pecas | `freckles` | ninguna + 1 |
| Accesorio | `hairAccessories` | ninguno + flores |
| Color de cabello | `hairColor` | 7 (negro por defecto) |
| Color de piel | `skinColor` | 7 (blanco/línea por defecto) |
| Fondo | `backgroundColor` | 8 (gris claro por defecto, incluye transparente) |
| Voltear | `flip` | sí / no |

Por defecto el avatar queda en **blanco y negro** (piel blanca, cabello negro, fondo gris claro), que es el look de Notion. Los colores son opcionales.

**Aleatorio** usa el azar de DiceBear (con sus probabilidades: lentes 10 %, barba 5 %, aretes 10 %, pecas 5 %, flores 5 %) a partir de una semilla nueva y conserva los colores elegidos. Lo que DiceBear elige se vuelve configuración explícita (`toJson().extra`).

### Asistentes del chat

Lorelei solo dibuja **personas**. Para los asistentes (OLP: Atlas, Galileo, Kepler, Mercurio, Orión, Sirio, Vega, y los demás) se aplica la solución mínima: **Lorelei para todos, con la semilla del nombre** del asistente (`sugerenciaParaAgente`). Es el avatar con el que abre el editor si el asistente aún no tiene; nada se guarda hasta pulsar **Guardar**. Los animales, planetas y constelaciones de la versión 3 se retiraron; si se quieren de vuelta, sería con otro estilo de DiceBear (p. ej. `bottts` o `shapes`) en un cambio aparte.

## Licencias

| Paquete | Código | Diseño |
|---|---|---|
| `@dicebear/core` 9.4.3 | MIT (Florian Körner) | — |
| `@dicebear/lorelei` 9.4.3 | MIT (Florian Körner) | **"Lorelei" de Lisa Wischofsky, CC0 1.0** (dominio público; uso comercial permitido sin atribución). Fuente: Figma community file 1198749693280469639. |

Cada SVG generado lleva la atribución en su `<metadata>` (lo agrega DiceBear). Del proyecto Avatartion (MIT) se mantiene solo la **idea de la interfaz** (círculo por parte, selector paginado, Aleatorio y Descargar); ningún dibujo.

## Cómo funciona

1. Se guarda solo la **configuración** en `dbo.avatar_config.config_json` (versión 2, ~330 caracteres de JSON):

   ```json
   {"v":2,"estilo":"lorelei","seed":"Orión","hair":"variant30","head":"variant02","eyes":"variant16",
    "eyebrows":"variant08","mouth":"sad05","nose":"variant03","glasses":"variant03","beard":"variant02",
    "earrings":null,"freckles":null,"hairAccessories":null,"hairColor":"000000","skinColor":"ffffff",
    "backgroundColor":"f2f2f2","flip":false}
   ```

   `parseAvatarConfig` es estricta: solo versión 2, solo claves conocidas, variantes que existan en el esquema instalado y colores hexadecimales. Ninguna cadena del usuario llega al SVG.
2. `GET /api/avatar/user/<id>` y `GET /api/avatar/agent/<code>` generan el SVG al vuelo con DiceBear. Ambas exigen sesión y tienen caché inmutable gracias a `?v=<fecha>`.
3. Al guardar, `user.image` o `agent.avatar_url` pasa a apuntar a esa URL. Así el encabezado, el chat, los grupos y las menciones lo muestran sin tocar esas pantallas. La foto anterior queda en `previous_image`, y **Quitar avatar** la devuelve.
4. En los agentes gana el cambio **más reciente** entre el avatar y la foto subida por un administrador (`agentAvatarSrc`).

## Base de datos

- Script: `prisma/manual/2026-10-06-avatar-config.sql` (idempotente; solo crea la tabla). **Sin cambios de esquema** respecto al PR #520: `config_json NVARCHAR(1000)` alcanza de sobra para las opciones de Lorelei. Solo se actualizó el comentario de ejemplo.
- Reversa: `prisma/manual/2026-10-06-avatar-config-reversa.sql` (sin cambios).
- La tabla no se ha creado en ninguna base, así que no hay configuraciones de la versión 1 que migrar. Si existiera alguna, `parseAvatarConfig` la rechaza y el endpoint responde 404 (la interfaz cae a las iniciales).

## Muestra

`node scripts/avatar/muestra-lorelei.mjs docs/avatar-notion/lorelei-muestra` genera la hoja HTML y el PNG (Playwright) con personas variadas y los 7 asistentes de OLP.
