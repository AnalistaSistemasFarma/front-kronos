# Noto avatar — licencia de las piezas

Las piezas de `parts.generated.ts` (caras, cabellos, ojos, cejas, narices,
bocas, barbas, gafas, accesorios y detalles) son del paquete
**"Noto avatar"**, diseñado por **Felix Wong**
(<https://abstractlab.gumroad.com/l/noto-avatar>), y se tomaron del
repositorio **Mayandev/notion-avatar** (<https://github.com/Mayandev/notion-avatar>),
carpeta `public/avatar/preview/`.

Ambas fuentes las publican bajo **CC0 1.0 Universal** (dedicación al dominio
público): <https://creativecommons.org/publicdomain/zero/1.0/deed.es>.
El README de notion-avatar dice textualmente: *"Assets licensed under CC0"*, y
sus preguntas frecuentes: *"all avatars created with Notion Avatar are released
under the CC0 license, allowing commercial use without attribution"*.

CC0 permite copiar, modificar y usar las piezas con fines comerciales sin pedir
permiso. No exige atribución, pero la dejamos por cortesía y trazabilidad.

El **código** de notion-avatar está bajo licencia MIT; de ese código no se copió
nada: SynerLink compone las piezas con su propio código (`lib/avatar/compose.ts`).

Los dibujos de **animales, planetas y constelaciones** (`lib/avatar/parts-animal.ts`,
`parts-planeta.ts`, `parts-constelacion.ts`) son propios de SynerLink; solo las
caritas (ojos, cejas y bocas) reutilizan piezas de Noto.

Para actualizar: `node scripts/avatar/import-noto.mjs <ruta a notion-avatar>`.
Las piezas nuevas quedan al final de cada lista (los índices guardados no cambian).
