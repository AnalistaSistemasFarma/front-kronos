import { describe, expect, it } from 'vitest';
import { buildChildCode, buildChildCodeRoot, nextChildSequence, parentNumberOf, validateCodingGuide, type SgcCodingGuideInput } from '../coding';
import {
  buildDocumentTree,
  filterTree,
  findListedParent,
  hierarchyOf,
  hierarchyRelationFor,
  isHierarchyRelationType,
  isProcedureType,
  parentChildError,
  parentMapOf,
  parentTypeCodesOf,
  stripTrailingNumber,
  type SgcTreeDoc,
} from '../hierarchy';
import { proposeRelations, type SgcProposalDoc } from '../relationProposals';
import type { SgcRelationType } from '../relations';

/**
 * DOCUMENTOS PADRE E HIJOS (reunión con Calidad OLP del 2026-10-19) —
 * reglas puras. Los códigos de los ejemplos siguen la nomenclatura del
 * listado maestro que envió Calidad (OLP-GGC-01-PR → OLP-GGC-01-FR-001,
 * OLP-GGC-01-IN-001; tipos PR, FR, IN, MN). Son datos de EJEMPLO: no se lee
 * ni se toca la base.
 */

const TYPES = [
  { code: 'MN', name: 'Manual', isParentType: false },
  { code: 'PR', name: 'Procedimiento', isParentType: false },
  { code: 'IN', name: 'Instructivo', isParentType: false },
  { code: 'FR', name: 'Formato', isParentType: false },
];

const doc = (id: number, code: string, documentTypeCode: string, status = 'vigente') => ({ id, code, documentTypeCode, status });

describe('SGC · padres e hijos · tipos padre', () => {
  it('[SGC-REQ-180] sin tipos marcados, el padre es el Procedimiento (por código PR o por nombre); con marca, los marcados', () => {
    expect(parentTypeCodesOf(TYPES)).toEqual(['PR']);
    expect(parentTypeCodesOf([{ code: 'PRC', name: 'Procedimientos operativos', isParentType: false }, { code: 'FO', name: 'Formato', isParentType: false }])).toEqual(['PRC']);
    expect(isProcedureType({ code: 'XX', name: '  procedimiento  ' })).toBe(true);
    expect(isProcedureType({ code: 'PT', name: 'Protocolo' })).toBe(false);
    // Calidad marca el manual y el procedimiento: el respaldo ya no aplica.
    expect(parentTypeCodesOf(TYPES.map((t) => ({ ...t, isParentType: t.code === 'MN' || t.code === 'PR' })))).toEqual(['MN', 'PR']);
    expect(parentTypeCodesOf(TYPES.map((t) => ({ ...t, isParentType: t.code === 'MN' })))).toEqual(['MN']);
    expect(parentTypeCodesOf([])).toEqual([]);
  });

  it('[SGC-REQ-181] las relaciones jerárquicas se leen con su sentido; la referencia no cuenta como padre', () => {
    expect(hierarchyOf({ source: 1, target: 2, type: 'procedimiento_padre' })).toEqual({ parent: 1, child: 2 });
    expect(hierarchyOf({ source: 2, target: 1, type: 'formato' })).toEqual({ parent: 1, child: 2 });
    expect(hierarchyOf({ source: 3, target: 1, type: 'anexo' })).toEqual({ parent: 1, child: 3 });
    expect(hierarchyOf({ source: 1, target: 2, type: 'referencia' })).toBeNull();
    expect(isHierarchyRelationType('referencia')).toBe(false);
    // El tipo de la relación sale del tipo del hijo, como las propuestas del S9.
    expect(hierarchyRelationFor(1, 2, 'FR')).toEqual({ idSource: 2, idTarget: 1, type: 'formato' });
    expect(hierarchyRelationFor(1, 3, 'fo')).toEqual({ idSource: 3, idTarget: 1, type: 'formato' });
    expect(hierarchyRelationFor(1, 4, 'AN')).toEqual({ idSource: 4, idTarget: 1, type: 'anexo' });
    expect(hierarchyRelationFor(1, 5, 'IN')).toEqual({ idSource: 1, idTarget: 5, type: 'procedimiento_padre' });
    expect(parentMapOf([{ source: 2, target: 1, type: 'formato' }, { source: 1, target: 5, type: 'procedimiento_padre' }, { source: 5, target: 9, type: 'referencia' }])).toEqual(new Map([[2, 1], [5, 1]]));
  });
});

