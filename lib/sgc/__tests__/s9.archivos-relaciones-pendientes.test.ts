import { describe, expect, it } from 'vitest';
import { SGC_BULK_NAME_THRESHOLD, baseName, matchBulkFile, matchBulkFiles, nameSimilarity, nameTokens, type SgcBulkCandidate } from '../bulkUpload';
import {
  SGC_DEFAULT_EMAIL_MODE,
  SGC_EMAIL_MODES,
  alertEmailsAllowed,
  buildDigestMessage,
  countPendings,
  isSgcEmailMode,
  pendingGroupOf,
} from '../pendings';
import { SGC_PROPOSAL_TYPE_BY_CHILD, pairKey, proposalFor, proposeRelations, type SgcProposalDoc } from '../relationProposals';

/**
 * Sprint 9 — carga masiva de los PDF del listado maestro (emparejamiento por
 * código y aviso de nombre), «Relacionar documentos» (propuestas por código)
 * y «Mis pendientes» con la política de correo por empresa.
 */
const docs: SgcBulkCandidate[] = [
  { idDocument: 1, code: 'OLP-GCC-02', title: 'Almacenamiento y distribución de producto acondicionado', status: 'pendiente_archivo' },
  { idDocument: 2, code: 'OLP-GCC-02-FO01', title: 'Formato de recolección de devoluciones', status: 'pendiente_archivo' },
  { idDocument: 3, code: 'OLP-DT-01', title: 'Manual de dirección técnica', status: 'vigente' },
  { idDocument: 4, code: 'OLP-DT-09', title: 'Manual anulado', status: 'anulado' },
];

describe('SGC · S9 · carga masiva de PDF por código', () => {
  it('[SGC-REQ-117] empareja cada PDF con su documento por el código al inicio del nombre (el más largo gana)', () => {
    expect(matchBulkFile('OLP-GCC-02 Almacenamiento y distribución.pdf', docs)).toMatchObject({ idDocument: 1, code: 'OLP-GCC-02', status: 'cargable', warning: null });
    expect(matchBulkFile('olp-gcc-02-fo01_recoleccion_devoluciones.PDF', docs)).toMatchObject({ idDocument: 2, status: 'cargable', warning: null });
    expect(matchBulkFile('C:\\Calidad\\OLP-GCC-02.pdf', docs)).toMatchObject({ idDocument: 1, similarity: null, warning: null });
    expect(matchBulkFile('OLP-GCC-021 otro.pdf', docs)).toMatchObject({ status: 'error', error: expect.stringContaining('no empieza con el código') });
    expect(matchBulkFile('OLP-GCC-02.docx', docs)).toMatchObject({ status: 'error', error: 'Solo se cargan archivos PDF.' });
    expect(matchBulkFile('OLP-DT-01 Manual.pdf', docs)).toMatchObject({ status: 'error', error: expect.stringContaining('ya tiene su archivo') });
    expect(matchBulkFile('OLP-DT-09.pdf', docs)).toMatchObject({ status: 'error', error: expect.stringContaining('anulado') });
  });

  it('[SGC-REQ-117] avisa (sin bloquear) cuando el nombre del archivo no coincide con el del listado', () => {
    const m = matchBulkFile('OLP-GCC-02 Procedimiento de compras internacionales.pdf', docs);
    expect(m.status).toBe('cargable');
    expect(m.similarity).toBeLessThan(SGC_BULK_NAME_THRESHOLD);
    expect(m.warning).toContain('no coincide con el del listado');
    expect(nameSimilarity('almacenamiento distribucion producto acondicionado', docs[0].title)).toBe(1);
    expect(nameSimilarity('almacenam. distribuc', docs[0].title)).toBe(0.5);
    expect(nameSimilarity('de la', docs[0].title)).toBeNull();
    expect(nameSimilarity('algo', 'de la')).toBeNull();
    expect(nameTokens('Versión vigente de la COPIA del Manual')).toEqual(['manual']);
    expect(baseName('a/b/OLP.pdf')).toBe('OLP');
  });

  it('[SGC-REQ-117] en una misma tanda un documento recibe un solo archivo', () => {
    const r = matchBulkFiles(['OLP-GCC-02 a.pdf', 'OLP-GCC-02 b.pdf', 'X.pdf'], docs);
    expect(r.map((m) => m.status)).toEqual(['cargable', 'error', 'error']);
    expect(r[1].error).toContain('ya recibe el archivo «OLP-GCC-02 a.pdf»');
  });
});

