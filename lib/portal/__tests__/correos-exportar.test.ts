import { describe, expect, it } from 'vitest';
import { esBuzonGenerico, soloPersonas, type GrupoCorreo } from '../correos-datos';
import { nombreArchivoCorreos, nombreDeHoja, prepararLibro } from '../correos-exportar';

// Exportar Correos Corporativos a Excel (Cristian, 2026-11-05): todo el
// directorio, solo personas, una hoja por empresa.

const GRUPOS: GrupoCorreo[] = [
  {
    empresa: 'GSS',
    dominio: 'gsslatam.com',
    estado: 'ok',
    usuarios: [
      { nombre: 'Nicolas Rivera', correo: 'nicolas.rivera@gsslatam.com' },
      { nombre: 'Administrador Sistemas', correo: 'admin@gsslatam.com' },
      { nombre: 'Certificados', correo: 'certificados@gsslatam.com' },
      // Persona con buzón de cargo: NO se debe omitir.
      { nombre: 'Andrea Barragán', correo: 'director.tecnico@gsslatam.com' },
      { nombre: 'Maria Camila Ortega Paternina', correo: 'subdireccion.reglamentaria@gsslatam.com' },
    ],
  },
  {
    empresa: 'ONE LATAM PHARMA',
    dominio: 'onelatampharma.com',
    estado: 'ok',
    usuarios: [
      { nombre: 'Angie Lizeth Angarita Pérez', correo: 'angie.angarita@onelatampharma.com' },
      { nombre: 'noreply', correo: 'noreply@onelatampharma.com' },
      { nombre: 'Pqr Colombia', correo: 'pqrcolombia@onelatampharma.com' },
      { nombre: 'Talento Humano', correo: 'talento@onelatampharma.com' },
    ],
  },
  { empresa: 'ABAMIA', dominio: 'abamialabs.com', estado: 'sin_acceso', usuarios: [] },
  { empresa: 'KELAB', dominio: 'kelabanalitica.com', estado: 'ok', usuarios: [] },
];

describe('esBuzonGenerico', () => {
  it('reconoce buzones por nombre o por la parte local del correo', () => {
    expect(esBuzonGenerico({ nombre: 'Administrador Sistemas', correo: 'admin@gsslatam.com' })).toBe(true);
    expect(esBuzonGenerico({ nombre: 'Notificaciones OLP', correo: 'notificaciones@onelatampharma.com' })).toBe(true);
    // Nombre distinto, mismo buzón conocido (parte local).
    expect(esBuzonGenerico({ nombre: 'Soporte', correo: 'NoReply@onelatampharma.com' })).toBe(true);
    // Nombre con tildes y mayúsculas.
    expect(esBuzonGenerico({ nombre: 'COMITÉ  Convivencia', correo: 'x@y.com' })).toBe(true);
  });

  it('no confunde a una persona con buzón de cargo', () => {
    expect(esBuzonGenerico({ nombre: 'Andrea Barragán', correo: 'director.tecnico@gsslatam.com' })).toBe(false);
    expect(esBuzonGenerico({ nombre: 'Hector Aragon', correo: 'hector.aragon@gsslatam.com' })).toBe(false);
  });
});

describe('soloPersonas', () => {
  it('quita buzones, conserva estado y orden, y no muta la entrada', () => {
    const antes = JSON.stringify(GRUPOS);
    const r = soloPersonas(GRUPOS);
    expect(r[0].usuarios.map((u) => u.correo)).toEqual([
      'nicolas.rivera@gsslatam.com',
      'director.tecnico@gsslatam.com',
      'subdireccion.reglamentaria@gsslatam.com',
    ]);
    expect(r[1].usuarios.map((u) => u.correo)).toEqual(['angie.angarita@onelatampharma.com']);
    expect(r[2].estado).toBe('sin_acceso');
    expect(JSON.stringify(GRUPOS)).toBe(antes);
  });
});

describe('nombreDeHoja', () => {
  it('respeta el límite de 31 caracteres y quita los prohibidos', () => {
    const n = nombreDeHoja('EMPRESA/DE:PRUEBA [muy] larga ? con * nombre larguísimo', new Set());
    expect(n.length).toBeLessThanOrEqual(31);
    expect(n).not.toMatch(/[\\/?*[\]:]/);
  });

  it('no repite nombres, sin distinguir mayúsculas', () => {
    const usados = new Set<string>(['resumen']);
    expect(nombreDeHoja('GSS', usados)).toBe('GSS');
    expect(nombreDeHoja('gss', usados)).toBe('gss (2)');
    expect(nombreDeHoja('Resumen', usados)).toBe('Resumen (2)');
  });

  it('usa un nombre por defecto si queda vacío', () => {
    expect(nombreDeHoja('///', new Set())).toBe('Empresa');
  });
});

describe('prepararLibro', () => {
  it('arma una hoja por empresa, con solo personas y los totales', () => {
    const libro = prepararLibro(GRUPOS);
    expect(libro.hojas.map((h) => h.nombre)).toEqual(['GSS', 'ONE LATAM PHARMA', 'ABAMIA', 'KELAB']);
    expect(libro.hojas[0].filas).toHaveLength(3);
    expect(libro.hojas[1].filas).toEqual([
      { nombre: 'Angie Lizeth Angarita Pérez', correo: 'angie.angarita@onelatampharma.com' },
    ]);
    expect(libro.totalPersonas).toBe(4);
    expect(libro.totalExcluidos).toBe(5);
    expect(libro.resumen[0]).toMatchObject({ empresa: 'GSS', personas: 3, excluidos: 2 });
    expect(libro.resumen[1]).toMatchObject({ empresa: 'ONE LATAM PHARMA', personas: 1, excluidos: 3 });
  });

  it('deja visible qué empresas no tienen datos', () => {
    const libro = prepararLibro(GRUPOS);
    expect(libro.hojas[2].aviso).toBe('Sin acceso configurado para este tenant.');
    expect(libro.hojas[2].filas).toEqual([]);
    expect(libro.hojas[3].aviso).toBe('Sin personas con licencia activa.');
    expect(libro.hojas[0].aviso).toBeNull();
  });

  it('con una lista vacía devuelve un libro vacío', () => {
    expect(prepararLibro([])).toEqual({ resumen: [], hojas: [], totalPersonas: 0, totalExcluidos: 0 });
  });
});

describe('nombreArchivoCorreos', () => {
  it('usa la fecha local con ceros a la izquierda', () => {
    expect(nombreArchivoCorreos(new Date(2026, 10, 5, 10, 0))).toBe('correos-corporativos-2026-11-05.xlsx');
    expect(nombreArchivoCorreos(new Date(2026, 0, 9))).toBe('correos-corporativos-2026-01-09.xlsx');
  });
});