describe('SGC · padres e hijos · reglas', () => {
  const codes = ['PR'];
  const pr01 = doc(1, 'OLP-GGC-01-PR', 'PR');
  const pr02 = doc(2, 'OLP-GGC-02-PR', 'PR');
  const fr001 = doc(3, 'OLP-GGC-01-FR-001', 'FR');
  const in001 = doc(4, 'OLP-GGC-01-IN-001', 'IN');
  const mn = doc(5, 'OLP-SEM-02-MN', 'MN');

  it('[SGC-REQ-180] el procedimiento no tiene padre: no se le asigna como hijo de nada (ni de otro procedimiento ni de un manual)', () => {
    expect(parentChildError(pr02, pr01, codes, new Map())).toMatch(/documento padre no tiene padre/);
    expect(parentChildError(mn, pr01, codes, new Map())).toMatch(/documento padre no tiene padre/);
  });

  it('[SGC-REQ-181] el padre debe ser de un tipo padre; un hijo tiene un solo padre; nada consigo mismo ni anulado', () => {
    expect(parentChildError(pr01, fr001, codes, new Map())).toBeNull();
    expect(parentChildError(in001, fr001, codes, new Map())).toMatch(/no es de un tipo documental padre .*PR/);
    expect(parentChildError(mn, fr001, codes, new Map())).toMatch(/no es de un tipo documental padre/);
    expect(parentChildError(pr02, fr001, codes, new Map([[fr001.id, pr01.id]]))).toMatch(/un hijo tiene un solo padre/);
    expect(parentChildError(pr01, fr001, codes, new Map([[fr001.id, pr01.id]]))).toMatch(/ya es hijo de OLP-GGC-01-PR/);
    expect(parentChildError(pr01, pr01, codes, new Map())).toMatch(/sí mismo/);
    expect(parentChildError(pr01, { ...in001, status: 'anulado' }, codes, new Map())).toMatch(/anulados/);
    expect(parentChildError(pr01, fr001, [], new Map())).toMatch(/ninguno configurado/);
    // Si Calidad marca el manual como padre, el manual sí recibe hijos.
    expect(parentChildError(mn, fr001, ['MN', 'PR'], new Map())).toBeNull();
  });

  it('[SGC-REQ-181] las propuestas por código y por el listado respetan las reglas cuando se dan los tipos padre', () => {
    const docs: SgcProposalDoc[] = [
      { id: 1, code: 'OLP-GGC-01-PR', status: 'vigente', documentTypeCode: 'PR', processCode: 'GGC', processTypeCode: 'S' },
      { id: 3, code: 'OLP-GGC-01-FR-001', status: 'vigente', documentTypeCode: 'FR', processCode: 'GGC', processTypeCode: 'S' },
      { id: 4, code: 'OLP-GGC-01-IN-001', status: 'vigente', documentTypeCode: 'IN', processCode: 'GGC', processTypeCode: 'S' },
      { id: 6, code: 'OLP-GGC-01-PR-ANEXO', status: 'vigente', documentTypeCode: 'PR', processCode: 'GGC', processTypeCode: 'S' },
      { id: 7, code: 'OLP-GGC-01-IN-001-FR-01', status: 'vigente', documentTypeCode: 'FR', processCode: 'GGC', processTypeCode: 'S' },
    ];
    const listParents = new Map([[3, 'OLP-GGC-01-PR'], [4, 'OLP-GGC-01-PR-1']]);
    const all = proposeRelations(docs, { guide: null, listParents, related: new Set() });
    // Sin reglas (comportamiento del S9): un procedimiento cuelga de otro por el prefijo y un formato de un instructivo.
    expect(all.some((p) => p.idTarget === 6 || p.idSource === 6)).toBe(true);
    const ruled = proposeRelations(docs, { guide: null, listParents, related: new Set(), parentTypeCodes: ['PR'], parentOf: new Map() });
    expect(ruled.map((p) => [p.idSource, p.type, p.idTarget, p.origin])).toEqual([
      [3, 'formato', 1, 'listado'],
      // El listado trae el padre con el sufijo de versión («-1»): se reconoce igual.
      [1, 'procedimiento_padre', 4, 'listado'],
    ]);
    // El documento 7 (formato de un instructivo) no tiene padre válido; el procedimiento 6 no recibe padre.
    expect(ruled.some((p) => p.idSource === 7 || p.idTarget === 7)).toBe(false);
    // Un hijo que ya tiene padre no recibe otra propuesta.
    expect(proposeRelations(docs, { guide: null, listParents, related: new Set(), parentTypeCodes: ['PR'], parentOf: new Map([[3, 99]]) }).map((p) => p.idSource)).toEqual([1]);
  });

  it('[SGC-REQ-181] el código del padre del listado se reconoce con o sin el sufijo de versión, solo con un candidato', () => {
    const docs = [doc(1, 'OLP-GGC-01-PR', 'PR'), doc(2, 'OLP-SEM-01-PR-1', 'PR'), doc(3, 'OLP-GGC-03-PR', 'PR'), doc(4, 'OLP-GGC-03-PR-2', 'PR'), doc(5, 'OLP-GGC-01-FR-001', 'FR')];
    expect(stripTrailingNumber('OLP-GGC-01-PR-1')).toBe('OLP-GGC-01-PR');
    expect(stripTrailingNumber('olp-ggc-01-pr')).toBe('OLP-GGC-01-PR');
    expect(findListedParent('OLP-GGC-01-PR', docs)?.id).toBe(1);
    expect(findListedParent('OLP-GGC-01-PR-1', docs)?.id).toBe(1);
    expect(findListedParent('OLP-SEM-01-PR', docs)?.id).toBe(2);
    expect(findListedParent('olp-sem-01-pr-1', docs)?.id).toBe(2);
    // Dos candidatos (OLP-GGC-03-PR y OLP-GGC-03-PR-2): el exacto gana; sin exacto no se adivina.
    expect(findListedParent('OLP-GGC-03-PR', docs)?.id).toBe(3);
    expect(findListedParent('OLP-GGC-03-PR-9', docs)).toBeNull();
    // Solo entre tipos padre.
    expect(findListedParent('OLP-GGC-01-FR-001', docs, ['PR'])).toBeNull();
    expect(findListedParent('', docs)).toBeNull();
  });
});

