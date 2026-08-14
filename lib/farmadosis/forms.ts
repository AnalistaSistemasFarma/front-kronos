/**
 * Catálogo de los 3 formularios públicos de Farmadosis.
 * Las etiquetas deben coincidir con los campos del proceso en SynerLink.
 */

export const FARMADOSIS_FORM_KEYS = ['contacto', 'calidad', 'farmacovigilancia'] as const;
export type FarmadosisFormKey = (typeof FARMADOSIS_FORM_KEYS)[number];

export type FarmadosisFormFieldDef = {
  key: string;
  label: string;
  required?: boolean;
  type?: string;
};

export type FarmadosisFormDef = {
  formKey: FarmadosisFormKey;
  formName: string;
  processName: string;
  fields: FarmadosisFormFieldDef[];
};

const MEDICAMENTO_SUBFIELDS: FarmadosisFormFieldDef[] = [
  { key: 'nombre', label: 'Nombre del medicamento', required: true },
  { key: 'indicacion', label: 'Indicación terapéutica', required: true },
  { key: 'dosis', label: 'Dosis', required: true },
  { key: 'frecuencia', label: 'Frecuencia' },
  { key: 'fecha_inicio', label: 'Fecha de inicio del tratamiento', required: true },
  { key: 'fecha_fin', label: 'Fecha de finalización del tratamiento' },
  { key: 'via', label: 'Vía de administración', required: true },
  { key: 'registro', label: 'Número de registro sanitario', required: true },
  { key: 'lote', label: 'Número de lote', required: true },
  { key: 'diluyente', label: 'Diluyente / solvente' },
  { key: 'accion', label: 'Acción tomada', required: true },
];

export const FARMADOSIS_FORMS: Record<FarmadosisFormKey, FarmadosisFormDef> = {
  contacto: {
    formKey: 'contacto',
    formName: 'Contacto web',
    processName: 'Contacto web',
    fields: [
      { key: 'nombre', label: 'Nombre', required: true, type: 'text' },
      { key: 'email', label: 'Email', required: true, type: 'email' },
      { key: 'mensaje', label: 'Mensaje', required: true, type: 'textarea' },
    ],
  },
  calidad: {
    formKey: 'calidad',
    formName: 'Calidad web',
    processName: 'Calidad web',
    fields: [
      { key: 'nombre', label: 'Nombre', type: 'text' },
      { key: 'pais', label: 'País', required: true, type: 'text' },
      { key: 'contacto', label: 'Teléfono o correo de contacto', type: 'text' },
      { key: 'producto', label: 'Nombre del producto', required: true, type: 'text' },
      { key: 'lote', label: 'Número de lote', required: true, type: 'text' },
      { key: 'parte_afectada', label: 'Parte o función del producto afectada', type: 'textarea' },
      { key: 'descripcion', label: 'Descripción', type: 'textarea' },
      { key: 'muestra', label: '¿Dispone de una muestra para evaluación?', type: 'textarea' },
    ],
  },
  farmacovigilancia: {
    formKey: 'farmacovigilancia',
    formName: 'Farmacovigilancia web',
    processName: 'Farmacovigilancia web',
    fields: [
      { key: 'iniciales', label: 'Iniciales', required: true, type: 'select' },
      { key: 'edad', label: 'Edad', required: true, type: 'number' },
      { key: 'peso', label: 'Peso (kg)', type: 'number' },
      { key: 'talla', label: 'Talla (cm)', type: 'number' },
      { key: 'grupo_etario', label: 'Grupo etario', type: 'select' },
      { key: 'sexo', label: 'Sexo', required: true, type: 'select' },
      { key: 'embarazada', label: 'Embarazada', required: true, type: 'select' },
      { key: 'descripcion', label: 'Descripción', required: true, type: 'textarea' },
      { key: 'fecha_evento', label: 'Fecha del evento', required: true, type: 'date' },
      { key: 'resultado', label: 'Resultado del evento', type: 'select' },
      { key: 'serio', label: '¿Evento serio?', type: 'select' },
      { key: 'medicamentos', label: 'Medicamentos', type: 'textarea' },
      { key: 'antecedentes', label: 'Antecedentes médicos', type: 'textarea' },
      { key: 'concomitantes', label: 'Medicamentos concomitantes', type: 'textarea' },
      { key: 'estudios', label: 'Estudios / exámenes', type: 'textarea' },
      { key: 'reportante_nombre', label: 'Nombre del reportante', required: true, type: 'text' },
      { key: 'reportante_profesion', label: 'Profesión', type: 'text' },
      { key: 'reportante_institucion', label: 'Institución', type: 'text' },
      { key: 'reportante_telefono', label: 'Teléfono del reportante', type: 'tel' },
      { key: 'reportante_email', label: 'Email del reportante', required: true, type: 'email' },
      { key: 'autoriza_contacto', label: 'Autoriza contacto', required: true, type: 'select' },
      { key: 'acepta_politica', label: 'Acepta política de tratamiento de datos', required: true, type: 'select' },
    ],
  },
};

