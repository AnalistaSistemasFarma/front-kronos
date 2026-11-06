# Créditos — stickers animados del chat de SynerLink

Los archivos de esta carpeta (`*.webp` y `*.poster.webp`) provienen de
**Noto Emoji Animation**, de Google:
https://googlefonts.github.io/noto-emoji-animation/

Licencia: **Creative Commons Attribution 4.0 International (CC BY 4.0)**,
https://creativecommons.org/licenses/by/4.0/legalcode
(el sitio oficial dice «Animated Noto Emoji is licensed under CC BY 4.0»;
verificado el 2026-10-20).

Cambios hechos por GSS: se redujeron de 512 a 160 px y a ~16 cuadros por
segundo, se recomprimieron como WebP animado (calidad 50) y, de cada uno, se guardó su primer cuadro como imagen fija
(`*.poster.webp`) para la vista sin movimiento.

Origen de cada archivo: `https://fonts.gstatic.com/s/e/notoemoji/latest/<punto de código>/512.webp`;
la tabla nombre → punto de código está en `lib/chat/stickers-animados-catalog.ts`.