describe('SGC · S9 · «Relacionar documentos» por código', () => {
  const d = (id: number, code: string, type: string, extra: Partial<SgcProposalDoc> = {}): SgcProposalDoc => ({ id, code, status: 'vigente', documentTypeCode: type, processCode: 'GCC', processTypeCode: 'M', ...extra });
  const guide = { prefix: 'OLP', pattern: '{PREFIJO}-{PROCESO}-{CONSECUTIVO}', sequenceDigits: 2, childPattern: '{CODIGO_PADRE}-{TIPO}{CONSECUTIVO}', childTypeCodes: ['FO', 'IN'], childSequenceDigits: 2 };

  it('[SGC-REQ-118] propone formato → procedimiento y procedimiento padre → instructivo por la guía; el formato «es formato de» y el instructivo cuelga del padre', () => {
    const list = [d(1, 'OLP-GCC-02', 'PR'), d(2, 'OLP-GCC-02-FO01', 'FO'), d(3, 'OLP-GCC-02-IN01', 'IN'), d(4, 'OLP-GCC-03', 'PR')];
    const p = proposeRelations(list, { guide, listParents: new Map(), related: new Set() });
    expect(p).toEqual([
      { idSource: 2, idTarget: 1, type: 'formato', origin: 'codigo', reason: 'OLP-GCC-02-FO01 hereda el número de OLP-GCC-02 (guía de codificación).' },
      { idSource: 1, idTarget: 3, type: 'procedimiento_padre', origin: 'codigo', reason: 'OLP-GCC-02-IN01 hereda el número de OLP-GCC-02 (guía de codificación).' },
    ]);
  });

  it('[SGC-REQ-118] sin guía de herencia propone por el prefijo del código (padre inmediato) y por el «documento padre» del listado; nunca repite lo ya relacionado ni usa anulados', () => {
    const list = [
      d(1, 'GCC-PR-02', 'PR'),
      d(2, 'GCC-PR-02-F1', 'FO'),
      d(5, 'GCC-PR-02-F1-A', 'AN'),
      d(3, 'GCC-PR-020', 'PR'),
      d(4, 'GCC-PR-02.ANX', 'AN', { status: 'anulado' }),
      d(6, 'MANUAL-GCC', 'MA'),
      d(7, 'Formato suelto', 'FO'),
    ];
    const p = proposeRelations(list, { guide: null, listParents: new Map([[7, 'manual-gcc'], [2, 'GCC-PR-02']]), related: new Set([pairKey(3, 1)]) });
    expect(p.map((x) => [x.idSource, x.type, x.idTarget, x.origin])).toEqual([
      [2, 'formato', 1, 'listado'],
      [7, 'formato', 6, 'listado'],
      [5, 'anexo', 2, 'codigo'],
    ]);
    // Con la guía, un hijo cuyo código no hereda del padre no se propone por la guía, pero sí por prefijo si el padre no es de un tipo que hereda.
    const q = proposeRelations([d(1, 'OLP-GCC-02', 'PR'), d(2, 'OLP-GCC-02-F-1', 'FO'), d(3, 'OLP-GCC-02-FO01-X', 'IN')], { guide, listParents: new Map([[9, 'NO-EXISTE']]), related: new Set() });
    expect(q.map((x) => [x.idSource, x.idTarget, x.reason.includes('empieza')])).toEqual([[2, 1, true], [1, 3, true]]);
  });

  it('[SGC-REQ-118] tipo de la relación según el tipo del hijo (configurable) y par sin sentido', () => {
    expect(SGC_PROPOSAL_TYPE_BY_CHILD.FO).toBe('formato');
    const parent = d(1, 'P', 'PR');
    expect(proposalFor(parent, d(2, 'P-AN', 'an'), 'codigo', 'x')).toMatchObject({ idSource: 2, idTarget: 1, type: 'anexo' });
    expect(proposalFor(parent, d(2, 'P-ES', 'ES'), 'codigo', 'x')).toMatchObject({ idSource: 1, idTarget: 2, type: 'procedimiento_padre' });
    expect(pairKey(9, 3)).toBe('3:9');
    expect(proposeRelations([d(1, 'A', 'PR')], { guide: null, listParents: new Map([[1, 'A']]), related: new Set() })).toEqual([]);
    // Un padre sin número no se puede heredar con la guía: no se propone por la guía.
    const g2 = { ...guide, childPattern: '{PREFIJO}-{NUMERO_PADRE}-{TIPO}{CONSECUTIVO}' };
    expect(proposeRelations([d(1, 'MANUAL', 'PR'), d(2, 'OLP-01-FO01', 'FO')], { guide: g2, listParents: new Map(), related: new Set() })).toEqual([]);
  });
});

