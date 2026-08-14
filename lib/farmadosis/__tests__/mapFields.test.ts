import { describe, expect, it } from 'vitest';
import { resolveFormKey } from '../forms';
import {
  buildDescription,
  buildSubject,
  collapseMedicamentoFields,
  mapFieldsToFormValues,
  normalizeIncomingFields,
  prepareIncomingFields,
  slugify,
  type ProcessField,
} from '../mapFields';

const fields: ProcessField[] = [
  {
    id: 10,
    field_label: 'Email',
    field_type: 'text',
  },
  {
    id: 11,
    field_label: 'Sexo',
    field_type: 'select',
    options: [
      { id: 3, option_label: 'Femenino' },
      { id: 4, option_label: 'Masculino' },
    ],
  },
  {
    id: 12,
    field_label: 'Medicamentos',
    field_type: 'text',
  },
];

describe('slugify', () => {
  it('normaliza acentos y espacios', () => {
    expect(slugify('Correo electrónico')).toBe('correo-electronico');
  });
});

describe('resolveFormKey', () => {
  it('acepta las 3 claves conocidas', () => {
    expect(resolveFormKey('contacto')).toBe('contacto');
    expect(resolveFormKey('calidad')).toBe('calidad');
    expect(resolveFormKey('farmacovigilancia')).toBe('farmacovigilancia');
  });

  it('resuelve por formName', () => {
    expect(resolveFormKey(undefined, 'Calidad web')).toBe('calidad');
  });
});

describe('normalizeIncomingFields', () => {
  it('acepta objeto plano y pone etiqueta del catálogo', () => {
    expect(normalizeIncomingFields({ email: 'a@b.co' })).toEqual([
      { key: 'email', label: 'Email', value: 'a@b.co' },
    ]);
  });

  it('acepta arreglo', () => {
    expect(normalizeIncomingFields([{ key: 'phone', value: '123' }])).toEqual([
      {
        key: 'phone',
        label: undefined,
        value: '123',
        id_field: undefined,
        id_option: undefined,
        value_text: null,
      },
    ]);
  });
});

describe('collapseMedicamentoFields', () => {
  it('agrupa medicamentos[n][campo] en un bloque', () => {
    const incoming = prepareIncomingFields({
      iniciales: 'A',
      'medicamentos[0][nombre]': 'Ibuprofeno',
      'medicamentos[0][dosis]': '400mg',
      'medicamentos[1][nombre]': 'Paracetamol',
    });
    const meds = incoming.find((item) => item.key === 'medicamentos');
    expect(meds?.value_text).toContain('Medicamento 1');
    expect(meds?.value_text).toContain('Ibuprofeno');
    expect(meds?.value_text).toContain('Medicamento 2');
    expect(incoming.some((item) => item.key?.startsWith('medicamentos['))).toBe(false);
  });
});

describe('mapFieldsToFormValues', () => {
  it('mapea email por etiqueta del catálogo y sexo por alias', () => {
    const incoming = prepareIncomingFields({
      email: 'ana@farmadosis.com',
      sexo: 'femenino',
    });
    const { formValues, unmatched } = mapFieldsToFormValues(fields, incoming);

    expect(unmatched).toHaveLength(0);
    expect(formValues).toEqual([
      { id_field: 10, id_option: null, value_text: 'ana@farmadosis.com' },
      { id_field: 11, id_option: 3, value_text: null },
    ]);
  });

  it('mapea el bloque de medicamentos', () => {
    const incoming = collapseMedicamentoFields(
      normalizeIncomingFields({ 'medicamentos[0][nombre]': 'X' })
    );
    const { formValues } = mapFieldsToFormValues(fields, incoming);
    expect(formValues[0]?.id_field).toBe(12);
    expect(formValues[0]?.value_text).toContain('X');
  });

  it('deja unmatched lo que no existe en el proceso', () => {
    const incoming = normalizeIncomingFields({ extra: 'hola' });
    const { formValues, unmatched } = mapFieldsToFormValues(fields, incoming);
    expect(formValues).toHaveLength(0);
    expect(unmatched).toHaveLength(1);
  });
});

describe('buildSubject / buildDescription', () => {
  it('arma asunto por defecto', () => {
    expect(buildSubject({ formName: 'Contacto', requesterName: 'Ana' })).toBe(
      'Contacto · Ana'
    );
  });

  it('trunca description a 1000', () => {
    const desc = buildDescription({ message: 'x'.repeat(2000) });
    expect(desc.length).toBe(1000);
  });
});
