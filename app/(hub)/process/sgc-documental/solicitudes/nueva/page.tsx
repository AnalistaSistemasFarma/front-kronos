'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Alert, Button, Card, Grid, Group, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import SgcSelect from '../../../../../../components/sgc/SgcSelect';
import { IconAlertCircle, IconBulb, IconFilePlus, IconSend } from '@tabler/icons-react';
import SgcShell from '../../../../../../components/sgc/SgcShell';
import { sgcSend, useSgcFetch } from '../../../../../../components/sgc/useSgcFetch';
import type { SgcCatalogs } from '../../../../../../lib/sgc/db/catalogs';
import type { SgcCompanyAccess } from '../../../../../../lib/sgc/permissions';
import type { SgcFormFieldDefinition } from '../../../../../../lib/sgc/flows/definition';
import type { SgcMatrixSuggestion } from '../../../../../../lib/sgc/flows/matrix';

/**
 * Solicitud documental (paso 0 del flujo): nuevo documento, nueva versión o
 * modificación de un vigente, con su justificación. Quien la crea elige al
 * elaborador (por defecto, él mismo); la matriz solo sugiere.
 */
interface FormInfo {
  flow: { code: string; name: string; version: number };
  requestTypes: { value: string; label: string }[];
  fields: SgcFormFieldDefinition[];
  steps: { key: string; name: string; isEnabled: boolean }[];
}

