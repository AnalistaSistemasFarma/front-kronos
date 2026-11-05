import { contarCorreos, soloPersonas, type GrupoCorreo } from './correos-datos';

/**
 * Correos Corporativos del Portal TH — exportación a Excel.
 *
 * Pedido de Cristian Baldión (2026-11-05): "exportar todo el directorio" (sin
 * depender del buscador ni del filtro de empresa de la pantalla) y "solo las
 * personas" (sin buzones genéricos), una hoja por empresa.
 *
 * Aquí está la parte pura (sin red ni navegador) para probarla; el libro y la
 * descarga se arman en `exportarCorreosExcel`, que carga `exceljs` solo al
 * pulsar el botón.
 */

export interface FilaResumen {
  empresa: string;
  dominio: string;
  estado: 'ok' | 'sin_acceso';
  personas: number;
  excluidos: number;
}

export interface HojaCorreos {
  nombre: string;
  empresa: string;
  estado: 'ok' | 'sin_acceso';
  /** Texto cuando no hay filas que mostrar (sin acceso o sin personas). */
  aviso: string | null;
  filas: { nombre: string; correo: string }[];
}

export interface LibroCorreos {
  resumen: FilaResumen[];
  hojas: HojaCorreos[];
  totalPersonas: number;
  totalExcluidos: number;
}

const MAX_NOMBRE_HOJA = 31;

/**
 * Nombre de hoja válido en Excel: máximo 31 caracteres, sin `\ / ? * [ ] :`,
 * y sin repetirse (sin distinguir mayúsculas) dentro del libro.
 */
export function nombreDeHoja(empresa: string, usados: Set<string>): string {
  const base =
    empresa
      .replace(/[\\/?*[\]:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_NOMBRE_HOJA) || 'Empresa';
  let nombre = base;
  let n = 2;
  while (usados.has(nombre.toLowerCase())) {
    const sufijo = ` (${n++})`;
    nombre = `${base.slice(0, MAX_NOMBRE_HOJA - sufijo.length)}${sufijo}`;
  }
  usados.add(nombre.toLowerCase());
  return nombre;
}

/** Arma el contenido del libro: todo el directorio recibido, solo personas. */
export function prepararLibro(grupos: GrupoCorreo[]): LibroCorreos {
  const personas = soloPersonas(grupos);
  const usados = new Set<string>(['resumen']);
  const resumen: FilaResumen[] = [];
  const hojas: HojaCorreos[] = [];

  grupos.forEach((g, i) => {
    const solo = personas[i];
    const excluidos = g.usuarios.length - solo.usuarios.length;
    resumen.push({
      empresa: g.empresa,
      dominio: g.dominio,
      estado: g.estado,
      personas: solo.usuarios.length,
      excluidos,
    });
    hojas.push({
      nombre: nombreDeHoja(g.empresa, usados),
      empresa: g.empresa,
      estado: g.estado,
      aviso:
        g.estado === 'sin_acceso'
          ? 'Sin acceso configurado para este tenant.'
          : solo.usuarios.length === 0
            ? 'Sin personas con licencia activa.'
            : null,
      filas: solo.usuarios.map((u) => ({ nombre: u.nombre.trim(), correo: u.correo.trim() })),
    });
  });

  return {
    resumen,
    hojas,
    totalPersonas: contarCorreos(personas),
    totalExcluidos: resumen.reduce((t, r) => t + r.excluidos, 0),
  };
}

/** `correos-corporativos-2026-11-05.xlsx`, con la fecha local (no UTC). */
export function nombreArchivoCorreos(fecha: Date = new Date()): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  return `correos-corporativos-${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}.xlsx`;
}

/**
 * Genera y descarga el Excel: hoja "Resumen" + una hoja por empresa
 * (Nombre, Correo). Devuelve los totales para avisar a la persona.
 */
export async function exportarCorreosExcel(
  grupos: GrupoCorreo[],
  fecha: Date = new Date()
): Promise<{ personas: number; excluidos: number; archivo: string }> {
  const libro = prepararLibro(grupos);
  const ExcelJS = (await import('exceljs')).default;
  const { styleHeaderRow, downloadWorkbook } = await import('../dashboard/excel/excelHelpers');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Portal de Talento Humano';
  wb.created = fecha;

  const resumen = wb.addWorksheet('Resumen');
  resumen.columns = [
    { header: 'Empresa', key: 'empresa', width: 28 },
    { header: 'Dominio', key: 'dominio', width: 26 },
    { header: 'Estado', key: 'estado', width: 16 },
    { header: 'Personas', key: 'personas', width: 12 },
    { header: 'Buzones genéricos omitidos', key: 'excluidos', width: 28 },
  ];
  styleHeaderRow(resumen.getRow(1));
  for (const r of libro.resumen) {
    resumen.addRow({
      empresa: r.empresa,
      dominio: r.dominio,
      estado: r.estado === 'ok' ? 'Con datos' : 'Sin acceso',
      personas: r.personas,
      excluidos: r.excluidos,
    });
  }
  const total = resumen.addRow({
    empresa: 'TOTAL',
    personas: libro.totalPersonas,
    excluidos: libro.totalExcluidos,
  });
  total.font = { bold: true };

  for (const h of libro.hojas) {
    const ws = wb.addWorksheet(h.nombre);
    ws.columns = [
      { header: 'Nombre', key: 'nombre', width: 42 },
      { header: 'Correo', key: 'correo', width: 48 },
    ];
    styleHeaderRow(ws.getRow(1));
    if (h.aviso) {
      ws.addRow({ nombre: h.aviso });
    } else {
      for (const f of h.filas) ws.addRow(f);
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: 'A1', to: 'B1' };
    }
  }

  const archivo = nombreArchivoCorreos(fecha);
  await downloadWorkbook(wb, archivo);
  return { personas: libro.totalPersonas, excluidos: libro.totalExcluidos, archivo };
}
