/**
 * Qué tipo de trabajo es un paso del flujo, según el nombre de la tarea. Sirve para mostrar
 * un ícono acorde (subir archivo, revisar, aprobar, pagar…) en la barra de avance.
 */
export type FlowStepKind =
  | 'upload'
  | 'review'
  | 'approve'
  | 'sign'
  | 'payment'
  | 'purchase'
  | 'send'
  | 'delivery'
  | 'schedule'
  | 'people'
  | 'training'
  | 'register'
  | 'fix'
  | 'comment'
  | 'document'
  | 'close'
  | 'task';

/** Del más específico al más general: gana la primera regla que coincida. */
const RULES: Array<[FlowStepKind, RegExp]> = [
  ['upload', /\b(carg|subi|sub[ea]|adjunt|anex)/],
  ['sign', /\bfirm/],
  ['review', /\b(revis|valid|verific|audit|analiz|evalu|inspecc|control)/],
  ['approve', /\b(aprob|autoriz|visto bueno|vobo|acept)/],
  ['payment', /\b(pag|tesorer|factur|cobr|desembols|legaliz|anticip)/],
  ['purchase', /\b(compr|cotiz|orden de compra|proveedor)/],
  ['send', /\b(envi|correo|notific|comunic|radic)/],
  ['delivery', /\b(entreg|despach|recib|transport|log[ií]stic)/],
  ['schedule', /\b(agend|reuni|cita|program|calendar)/],
  ['people', /\b(entrevist|selecci|contrat(ar|aci)|vincul|personal|emplead)/],
  ['training', /\b(capacit|formaci|induc|entren)/],
  ['register', /\b(registr|ingres|crea|sap|digit|actualiz|parametriz)/],
  ['fix', /\b(correg|ajust|solucion|repar|soporte|mantenim)/],
  ['comment', /\b(respond|respuesta|observ|coment|retroaliment)/],
  ['close', /\b(cierr|cerr|finaliz|termin|archivar)/],
  ['document', /\b(document|archiv|contrato|informe|acta|certific|formato)/],
];

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function flowStepKind(name: string | null | undefined): FlowStepKind {
  const text = normalize(String(name || ''));
  for (const [kind, rule] of RULES) {
    if (rule.test(text)) return kind;
  }
  return 'task';
}
