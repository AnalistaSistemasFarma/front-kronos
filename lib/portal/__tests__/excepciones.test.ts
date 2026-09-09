import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';

/**
 * El lector de la lista de EXCEPCIONES del portal.
 *
 * Se prueba contra libros de Excel armados en memoria —sin red y sin
 * SharePoint— porque lo que puede romperse es el parseo, no la descarga. El
 * archivo real lo mantiene a mano Talento Humano y va a cambiar de forma con
 * el tiempo: estas pruebas fijan qué sigue funcionando cuando eso pase.
 */

// El módulo importa `prisma` a través de la cadena de config; no hace falta
// para estas pruebas, pero sí hay que evitar la llamada al conector.
vi.mock('../config', async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return { ...real, ARCHIVO_EXCEPCIONES: 'USUARIOS/Cuentas Autorizadas.xlsx' };
});

const { __soloParaPruebas } = await import('../sharepoint');

async function libro(filas: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet('Hoja1');
  for (const fila of filas) hoja.addRow(fila);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('correos de la lista de excepciones (Excel)', () => {
  it('lee la columna que dice "Correo" — la forma real del archivo de hoy', async () => {
    const buf = await libro([['Correo'], ['cristianbaldion@gmail.com']]);
    expect(await __soloParaPruebas.correosDeExcel(buf)).toEqual(['cristianbaldion@gmail.com']);
  });

  it('no se rompe cuando agregan columnas alrededor', async () => {
    const buf = await libro([
      ['Nombre', 'Empresa', 'Correo', 'Observación'],
      ['Ana Pérez', 'Contratista', 'ana.perez@gmail.com', 'hasta diciembre'],
      ['Luis Gómez', 'Planta', 'luis@hotmail.com', ''],
    ]);
    expect(await __soloParaPruebas.correosDeExcel(buf)).toEqual([
      'ana.perez@gmail.com',
      'luis@hotmail.com',
    ]);
  });

  it('si no hay encabezado de correo, recoge lo que parezca un correo', async () => {
    const buf = await libro([['persona@gmail.com'], ['otra@outlook.com']]);
    expect(await __soloParaPruebas.correosDeExcel(buf)).toEqual([
      'persona@gmail.com',
      'otra@outlook.com',
    ]);
  });

  it('baja a minúsculas y descarta lo que no es un correo', async () => {
    const buf = await libro([
      ['Correo'],
      ['  Persona@GMAIL.com '],
      ['pendiente por definir'],
      [''],
    ]);
    expect(await __soloParaPruebas.correosDeExcel(buf)).toEqual(['persona@gmail.com']);
  });

  it('un libro vacío no revienta y no autoriza a nadie', async () => {
    const buf = await libro([['Correo']]);
    expect(await __soloParaPruebas.correosDeExcel(buf)).toEqual([]);
  });
});

describe('correos en texto plano', () => {
  it('ignora comentarios, vacías y basura', () => {
    const texto = ['# contratistas', 'ana@gmail.com', '', 'no es un correo', 'LUIS@Hotmail.com'].join(
      '\n'
    );
    expect(__soloParaPruebas.correosDeTexto(Buffer.from(texto, 'utf8'))).toEqual([
      'ana@gmail.com',
      'luis@hotmail.com',
    ]);
  });
});