function NewRequestForm({ company }: { company: SgcCompanyAccess }) {
  const router = useRouter();
  const { data: session } = useSession();
  const me = (session?.user?.email ?? '').toLowerCase();
  const id = company.idCompany;
  const form = useSgcFetch<FormInfo>(`/api/sgc/requests/form?company=${id}`);
  const catalogs = useSgcFetch<SgcCatalogs>(`/api/sgc/catalogs?company=${id}`);
  const docs = useSgcFetch<{ documents: { idDocument: number; code: string; title: string; versionNumber: number | null }[] }>(`/api/sgc/documents?company=${id}`);
  const users = useSgcFetch<{ users: { email: string; name: string | null }[] }>(`/api/sgc/users?company=${id}`);
  // Sprint 5: «Iniciar nueva versión» desde el calendario o la ficha llega con ?tipo=nueva_version&documento=<id>.
  const [prefill] = useState(() => {
    if (typeof window === 'undefined') return { tipo: null as string | null, documento: null as string | null };
    const q = new URLSearchParams(window.location.search);
    const tipo = q.get('tipo');
    return { tipo: tipo === 'nueva_version' || tipo === 'modificacion' ? tipo : null, documento: /^\d+$/.test(q.get('documento') ?? '') ? q.get('documento') : null };
  });
  const [requestType, setRequestType] = useState<string | null>(prefill.tipo ?? 'nuevo');
  const [idProcess, setIdProcess] = useState<string | null>(null);
  const [idDocumentType, setIdDocumentType] = useState<string | null>(null);
  const [idDocument, setIdDocument] = useState<string | null>(prefill.tipo ? prefill.documento : null);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [elaborator, setElaborator] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedDoc = docs.data?.documents.find((d) => String(d.idDocument) === idDocument);
  const [subjectTouched, setSubjectTouched] = useState(false);
  const suggestedSubject = selectedDoc && requestType === 'nueva_version' ? `Nueva versión de ${selectedDoc.code} (V${(selectedDoc.versionNumber ?? 0) + 1})` : '';
  const suggestUrl =
    requestType === 'nuevo' && idProcess && idDocumentType ? `/api/sgc/matrix?company=${id}&process=${idProcess}&documentType=${idDocumentType}` : null;
  const sugg = useSgcFetch<{ suggestion: SgcMatrixSuggestion[] }>(suggestUrl);
  const elabHint = sugg.data?.suggestion.find((s) => s.role === 'elaborador');
  const userOptions = useMemo(() => (users.data?.users ?? []).map((u) => ({ value: u.email, label: u.name ? `${u.name} (${u.email})` : u.email })), [users.data]);

  if (!company.canManage && !company.canQuality) {
    return (
      <Alert color='yellow' icon={<IconAlertCircle size={16} />}>
        Crear solicitudes documentales requiere el permiso de gestión documental del SGC.
      </Alert>
    );
  }

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await sgcSend<{ idRequest: number }>('/api/sgc/requests', 'POST', {
        company: id,
        requestType,
        subject: subjectTouched || !prefill.tipo ? subject : subject || suggestedSubject,
        description,
        idProcess: requestType === 'nuevo' ? Number(idProcess) : undefined,
        idDocumentType: requestType === 'nuevo' ? Number(idDocumentType) : undefined,
        idDocument: requestType !== 'nuevo' ? Number(idDocument) : undefined,
        elaboratorEmail: elaborator ?? undefined,
        formValues: values,
      });
      router.push(`/process/sgc-documental/solicitudes/${res.idRequest}?empresa=${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Card shadow='sm' p='xl' radius='md' withBorder>
      <Title order={3} mb='xs' className='flex items-center gap-2'>
        <IconFilePlus size={20} />
        Nueva solicitud documental
      </Title>
      {form.data && (
        <Text size='sm' c='dimmed' mb='md'>
          Flujo «{form.data.flow.name}» versión {form.data.flow.version}: {form.data.steps.map((s) => s.name + (s.isEnabled ? '' : ' (Sprint 4)')).join(' → ')}.
        </Text>
      )}
      {(error || form.error) && (
        <Alert color='red' icon={<IconAlertCircle size={16} />} mb='md' data-testid='sgc-nueva-error'>
          {error ?? form.error}
        </Alert>
      )}
      <Stack>
        <SgcSelect label='Tipo de solicitud' data={form.data?.requestTypes ?? []} value={requestType} onChange={setRequestType} allowDeselect={false} required data-testid='sgc-nueva-tipo' />
        {requestType === 'nuevo' ? (
          <Grid>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <SgcSelect
                label='Proceso'
                required
                searchable
                data={(catalogs.data?.processes ?? []).map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` }))}
                value={idProcess}
                onChange={setIdProcess}
                data-testid='sgc-nueva-proceso'
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <SgcSelect
                label='Tipo documental'
                required
                data={(catalogs.data?.documentTypes ?? []).map((t) => ({ value: String(t.id), label: `${t.code} · ${t.name}` }))}
                value={idDocumentType}
                onChange={setIdDocumentType}
                data-testid='sgc-nueva-tipo-documental'
              />
            </Grid.Col>
          </Grid>
        ) : (
          <SgcSelect
            label='Documento vigente'
            required
            searchable
            data={(docs.data?.documents ?? []).map((d) => ({ value: String(d.idDocument), label: `${d.code} · V${d.versionNumber ?? '-'} · ${d.title}` }))}
            value={idDocument}
            onChange={setIdDocument}
            nothingFoundMessage='No hay documentos vigentes que usted pueda consultar'
            data-testid='sgc-nueva-documento'
          />
        )}
        <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true'
          label='Asunto'
          required
          value={subjectTouched || !prefill.tipo ? subject : subject || suggestedSubject}
          onChange={(e) => {
            setSubjectTouched(true);
            setSubject(e.currentTarget.value);
          }}
          placeholder={selectedDoc ? `Nueva versión de ${selectedDoc.code}` : 'Procedimiento de…'}
          data-testid='sgc-nueva-asunto'
        />
        <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Justificación' required minRows={3} autosize value={description} onChange={(e) => setDescription(e.currentTarget.value)} data-testid='sgc-nueva-justificacion' />
        <SgcSelect
          label='Elaborador'
          description='Quien crea el documento (Aseguramiento de Calidad). Confirma o reasigna los revisores, los aprobadores y la divulgación que usted sugiera.'
          required
          searchable
          data={userOptions.filter((u) => u.value !== me)}
          value={elaborator}
          onChange={setElaborator}
          data-testid='sgc-nueva-elaborador'
        />
        {elabHint && (elabHint.people.length > 0 || elabHint.cargos.length > 0) && (
          <Alert color='blue' variant='light' icon={<IconBulb size={16} />} p='xs'>
            <Text size='xs'>
              La matriz sugiere como elaborador{elabHint.fromExample ? ' (datos de ejemplo)' : ''}: {[...elabHint.people, ...elabHint.cargos.map((c) => `cargo ${c}`)].join(', ')}.
            </Text>
          </Alert>
        )}
        {(form.data?.fields ?? []).map((f) =>
          f.type === 'seleccion' || f.type === 'si_no' ? (
            <SgcSelect
              key={f.key}
              label={f.label}
              description={f.helpText ?? undefined}
              required={f.required}
              data={f.type === 'si_no' ? [{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }] : f.options.map((o) => ({ value: o, label: o }))}
              value={values[f.key] ?? null}
              onChange={(v) => setValues((p) => ({ ...p, [f.key]: v ?? '' }))}
              data-testid={`sgc-campo-${f.key}`}
            />
          ) : f.type === 'texto_largo' ? (
            <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' key={f.key} label={f.label} description={f.helpText ?? undefined} required={f.required} autosize minRows={2} value={values[f.key] ?? ''} onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.currentTarget.value }))} data-testid={`sgc-campo-${f.key}`} />
          ) : (
            <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true'
              key={f.key}
              label={f.label}
              description={f.helpText ?? undefined}
              required={f.required}
              type={f.type === 'numero' ? 'number' : f.type === 'fecha' ? 'date' : 'text'}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.currentTarget.value }))}
              data-testid={`sgc-campo-${f.key}`}
            />
          )
        )}
        <Group justify='flex-end'>
          <Button variant='default' onClick={() => router.back()}>
            Cancelar
          </Button>
          <Button leftSection={<IconSend size={16} />} loading={saving} onClick={submit} data-testid='sgc-nueva-crear'>
            Crear solicitud
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

export default function SgcNewRequestPage() {
  return (
    <SgcShell section='Nueva solicitud documental' subtitle='Paso 0 del flujo documental: registre la necesidad y su justificación.'>
      {(company) => <NewRequestForm company={company} />}
    </SgcShell>
  );
}