describe('SGC · S9 · «Mis pendientes» y política de correo', () => {
  it('[SGC-REQ-120] agrupa los pendientes de la persona: tareas, lecturas, autorizaciones, capacitaciones (y copias desde el S11)', () => {
    expect(pendingGroupOf({ role: 'alcance', taskKey: 'divulgacion', isAuthorization: false })).toBe('lecturas');
    expect(pendingGroupOf({ role: 'x', taskKey: 'divulgacion', isAuthorization: false })).toBe('lecturas');
    expect(pendingGroupOf({ role: 'capacitacion', taskKey: 'capacitacion', isAuthorization: true })).toBe('capacitaciones');
    expect(pendingGroupOf({ role: 'x', taskKey: 'capacitacion', isAuthorization: false })).toBe('capacitaciones');
    expect(pendingGroupOf({ role: 'aprobador', taskKey: 'aprobacion', isAuthorization: true })).toBe('autorizaciones');
    expect(pendingGroupOf({ role: 'elaborador', taskKey: 'elaboracion', isAuthorization: false })).toBe('tareas');
    const c = countPendings(
      [
        { role: 'elaborador', taskKey: 'elaboracion', isAuthorization: false },
        { role: 'alcance', taskKey: 'divulgacion', isAuthorization: false },
        { role: 'aprobador', taskKey: 'aprobacion', isAuthorization: true },
      ],
      { copias: 2 }
    );
    expect(c).toEqual({ tareas: 1, lecturas: 1, autorizaciones: 1, capacitaciones: 0, copias: 2, total: 5 });
  });

  it('[SGC-REQ-121] el correo está apagado por defecto; solo «vencimientos» deja salir los avisos por correo; el resumen diario solo a quien tiene pendientes', () => {
    expect(SGC_DEFAULT_EMAIL_MODE).toBe('nunca');
    expect(SGC_EMAIL_MODES).toEqual(['nunca', 'vencimientos', 'resumen_diario']);
    expect(isSgcEmailMode('resumen_diario')).toBe(true);
    expect(isSgcEmailMode('siempre')).toBe(false);
    expect(alertEmailsAllowed('vencimientos')).toBe(true);
    expect(alertEmailsAllowed('nunca')).toBe(false);
    expect(alertEmailsAllowed('resumen_diario')).toBe(false);
    expect(alertEmailsAllowed(null)).toBe(false);
    const zero = countPendings([]);
    expect(buildDigestMessage('a@b.co', 'OLP', zero, 'https://s/', 3)).toBeNull();
    const m = buildDigestMessage('a@b.co', 'ONE LATAM PHARMA', countPendings([{ role: 'alcance', taskKey: 'divulgacion', isAuthorization: false }]), 'https://synerlink/', 3)!;
    expect(m).toEqual({
      to: 'a@b.co',
      title: 'Sus pendientes del SGC · ONE LATAM PHARMA',
      rows: [{ label: 'Lecturas obligatorias', value: '1' }],
      outro: 'Tiene 1 pendiente(s) en el SGC documental. Revíselos en SynerLink: https://synerlink/process/sgc-documental?empresa=3',
    });
  });
});
