// Genera los íconos del ENTORNO DE PRUEBAS a partir del favicon real de SynerLink.
//
// Pedido de Nicolás (2026-10-22): «no sé distinguir cuál de las 2 es testing».
// La variante de pruebas lleva el fondo en ÁMBAR (en vez del azul) y una franja
// inferior oscura con «TEST», para que la pestaña se distinga a simple vista.
// Producción no usa estos archivos: solo se sirven cuando SYNERLINK_ENTORNO=pruebas
// (ver lib/entorno.ts).
//
// Uso (desde la raíz del repo): node scripts/generar-iconos-pruebas.mjs
// Salida: public/icons/pruebas/{favicon-pruebas.png,favicon-pruebas.svg,
//         icon-pruebas-192.png,icon-pruebas-512.png,apple-touch-icon-pruebas.png}
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const raiz = process.cwd();
const salida = path.join(raiz, 'public', 'icons', 'pruebas');
mkdirSync(salida, { recursive: true });

// app/favicon.ico trae un único PNG de 256 × 256; se extrae tal cual.
const ico = readFileSync(path.join(raiz, 'app', 'favicon.ico'));
const offset = ico.readUInt32LE(18);
const base = ico.subarray(offset);

// Se aísla la «S» blanca (con su brillo) por luminancia: el fondo azul del
// original queda entre 94 y 139 de gris, así que todo lo que pase de 140 es
// trazo o resplandor. Esa máscara se pinta en blanco sobre un degradado ámbar.
const { width: anchoBase } = await sharp(base).metadata();
const mascara = await sharp(base)
  .greyscale()
  .linear(255 / 115, (-140 * 255) / 115)
  .toColourspace('b-w')
  .raw()
  .toBuffer();
const sBlanca = await sharp({
  create: { width: anchoBase, height: anchoBase, channels: 3, background: '#ffffff' },
})
  .joinChannel(mascara, { raw: { width: anchoBase, height: anchoBase, channels: 1 } })
  .png()
  .toBuffer();
const fondoAmbar = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${anchoBase}" height="${anchoBase}">
    <defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#E8590C"/><stop offset="1" stop-color="#FFB020"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`,
);
const ambar = await sharp(fondoAmbar).composite([{ input: sBlanca }]).png().toBuffer();

const franja = (lado) => {
  const alto = Math.round(lado * 0.34);
  const fuente = Math.round(alto * 0.78);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}">
      <rect x="0" y="${lado - alto}" width="${lado}" height="${alto}" fill="#1f1300" fill-opacity="0.88"/>
      <text x="50%" y="${lado - alto / 2}" dy="0.35em" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="${fuente}"
        fill="#FFB020" letter-spacing="${Math.round(fuente * 0.04)}">TEST</text>
    </svg>`,
  );
};

const generar = async (lado) =>
  sharp(ambar).resize(lado, lado).composite([{ input: franja(lado) }]).png().toBuffer();

const png256 = await generar(256);
writeFileSync(path.join(salida, 'favicon-pruebas.png'), png256);
writeFileSync(path.join(salida, 'icon-pruebas-192.png'), await generar(192));
writeFileSync(path.join(salida, 'icon-pruebas-512.png'), await generar(512));
writeFileSync(path.join(salida, 'apple-touch-icon-pruebas.png'), await generar(180));

// SVG: el arte ámbar como imagen + la franja «TEST» en vectores (nítida a cualquier tamaño).
const ambar256 = await sharp(ambar).resize(256, 256).png().toBuffer();
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <image href="data:image/png;base64,${ambar256.toString('base64')}" width="256" height="256"/>
  <rect x="0" y="169" width="256" height="87" fill="#1f1300" fill-opacity="0.88"/>
  <text x="128" y="212.5" dy="0.35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
    font-weight="900" font-size="68" fill="#FFB020" letter-spacing="3">TEST</text>
</svg>
`;
writeFileSync(path.join(salida, 'favicon-pruebas.svg'), svg);

console.log(`Íconos de pruebas generados en ${path.relative(raiz, salida)}`);
