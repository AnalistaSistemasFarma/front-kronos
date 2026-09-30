import { describe, expect, it } from 'vitest';
import { buildProcessCascade, filterMasterList, foldText, matchesSearch, sortMasterList, type SgcMasterItem } from '../masterList';

const item = (over: Partial<SgcMasterItem> & { code: string; title: string }): SgcMasterItem => ({
  idDocument: Math.floor(Math.random() * 1e6),
  status: 'vigente',
  confidentiality: 'publica',
  versionNumber: 1,
  idVersion: 1,
  effectiveDate: '2026-01-01',
  reviewDueDate: '2029-01-01',
  processType: { id: 2, code: 'M', name: 'Misionales', color: 'green' },
  process: { id: 20, code: 'GC', name: 'Gestión de Calidad', department: 'GARANTÍA DE CALIDAD' },
  documentType: { id: 200, code: 'PR', name: 'Procedimiento', pluralName: 'Procedimientos', alertMonths: 2 },
  ...over,
});

const pr1 = item({ code: 'OLP-GC-PR-001', title: 'Control de documentos' });
const pr10 = item({ code: 'OLP-GC-PR-010', title: 'Gestión de cambios' });
const pr2 = item({ code: 'OLP-GC-PR-002', title: 'Auditorías internas' });
const ma1 = item({
  code: 'OLP-GC-MA-001',
  title: 'Manual de calidad',
  documentType: { id: 100, code: 'MA', name: 'Manual', pluralName: 'Manuales', alertMonths: 2 },
});
const th = item({
  code: 'OLP-TH-FO-001',
  title: 'Formato de inducción',
  processType: { id: 3, code: 'S', name: 'Soporte', color: 'blue' },
  process: { id: 30, code: 'TH', name: 'Talento Humano', department: null },
  documentType: { id: 300, code: 'FO', name: 'Formato', pluralName: 'Formatos', alertMonths: 2 },
});
const all = [pr10, th, pr1, ma1, pr2];

describe('SGC · listado maestro', () => {
  it('[SGC-REQ-015] busca por código o título, sin distinguir tildes ni mayúsculas', () => {
    expect(foldText('  GESTIÓN ')).toBe('gestion');
    expect(matchesSearch(pr10, 'gestion')).toBe(true);
    expect(matchesSearch(pr1, 'olp-gc-pr-001')).toBe(true);
    expect(matchesSearch(pr1, 'control documentos')).toBe(true);
    expect(matchesSearch(pr1, 'control auditorías')).toBe(false);
    expect(matchesSearch(pr1, '')).toBe(true);
  });

  it('[SGC-REQ-015] filtra por tipo de proceso, proceso, tipo documental y estado', () => {
    expect(filterMasterList(all, { processTypeId: 3 })).toEqual([th]);
    expect(filterMasterList(all, { processId: 20, documentTypeId: 100 })).toEqual([ma1]);
    expect(filterMasterList(all, { q: 'PR', documentTypeId: 200 })).toHaveLength(3);
    expect(filterMasterList(all, { status: 'obsoleto' })).toEqual([]);
    expect(filterMasterList(all, {})).toHaveLength(5);
  });

  it('[SGC-REQ-015] ordena por código con orden natural (PR-002 antes que PR-010)', () => {
    expect(sortMasterList(all).map((i) => i.code)).toEqual(['OLP-GC-MA-001', 'OLP-GC-PR-001', 'OLP-GC-PR-002', 'OLP-GC-PR-010', 'OLP-TH-FO-001']);
  });
});

describe('SGC · mapa de procesos en cascada', () => {
  const types = [
    { id: 3, code: 'S', name: 'Soporte', color: 'blue', sortOrder: 3 },
    { id: 1, code: 'E', name: 'Estratégicos', color: 'yellow', sortOrder: 1 },
    { id: 2, code: 'M', name: 'Misionales', color: 'green', sortOrder: 2 },
  ];
  const processes = [
    { id: 20, idProcessType: 2, code: 'GC', name: 'Gestión de Calidad', sortOrder: 1 },
    { id: 21, idProcessType: 2, code: 'DT', name: 'Dirección Técnica', sortOrder: 0 },
    { id: 30, idProcessType: 3, code: 'TH', name: 'Talento Humano', sortOrder: 1 },
  ];
  const docTypes = [
    { id: 300, code: 'FO', name: 'Formato', pluralName: 'Formatos', sortOrder: 4 },
    { id: 100, code: 'MA', name: 'Manual', pluralName: 'Manuales', sortOrder: 1 },
    { id: 200, code: 'PR', name: 'Procedimiento', pluralName: 'Procedimientos', sortOrder: 2 },
  ];

  it('[SGC-REQ-016] tipo de proceso → proceso → carpeta por tipo documental → documento, en el orden configurado', () => {
    const cascade = buildProcessCascade(types, processes, docTypes, all);
    expect(cascade.map((t) => t.processType.name)).toEqual(['Estratégicos', 'Misionales', 'Soporte']);
    expect(cascade.map((t) => t.total)).toEqual([0, 4, 1]);
    const misionales = cascade[1];
    expect(misionales.processes.map((p) => p.process.code)).toEqual(['DT', 'GC']);
    const gc = misionales.processes[1];
    expect(gc.folders.map((f) => f.documentType.pluralName)).toEqual(['Manuales', 'Procedimientos']);
    expect(gc.folders[1].documents.map((d) => d.code)).toEqual(['OLP-GC-PR-001', 'OLP-GC-PR-002', 'OLP-GC-PR-010']);
  });

  it('[SGC-REQ-016] muestra procesos sin documentos pero no carpetas vacías', () => {
    const cascade = buildProcessCascade(types, processes, docTypes, all);
    const dt = cascade[1].processes[0];
    expect(dt.total).toBe(0);
    expect(dt.folders).toEqual([]);
    expect(cascade[0].processes).toEqual([]);
  });
});
