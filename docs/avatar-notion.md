# Avatar estilo Notion (Perfil y asistentes del chat) — DiceBear 10 · Lorelei

Editor de avatar en **Perfil → Mi avatar** y, para los asistentes de los que la persona es responsable (o si es administradora), en **Perfil → Avatar de mis asistentes**.

![Muestra Lorelei](avatar-notion/lorelei-muestra.png)

## Versión 4 (2026-10-08): DiceBear 10 + Lorelei

Decisión de Nicolás Rivera: el feature se adapta a lo que trae la librería. El motor de piezas propio (versiones 1 a 3: piezas Noto, animales, planetas, constelaciones y prototipo a lápiz) se retiró.

- Dependencias con versión **exacta** (sin `^`): `@dicebear/core` **10.7.0** y `@dicebear/styles` **10.6.0** (Lorelei viene en `@dicebear/styles/lorelei.json`; **no** se usa `@dicebear/lorelei` 9.x).
- **Node ≥ 22** (requisito de `@dicebear/core` 10): `package.json` declara `"engines": { "node": ">=22" }` y la CI (`ci.yml`, `prod-gate.yml`, `sgc-e2e-pruebas.yml`) usa Node 22. **Ojo:** los runners de despliegue (.230 testing y serfarma05 producción) usan Node del sistema, hoy **v20.14.0**; hay que actualizarlos a 22 antes de desplegar.
- El servidor (`GET /api/avatar/user/<id>` y `GET /api/avatar/agent/<code>`) genera el SVG con `new Avatar(lorelei, opciones)`.
- El editor del Perfil usa **el mismo módulo** (`lib/avatar/compose.ts`) y pinta todo con `<img src="data:…">` (`avatarDataUri`/`thumbDataUri`), nunca SVG en línea, para que no haya diferencias de hidratación entre servidor y navegador.
- El catálogo sale de la **definición** de Lorelei instalada (`components.*.variants`), no de una lista copiada.

### Opciones (exactamente las de Lorelei)

| Botón | Opción de DiceBear | Valores |
|---|---|---|
| Cabello | `hairVariant` | 48 |
| Cabeza | `headVariant` | 4 |
| Ojos | `eyesVariant` | 24 |
| Cejas | `eyebrowsVariant` | 13 |
| Boca | `mouthVariant` | 27 (18 `happy*` + 9 `sad*`); **asistentes: solo las 18 `happy*`** |
| Nariz | `noseVariant` | 6 |
| Gafas | `glassesVariant` / `glassesProbability` | ninguna + 5 |
| Aretes | `earringsVariant` / `earringsProbability` | ninguno + 3 |
| Barba | `beardVariant` / `beardProbability` | ninguna + 2 |
| Pecas | `frecklesVariant` / `frecklesProbability` | ninguna + 1 |
| Flores | `hairAccessoriesVariant` / `hairAccessoriesProbability` | ninguna + flores |
| Color de cabello | `hairColor` | 7 (negro por defecto) |
| Color de piel | `skinColor` | 7 (blanco/línea por defecto) |
| Fondo | `backgroundColor` | 8 (gris claro por defecto, incluye transparente) |
| Voltear | `flip` | none, horizontal, vertical, both |

**Aleatorio** usa el azar de DiceBear (con las probabilidades de Lorelei: gafas 10 %, aretes 10 %, barba 5 %, pecas 5 %, flores 5 %) y conserva los colores elegidos. Lo que DiceBear elige (`toJSON().options`) se vuelve configuración explícita.

### Asistentes del chat

Todos los avatares son **personas Lorelei**; ya no existen los tipos animal/planeta/constelación.

- **Semilla = nombre del asistente** (Atlas, Galileo, Kepler, Mercurio, Orión, Sirio, Vega…). Es el avatar con el que abre el editor si aún no tiene uno, y el servidor guarda siempre `seed` = nombre del asistente.
- **Bocas limitadas a `happy*`**: el editor solo las ofrece, el aleatorio solo las elige y el servidor rechaza cualquier otra (`parseAvatarConfig(…, 'agent')`).

## Licencias

| Paquete | Licencia |
|---|---|
| `@dicebear/core` 10.7.0 | MIT (Florian Körner) |
| `@dicebear/styles` 10.6.0 | Cada estilo tiene la suya (`LICENSE.md` del paquete). **Lorelei: diseño de Lisa Wischofsky, CC0 1.0** (dominio público). Ojo: otros estilos del mismo paquete tienen licencias distintas (p. ej. Adventurer es CC BY 4.0); solo se usa Lorelei. |

Cada SVG generado lleva la atribución en su `<metadata>`. Del proyecto Avatartion (MIT) se mantiene solo la **idea de la interfaz**.

## Cómo funciona

1. Se guarda solo la **configuración** en `dbo.avatar_config.config_json` (versión 3, ~340 caracteres):

   ```json
   {"v":3,"estilo":"lorelei","seed":"Orión","hair":"variant25","head":"variant03","eyes":"variant02",
    "eyebrows":"variant13","mouth":"happy10","nose":"variant05","glasses":null,"earrings":null,"beard":null,
    "freckles":null,"hairAccessories":null,"hairColor":"000000","skinColor":"ffffff","backgroundColor":"f2f2f2",
    "flip":"none"}
   ```

   `parseAvatarConfig` es estricta: solo versión 3, solo claves conocidas, variantes que existan en la definición instalada, colores hexadecimales y, en asistentes, boca `happy*`.
2. Los endpoints generan el SVG al vuelo. Exigen sesión y tienen caché inmutable gracias a `?v=<fecha>`.
3. Al guardar, `user.image` o `agent.avatar_url` apunta a esa URL; la foto anterior queda en `previous_image` y **Quitar avatar** la devuelve.
4. En los agentes gana el cambio **más reciente** entre el avatar y la foto subida por un administrador (`agentAvatarSrc`).

## Base de datos

- Script: `prisma/manual/2026-10-06-avatar-config.sql` (idempotente; solo crea la tabla). **Sin cambios de esquema** respecto al PR #520: `config_json NVARCHAR(1000)` alcanza. Solo cambió el comentario de ejemplo.
- Reversa: `prisma/manual/2026-10-06-avatar-config-reversa.sql` (sin cambios).
- La tabla no existe en ninguna base, así que no hay configuraciones anteriores que migrar; una configuración vieja sería rechazada (404 → iniciales).

## Muestra

`node scripts/avatar/muestra-lorelei.mjs docs/avatar-notion/lorelei-muestra` genera la hoja HTML y el PNG (Playwright).