describe('SGC · padres e hijos · herencia del número con la nomenclatura del listado de Calidad', () => {
  // Padre: OLP-GGC-01-PR (prefijo, proceso, consecutivo de 2, tipo); hijo: OLP-GGC-01-FR-001 (número del padre, tipo, consecutivo de 3).
  const guide: SgcCodingGuideInput = { prefix: 'OLP', pattern: '{PREFIJO}-{PROCESO}-{CONSECUTIVO}-{TIPO}', sequenceDigits: 2, childPattern: '{PREFIJO}-{PROCESO}-{NUMERO_PADRE}-{TIPO}-{CONSECUTIVO}', childTypeCodes: ['FR', 'IN'], childSequenceDigits: 3 };
  const parentParts = { processTypeCode: 'S', processCode: 'GGC', documentTypeCode: 'PR' };

  it('[SGC-REQ-182] el hijo hereda el número del padre según el child_pattern de la empresa', () => {
    expect(validateCodingGuide(guide)).toEqual([]);
    const parent = { code: 'OLP-GGC-01-PR', parts: parentParts };
    expect(parentNumberOf(guide, parent)).toBe('01');
    expect(buildChildCodeRoot(guide, { processTypeCode: 'S', processCode: 'GGC', documentTypeCode: 'FR' }, parent)).toBe('OLP-GGC-01-FR-');
    const existing = ['OLP-GGC-01-FR-001', 'OLP-GGC-01-FR-002', 'OLP-GGC-01-FR-004', 'OLP-GGC-01-IN-001', 'OLP-GGC-02-FR-009'];
    const next = nextChildSequence(guide, { processTypeCode: 'S', processCode: 'GGC', documentTypeCode: 'FR' }, parent, existing);
    expect(next).toBe(5);
    expect(buildChildCode(guide, { processTypeCode: 'S', processCode: 'GGC', documentTypeCode: 'FR' }, parent, next)).toBe('OLP-GGC-01-FR-005');
    expect(buildChildCode(guide, { processTypeCode: 'S', processCode: 'GGC', documentTypeCode: 'IN' }, parent, 2)).toBe('OLP-GGC-01-IN-002');
    // Con el consecutivo registrado del padre se usa ese número.
    expect(parentNumberOf(guide, { code: 'OLP-GGC-04-PR', sequence: 4 })).toBe('04');
  });
});

