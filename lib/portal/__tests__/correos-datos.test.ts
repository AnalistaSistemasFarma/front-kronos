import { describe, expect, it } from 'vitest';
import {
  TODAS_LAS_EMPRESAS,
  contarCorreos,
  filtrarGruposCorreo,
  opcionesEmpresa,
  type GrupoCorreo,
} from '../correos-datos';

// Filtro por empresa de Correos Corporativos (Cristian, 2026-10-08).

const GRUPOS: GrupoCorreo[] = [
  {
    empresa: 'GSS',
    dominio: 'gsslatam.com',
    estado: 'ok',
    usuarios: [
      { nombre: 'Nicolás Rivera', correo: 'nicolas.rivera@gsslatam.com' },
      { nombre: 'Cristian Baldión', correo: 'cristian.baldion@gsslatam.com' },
    ],
  },
  {
    empresa: 'RYAN',
    dominio: 'ryanlab.com',
    estado: 'ok',
    usuarios: [{ nombre: 'Laura Gómez', correo: 'laura.gomez@ryanlab.com' }],
  },
  { empresa: 'ABAMIA', dominio: 'abamialabs.com', estado: 'sin_acceso', usuarios: [] },
];

describe('opcionesEmpresa', () => {
  it('pone "Todas" primero y una opción por empresa presente', () => {
    expect(opcionesEmpresa(GRUPOS)).toEqual([
      { value: TODAS_LAS_EMPRESAS, label: 'Todas las empresas' },
      { value: 'gsslatam.com', label: 'GSS' },
      { value: 'ryanlab.com', label: 'RYAN' },
      { value: 'abamialabs.com', label: 'ABAMIA' },
    ]);
  });
});

describe('filtrarGruposCorreo', () => {
  it('con "Todas" y sin búsqueda devuelve todo igual', () => {
    expect(filtrarGruposCorreo(GRUPOS, TODAS_LAS_EMPRESAS, '')).toEqual(GRUPOS);
  });

  it('deja solo la sección de la empresa elegida', () => {
    const r = filtrarGruposCorreo(GRUPOS, 'ryanlab.com', '  ');
    expect(r.map((g) => g.empresa)).toEqual(['RYAN']);
  });

  it('una empresa sin acceso se puede elegir y conserva su estado', () => {
    const r = filtrarGruposCorreo(GRUPOS, 'abamialabs.com', '');
    expect(r).toEqual([GRUPOS[2]]);
  });

  it('busca por nombre sin tildes ni mayúsculas y oculta empresas sin coincidencias', () => {
    const r = filtrarGruposCorreo(GRUPOS, TODAS_LAS_EMPRESAS, 'NICOLAS');
    expect(r).toHaveLength(1);
    expect(r[0].usuarios).toEqual([{ nombre: 'Nicolás Rivera', correo: 'nicolas.rivera@gsslatam.com' }]);
  });

  it('busca por correo y combina con la empresa', () => {
    expect(contarCorreos(filtrarGruposCorreo(GRUPOS, TODAS_LAS_EMPRESAS, 'ryanlab'))).toBe(1);
    expect(filtrarGruposCorreo(GRUPOS, 'gsslatam.com', 'ryanlab')).toEqual([]);
  });

  it('exige todas las palabras', () => {
    expect(contarCorreos(filtrarGruposCorreo(GRUPOS, TODAS_LAS_EMPRESAS, 'cristian baldion'))).toBe(1);
    expect(contarCorreos(filtrarGruposCorreo(GRUPOS, TODAS_LAS_EMPRESAS, 'cristian rivera'))).toBe(0);
  });

  it('no modifica los grupos originales', () => {
    filtrarGruposCorreo(GRUPOS, TODAS_LAS_EMPRESAS, 'laura');
    expect(GRUPOS[0].usuarios).toHaveLength(2);
  });
});
