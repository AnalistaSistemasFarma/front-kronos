'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Container,
  Paper,
  Title,
  Text,
  Stack,
  Select,
  TextInput,
  NumberInput,
  Button,
  Alert,
  Loader,
  Group,
  Divider,
  Center,
} from '@mantine/core';
import { IconCheck, IconAlertCircle, IconSend } from '@tabler/icons-react';

// Página PÚBLICA (fuera de (hub), SIN login): expone SOLO los campos parametrizados de un
// proceso marcado como "Formulario externo" y permite enviar la solicitud sin iniciar sesión.
// El render de campos se replica de forma mínima (select / texto / número / fecha / monto);
// tipos avanzados (SAP, tabla) caen a un input de texto para no exponer lógica interna.

interface ExternalOption {
  id: number;
  option_label: string;
}

interface ExternalField {
  id: number;
  field_label: string;
  field_type: string;
  required: boolean;
  config_json?: string | null;
  options: ExternalOption[];
  conditions: number[];
}

interface ExternalFormConfig {
  process_name: string;
  fields: ExternalField[];
}

export default function ExternalFormPage() {
  const params = useParams();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id as string);

  const [config, setConfig] = useState<ExternalFormConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fieldValues, setFieldValues] = useState<Record<number, number | string>>({});
  const [formErrors, setFormErrors] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<number | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/public/external-form/${id}`);
        if (!active) return;
        if (res.status === 404) {
          setLoadError('Este formulario no está disponible.');
          return;
        }
        if (!res.ok) {
          setLoadError('No se pudo cargar el formulario. Intente más tarde.');
          return;
        }
        const data: ExternalFormConfig = await res.json();
        setConfig(data);
      } catch {
        if (active) setLoadError('No se pudo cargar el formulario. Intente más tarde.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  // Visibilidad condicional: un campo se muestra si no tiene condiciones o si alguna de
  // sus opciones-condición fue elegida. Solo los campos tipo lista aportan opción.
  const { visibleFields } = useMemo(() => {
    const selected = new Set<number>();
    const vis: ExternalField[] = [];
    for (const field of config?.fields || []) {
      const visible =
        field.conditions.length === 0 || field.conditions.some((c) => selected.has(c));
      if (visible) {
        vis.push(field);
        const val = fieldValues[field.id];
        if (field.field_type === 'select' && typeof val === 'number') selected.add(val);
      }
    }
    return { visibleFields: vis };
  }, [config, fieldValues]);

  const isMoneyField = (label: string) => /valor a pagar|monto/i.test(label);

  const setValue = (fieldId: number, value: number | string | undefined) => {
    setFieldValues((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '' || value === null) delete next[fieldId];
      else next[fieldId] = value;
      return next;
    });
    setFormErrors((prev) => {
      if (!prev[fieldId]) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  const validate = () => {
    const errors: Record<number, string> = {};
    for (const field of visibleFields) {
      if (!field.required) continue;
      const val = fieldValues[field.id];
      const empty = val === undefined || val === null || val === '';
      if (empty) {
        errors[field.id] =
          field.field_type === 'select'
            ? `Debe seleccionar: ${field.field_label}`
            : `Debe completar: ${field.field_label}`;
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!validate()) return;
    try {
      setSubmitting(true);
      const formValues = visibleFields
        .filter((f) => {
          const v = fieldValues[f.id];
          return v !== undefined && v !== null && v !== '';
        })
        .map((f) => {
          const v = fieldValues[f.id];
          return f.field_type === 'select'
            ? { id_field: f.id, id_option: v }
            : { id_field: f.id, value_text: String(v) };
        });

      const res = await fetch(`/api/public/external-form/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formValues }),
      });

      if (!res.ok) {
        let detail = 'No se pudo enviar la solicitud. Intente de nuevo.';
        try {
          const data = await res.json();
          if (data?.error) detail = data.error;
        } catch {
          /* noop */
        }
        setSubmitError(detail);
        return;
      }

      const data = await res.json();
      setSubmitted(Number(data.id_request) || 0);
    } catch {
      setSubmitError('No se pudo enviar la solicitud. Intente de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Center style={{ minHeight: '100vh' }}>
        <Group gap='sm'>
          <Loader size='sm' />
          <Text c='dimmed'>Cargando formulario…</Text>
        </Group>
      </Center>
    );
  }

  if (loadError) {
    return (
      <Container size='sm' py='xl'>
        <Alert icon={<IconAlertCircle size={20} />} title='No disponible' color='red'>
          {loadError}
        </Alert>
      </Container>
    );
  }

  if (submitted !== null) {
    return (
      <Container size='sm' py='xl'>
        <Paper withBorder radius='md' p='xl' shadow='sm'>
          <Stack align='center' gap='md'>
            <IconCheck size={48} color='var(--mantine-color-green-6)' />
            <Title order={3} ta='center'>
              Solicitud enviada
            </Title>
            <Text ta='center' c='dimmed'>
              Hemos recibido su solicitud correctamente
              {submitted ? ` (radicado #${submitted})` : ''}. El área encargada la revisará.
            </Text>
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
    <Container size='sm' py='xl'>
      <Paper withBorder radius='md' p='xl' shadow='sm'>
        <Stack gap='lg'>
          <div>
            <Text size='sm' c='dimmed' tt='uppercase' fw={600}>
              Formulario externo
            </Text>
            <Title order={2}>{config?.process_name || 'Solicitud'}</Title>
            <Text size='sm' c='dimmed' mt={4}>
              Complete los campos y envíe su solicitud. No necesita iniciar sesión.
            </Text>
          </div>

          <Divider />

          {submitError && (
            <Alert icon={<IconAlertCircle size={20} />} title='Error' color='red'>
              {submitError}
            </Alert>
          )}

          <Stack gap='md'>
            {visibleFields.length === 0 && (
              <Text c='dimmed' size='sm'>
                Este formulario no tiene campos configurados.
              </Text>
            )}

            {visibleFields.map((field) => {
              const raw = fieldValues[field.id];
              const err = formErrors[field.id];

              if (field.field_type === 'select') {
                return (
                  <Select
                    key={field.id}
                    label={field.field_label}
                    placeholder='Seleccione una opción'
                    required={field.required}
                    clearable
                    data={field.options.map((o) => ({
                      value: o.id.toString(),
                      label: o.option_label,
                    }))}
                    value={typeof raw === 'number' ? raw.toString() : null}
                    onChange={(value) =>
                      setValue(field.id, value ? parseInt(value, 10) : undefined)
                    }
                    error={err}
                  />
                );
              }

              if (isMoneyField(field.field_label)) {
                return (
                  <NumberInput
                    key={field.id}
                    label={field.field_label}
                    placeholder='Ingrese el valor'
                    required={field.required}
                    value={raw === undefined || raw === '' ? '' : (raw as number | string)}
                    onChange={(value) =>
                      setValue(field.id, value === '' ? undefined : (value as number))
                    }
                    thousandSeparator='.'
                    decimalSeparator=','
                    decimalScale={0}
                    allowNegative={false}
                    hideControls
                    min={0}
                    error={err}
                  />
                );
              }

              if (field.field_type === 'number') {
                return (
                  <NumberInput
                    key={field.id}
                    label={field.field_label}
                    placeholder='Ingrese un valor'
                    required={field.required}
                    value={raw === undefined ? '' : (raw as number | string)}
                    onChange={(value) =>
                      setValue(field.id, value === '' ? undefined : (value as number))
                    }
                    error={err}
                  />
                );
              }

              if (field.field_type === 'date') {
                return (
                  <TextInput
                    key={field.id}
                    type='date'
                    label={field.field_label}
                    required={field.required}
                    value={typeof raw === 'string' ? raw : ''}
                    onChange={(e) => setValue(field.id, e.currentTarget.value)}
                    error={err}
                  />
                );
              }

              // texto / SAP / tabla y cualquier otro tipo: input de texto simple.
              return (
                <TextInput
                  key={field.id}
                  label={field.field_label}
                  placeholder='Ingrese el valor'
                  required={field.required}
                  value={typeof raw === 'string' ? raw : ''}
                  onChange={(e) => setValue(field.id, e.currentTarget.value)}
                  error={err}
                />
              );
            })}
          </Stack>

          <Group justify='flex-end' mt='md'>
            <Button
              onClick={handleSubmit}
              loading={submitting}
              disabled={submitting}
              leftSection={<IconSend size={16} />}
            >
              Enviar solicitud
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}