describe('SGC · padres e hijos · árbol documental', () => {
  type D = SgcTreeDoc & { title: string };
  const d = (id: number, code: string, type: string, title = code): D => ({ id, code, title, status: 'vigente', documentTypeCode: type, versionNumber: 1, currentVersionId: id * 10 });
  const docs: D[] = [
    d(1, 'OLP-GGC-01-PR', 'PR', 'Control de documentos'),
    d(2, 'OLP-GGC-01-FR-001', 'FR', 'Listado maestro'),
    d(3, 'OLP-GGC-01-IN-001', 'IN', 'Codificación documental'),
    d(4, 'OLP-GGC-02-PR', 'PR', 'Devoluciones'),
    d(5, 'OLP-GGC-02-FR-001', 'FR', 'Devolución de producto'),
    d(6, 'OLP-SEM-02-MN', 'MN', 'Manual de tecnovigilancia'),
    d(7, 'OLP-GGC-01-FR-002', 'FR', 'Listado externo'),
    d(8, 'OLP-GGC-03-PR', 'PR', 'Auditorías'),
  ];
  const edges: { source: number; target: number; type: SgcRelationType }[] = [
    { source: 2, target: 1, type: 'formato' },
    { source: 1, target: 3, type: 'procedimiento_padre' },
    { source: 5, target: 4, type: 'formato' },
    { source: 7, target: 1, type: 'formato' },
    // Dato viejo: el FR-002 también colgado del 02.
    { source: 7, target: 4, type: 'formato' },
    { source: 3, target: 6, type: 'referencia' },
  ];

  it('[SGC-REQ-184] cada procedimiento con lo que se desprende de él, en orden; sin padre aparte; avisa los hijos con dos padres', () => {
    const tree = buildDocumentTree(docs, edges, ['PR']);
    expect(tree.roots.map((r) => [r.doc.code, r.descendants, r.children.map((c) => [c.doc.code, c.relationType])])).toEqual([
      ['OLP-GGC-01-PR', 3, [['OLP-GGC-01-FR-001', 'formato'], ['OLP-GGC-01-FR-002', 'formato'], ['OLP-GGC-01-IN-001', 'procedimiento_padre']]],
      ['OLP-GGC-02-PR', 2, [['OLP-GGC-01-FR-002', 'formato'], ['OLP-GGC-02-FR-001', 'formato']]],
      ['OLP-GGC-03-PR', 0, []],
    ]);
    expect(tree.orphans.map((o) => o.code)).toEqual(['OLP-SEM-02-MN']);
    expect(tree.multipleParents.map((m) => [m.doc.code, m.parents.map((p) => p.code)])).toEqual([['OLP-GGC-01-FR-002', ['OLP-GGC-01-PR', 'OLP-GGC-02-PR']]]);
    // La versión vigente viaja para abrirla en el visor.
    expect(tree.roots[0].children[0].doc.currentVersionId).toBe(20);
  });

  it('[SGC-REQ-184] solo con lo visible: una relación hacia un documento que no se ve no aparece; los ciclos de datos viejos no cuelgan la vista', () => {
    const visible = docs.filter((x) => x.id !== 3);
    expect(buildDocumentTree(visible, edges, ['PR']).roots[0].children.map((c) => c.doc.code)).toEqual(['OLP-GGC-01-FR-001', 'OLP-GGC-01-FR-002']);
    const cyc = buildDocumentTree([d(1, 'A', 'PR'), d(2, 'B', 'IN')], [{ source: 1, target: 2, type: 'procedimiento_padre' }, { source: 2, target: 1, type: 'procedimiento_padre' }], ['PR']);
    expect(cyc.roots.map((r) => [r.doc.code, r.descendants])).toEqual([['A', 1]]);
  });

  it('[SGC-REQ-184] la búsqueda conserva la rama donde está la coincidencia', () => {
    const tree = buildDocumentTree(docs, edges, ['PR']);
    expect(filterTree(tree.roots, 'codificación').map((r) => [r.doc.code, r.children.map((c) => c.doc.code)])).toEqual([['OLP-GGC-01-PR', ['OLP-GGC-01-IN-001']]]);
    expect(filterTree(tree.roots, 'ggc-02').map((r) => r.doc.code)).toEqual(['OLP-GGC-02-PR']);
    expect(filterTree(tree.roots, '')).toHaveLength(3);
    expect(filterTree(tree.roots, 'no-existe')).toEqual([]);
  });
});