/** key Farmadosis → etiqueta SynerLink (para mapear por label del proceso). */
export const DEFAULT_FARMADOSIS_FIELD_MAP: Record<string, string> = Object.fromEntries(
  Object.values(FARMADOSIS_FORMS).flatMap((form) =>
    form.fields.map((field) => [field.key, field.label])
  )
);

export const MEDICAMENTO_FIELD_MAP: Record<string, string> = Object.fromEntries(
  MEDICAMENTO_SUBFIELDS.map((field) => [field.key, field.label])
);

/** Valores crudos del front → etiqueta de opción en SynerLink. */
export const SELECT_VALUE_ALIASES: Record<string, string> = {
  femenino: 'Femenino',
  masculino: 'Masculino',
  otro: 'Otro',
  'no-especifica': 'No especifica',
  si: 'Sí',
  no: 'No',
  'no-aplica': 'No aplica',
  desconocido: 'Desconocido',
  '1': 'Sí',
  '0': 'No',
  neonato: 'Neonato (0–28 días)',
  lactante: 'Lactante (1–23 meses)',
  nino: 'Niño (2–11 años)',
  adolescente: 'Adolescente (12–17 años)',
  adulto: 'Adulto (18–64 años)',
  'adulto-mayor': 'Adulto mayor (65+ años)',
  recuperado: 'Recuperado / Resuelto',
  'en-recuperacion': 'En recuperación / Resolviéndose',
  'no-recuperado': 'No recuperado / No resuelto',
  'recuperado-con-secuelas': 'Recuperado con secuelas',
  fatal: 'Fatal',
};

export function isFarmadosisFormKey(value: string | undefined): value is FarmadosisFormKey {
  return !!value && (FARMADOSIS_FORM_KEYS as readonly string[]).includes(value);
}

export function resolveFormKey(formKey?: string, formName?: string): string {
  const raw = (formKey || formName || '').trim().toLowerCase();
  if (isFarmadosisFormKey(raw)) return raw;
  const byName = Object.values(FARMADOSIS_FORMS).find(
    (form) => form.formName.toLowerCase() === (formName || formKey || '').trim().toLowerCase()
  );
  return byName?.formKey || raw || 'default';
}

export function getFormDef(formKey: string): FarmadosisFormDef | null {
  return isFarmadosisFormKey(formKey) ? FARMADOSIS_FORMS[formKey] : null;
}

export function labelForFieldKey(key: string): string | undefined {
  if (DEFAULT_FARMADOSIS_FIELD_MAP[key]) return DEFAULT_FARMADOSIS_FIELD_MAP[key];
  const indexed = /^medicamentos\[(\d+)\]\[(\w+)\]$/.exec(key);
  if (!indexed) return undefined;
  const index = Number(indexed[1]) + 1;
  const sub = MEDICAMENTO_FIELD_MAP[indexed[2]] || indexed[2];
  return `Medicamento ${index} · ${sub}`;
}
