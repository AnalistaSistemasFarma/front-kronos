# Validación del chat como PWA

Alcance: iOS y Android instalados, sin cambios de API, esquema ni voz.

## Cambios
- El compositor reserva 46 px para enviar y permite que el campo se reduzca sin desbordar.
- Radio explícito de 23 px, fuente mínima de 16 px y alto mínimo de 46 px.
- El modo inmersivo bloquea el documento y restaura su desplazamiento al salir.
- El viewport solo publica geometría cuando cambia; el teclado no inicia animaciones smooth encadenadas.
- En pantalla táctil el menú no atrapa el foco. Adjuntar sigue usando la etiqueta nativa y recupera foco con preventScroll después de seleccionar.

Se reutilizan Mantine y VisualViewport; no hay librerías nuevas. La guía GSS conserva colores y movimiento contenido; el radio de cápsula sigue la petición explícita del usuario.

## Pruebas pendientes en dispositivos reales
- iOS y Android instalados: escribir 20 líneas, borrar, pegar texto largo y citar; enviar debe permanecer visible.
- Anchos 320, 360, 390 y 430 px, orientación vertical/horizontal: sin scroll horizontal del documento.
- Con teclado abierto, arrastrar mensajes al límite: encabezado/compositor fijos y sin desplazamiento exterior.
- Clip: abrir menú, adjuntar, cancelar selector, volver a escribir. El selector del sistema puede ocultar el teclado; no se garantiza mantenerlo abierto durante ese selector.
- Navegación con teclado físico: Tab, Enter y Escape para menú y editor.
- Abrir modal de foto/cambiar conversación/salir del chat: documento vuelve a desplazarse y modales siguen operativos.
- Zoom de accesibilidad sigue permitido.

Las pruebas unitarias del viewport no sustituyen estas comprobaciones ni una medición de latencia de escritura.
