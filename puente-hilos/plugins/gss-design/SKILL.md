---
name: gss-design
description: Use this skill when designing or building any visual artifact, document, report, slide deck, prototype or mockup for Group Shared Services (GSS) and its affiliated companies in the Gsslatam group (Farmalogica S.A., Laboratorios Ryan, OneLATAM Pharma, Abamia, Meditrack, Kelab). Brand voice, color and type tokens, spacing/radii/shadow scales, component patterns, slide templates and logos — adapted to the SynerLink project threads (read-only resources, local fonts, PDF made by the bridge with a PDF: line).
---

# GSS Design System — versión para los hilos de proyecto

Copia de solo lectura de la skill `gss-design` (fuente `{{FUENTE}}`, commit `{{COMMIT}}`), preparada para el puente de hilos de SynerLink. Todo lo que necesita está en:

**`{{RECURSOS}}`** (solo lectura; léalo con Read, no lo intente modificar)

## Cómo usarla en un hilo

1. **Lea `{{RECURSOS}}/README.md`** si necesita el brief completo (voz, contenido, fundamentos visuales, iconografía). Las reglas innegociables están abajo.
2. **Escriba el documento como HTML completo** con Write en `./trabajo/salida/<nombre>.html` (por ejemplo `./trabajo/salida/informe-comex.html`).
3. **Enlace los tokens con ruta absoluta** (no copie el CSS):
   ```html
   <link rel="stylesheet" href="{{RECURSOS}}/colors_and_type.css">
   ```
   Ese CSS ya trae DM Sans, Source Sans 3 y Oi **locales** (`{{RECURSOS}}/fuentes/`). Envuelva el contenido en `class="gss"`. Todos los tokens son variables `--gss-*`.
4. **Logos e imágenes con ruta absoluta** (no se pueden copiar: Write solo escribe texto):
   ```html
   <img src="{{RECURSOS}}/assets/logo-gss.png" alt="GSS">
   ```
5. **Pida el PDF**: en su respuesta final, en una línea sola y fuera de bloques de código:
   ```
   PDF:trabajo/salida/informe-comex.html
   ```
   El puente convierte el HTML con Chrome sin ventana y adjunta `informe-comex.pdf` al hilo. Funciona en cualquier turno, aunque no tenga terminal. El HTML no se adjunta.
6. **Sin internet al convertir**: no use Google Fonts, CDN (Lucide, Chart.js por URL…) ni imágenes por URL; no cargarán. Si necesita íconos, dibújelos en SVG en línea; si necesita gráficos, SVG o HTML/CSS (JavaScript propio en línea sí funciona).
7. **Tamaño de página**: documentos con `@page { size: A4; margin: 16mm }` (o `size: letter`). Para diapositivas use `{{RECURSOS}}/slides/` como plantilla: `<script src="{{RECURSOS}}/slides/deck-stage.js"></script>` imprime una página por diapositiva a 1920×1080; cambie sus rutas relativas (`../colors_and_type.css`, `../assets/…`) por las absolutas de arriba.

## Mapa de recursos

| Ruta (dentro de `{{RECURSOS}}`) | Para qué |
|---|---|
| `README.md` | Brief completo de marca |
| `colors_and_type.css` | Todos los tokens como variables CSS (con fuentes locales) |
| `fuentes/` | DM Sans, Source Sans 3 y Oi en woff2 (licencia OFL) |
| `assets/logo-gss.png` | Logo oficial (cuatrifolio blanco «GSS» sobre `#1a3c6e`) |
| `assets/avatar-bot.png` | Avatar genérico de agente |
| `assets/logo-{obsidian,playwright,sap,synerlink}.png` | Logos de herramientas |
| `preview/` | Tarjetas de referencia: tipo, color, espaciado, componentes, marca |
| `slides/` | Marco de diapositivas 16:9 + seis plantillas (`slide-01` … `slide-06`) |

## Reglas innegociables de marca

1. **Esencia:** *"GSS existe para que las empresas existan mejor."* Posicionamiento: **eficiencia consciente.**
2. **Color primario `#1a3c6e`** (`--gss-blue`). Sin degradados morado-azul, arcoíris ni neón. Un degradado vertical sutil `--gss-blue` → `--gss-blue-700` solo en la portada de una presentación.
3. **Nunca más de dos familias tipográficas** por documento: DM Sans (marca y títulos), Source Sans 3 (cuerpo e interfaz), Times New Roman (documentos formales), Oi (solo display, muy poco).
4. **Tono del documento: cercano pero profesional.** Claro, directo, pedagógico. La marca usa **tú** y **nosotros** cuando GSS es quien actúa. (Su respuesta en el hilo sigue en «usted», como dice el encabezado del turno.)
5. **Mayúscula inicial solo en la primera palabra** de títulos e interfaz. Title Case solo para nombres propios: `Group Shared Services`, `Farmalogica S.A.`, `Laboratorios Ryan`, `OneLATAM Pharma`.
6. **Emoji solo en chat** como etiqueta de empresa o prioridad: 🔴 · 🏢 · 💊 · 🧪 · 🌎. Ninguno decorativo en documentos.
7. **Sin fondos, patrones ni fotos de stock de IA.** Blanco, `--gss-blue` o `--gss-blue-50`.
8. **Movimiento contenido** (no aplica en PDF).
9. **Números concretos**: «3 minutos», «47 procesos», no «rápidamente» ni «varios».

## Tokens

```
--gss-blue: #1a3c6e   --gss-blue-700: #15315a   --gss-blue-50: #f5f7fa
--gss-ink: #0f1a2c    --gss-ink-2: #38445a      --gss-ink-3: #6a7689
--gss-line: #d8dde6   --gss-success: #1f7a4d    --gss-warn: #b07300   --gss-danger: #b3261e
--gss-font-brand: "DM Sans"   --gss-font-ui: "Source Sans 3"
--gss-font-formal: "Times New Roman"   --gss-font-impact: "Oi"
--gss-space-{1..9}: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96
--gss-radius-{md,lg,xl,pill}: 6 / 10 / 16 / 999
--gss-shadow-{1,2,3}
```

## Acentos por empresa (solo para agrupar o etiquetar por empresa)

| Empresa | Variable | Etiqueta |
|---|---|---|
| Farmalogica | `--gss-accent-farma` `#2a8a5f` | 💊 |
| Laboratorios Ryan | `--gss-accent-ryan` `#7c4cc2` | 🧪 |
| OneLATAM Pharma | `--gss-accent-onelatam` `#c2742c` | 🌎 |
| Abamia | `--gss-accent-abamia` `#4a6b8a` | — |
| Meditrack | `--gss-accent-meditrack` `#1f7a8c` | — |
| Kelab | `--gss-accent-kelab` `#8a4a6b` | — |

Para One Latam Pharma, si el proyecto pide la marca propia de OLP, dígalo: esta skill es la de GSS.
