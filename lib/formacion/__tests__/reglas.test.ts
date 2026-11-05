import { describe, expect, it } from 'vitest';
import {
  ariaPendientes,
  cursoVisiblePara,
  esAdministrador,
  etiquetaPendientes,
  par,
  puedeAdministrarCurso,
  puedeAdministrarEmpresa,
  type PerfilColaborador,
} from '../reglas';

// Módulo Formación (Nicolás Rivera, 2026-10-26): permisos por empresa y alcance por empresa y departamento.
const perfil = (empresas: number[], departamentos: number[] = [], pares: Array<[number, number]> = []): PerfilColaborador => ({
  empresas: new Set(empresas),
  departamentos: new Set(departamentos),
  pares: new Set(pares.map(([e, d]) => par(e, d))),
});

describe('Formación · quién administra', () => {
  it('con el permiso en GSS administra todo, incluidos los cursos de todas las empresas', () => {
    const gss = { empresas: [8], esGlobal: true };
    expect(esAdministrador(gss)).toBe(true);
    expect(puedeAdministrarCurso(gss, null)).toBe(true);
    expect(puedeAdministrarCurso(gss, 3)).toBe(true);
    expect(puedeAdministrarEmpresa(gss, 1)).toBe(true);
  });

  it('con el permiso en una empresa solo administra los cursos de esa empresa', () => {
    const olp = { empresas: [3], esGlobal: false };
    expect(puedeAdministrarCurso(olp, 3)).toBe(true);
    expect(puedeAdministrarCurso(olp, 1)).toBe(false);
    expect(puedeAdministrarCurso(olp, null)).toBe(false);
    expect(puedeAdministrarEmpresa(olp, 1)).toBe(false);
  });

  it('sin permiso no administra nada', () => {
    expect(esAdministrador({ empresas: [], esGlobal: false })).toBe(false);
    expect(esAdministrador(null)).toBe(false);
    expect(puedeAdministrarCurso(null, null)).toBe(false);
  });
});

describe('Formación · quién ve un curso', () => {
  it('sin alcance, el curso es para todas las empresas y departamentos', () => {
    expect(cursoVisiblePara([], perfil([]))).toBe(true);
  });

  it('activo en la empresa para todos sus departamentos', () => {
    const alcance = [{ id_company: 3, id_department: null, activo: true }];
    expect(cursoVisiblePara(alcance, perfil([3]))).toBe(true);
    expect(cursoVisiblePara(alcance, perfil([1]))).toBe(false);
  });

  it('por departamento: solo quien está en ese departamento de esa empresa', () => {
    const alcance = [
      { id_company: 3, id_department: 10, activo: true },
      { id_company: 3, id_department: 11, activo: false },
    ];
    expect(cursoVisiblePara(alcance, perfil([3], [10]))).toBe(true);
    expect(cursoVisiblePara(alcance, perfil([3], [11]))).toBe(false);
    expect(cursoVisiblePara(alcance, perfil([3], [], [[3, 10]]))).toBe(true);
    expect(cursoVisiblePara(alcance, perfil([1], [10]))).toBe(false);
  });

  it('una fila inactiva no da acceso', () => {
    expect(cursoVisiblePara([{ id_company: 3, id_department: null, activo: false }], perfil([3]))).toBe(false);
  });
});

describe('Formación · contador del header', () => {
  it('etiqueta y texto accesible', () => {
    expect(etiquetaPendientes(0)).toBeNull();
    expect(etiquetaPendientes(3)).toBe('3');
    expect(etiquetaPendientes(120)).toBe('99+');
    expect(ariaPendientes(1)).toContain('1 curso o video pendiente');
    expect(ariaPendientes(0)).toContain('sin cursos');
  });
});
