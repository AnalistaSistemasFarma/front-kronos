'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Alert, Anchor, Button, Card, FileInput, Grid, Group, Loader, NumberInput, Select, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconFileTypePdf, IconFileTypeDoc, IconUpload } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import { sgcHref } from '../../../../../components/sgc/useSgcCompany';
import { useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import { buildCodeRoot } from '../../../../../lib/sgc/coding';
import { SGC_BASE_URL, SGC_CONFIDENTIALITY_LABELS, SGC_CONFIDENTIALITY_LEVELS } from '../../../../../lib/sgc/constants';
import type { SgcCatalogs } from '../../../../../lib/sgc/db/catalogs';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

/**
 * CARGA ADMINISTRATIVA INICIAL (Sprint 1, solo Aseguramiento de Calidad):
 * alta de un documento que YA está vigente, con su versión y fecha de
 * vigencia reales y su PDF controlado (y opcionalmente el Word fuente), para
 * poder mostrar el listado maestro ante el INVIMA. El flujo completo de
 * elaboración, revisión y aprobación llega en el Sprint 2.
 */

type Result = { idDocument: number; code: string; pdfSha256: string; storagePath: string };

function today(): string {
  // Fecha de hoy en Colombia (UTC−5).
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

function Carga({ company }: { company: SgcCompanyAccess }) {
  const catalogs = useSgcFetch<SgcCatalogs>(`/api/sgc/catalogs?company=${company.idCompany}`);
  const [idProcess, setIdProcess] = useState<string | null>(null);
  const [idDocumentType, setIdDocumentType] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [confidentiality, setConfidentiality] = useState<string>('publica');
  const [owner, setOwner] = useState<string | null>(null);
  const [versionNumber, setVersionNumber] = useState<number | string>(1);
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [changeDescription, setChangeDescription] = useState('');
  const [pdf, setPdf] = useState<File | null>(null);
  const [source, setSource] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const data = catalogs.data;
  const process = data?.processes.find((p) => String(p.id) === idProcess) ?? null;
  const docType = data?.documentTypes.find((t) => String(t.id) === idDocumentType) ?? null;

  const codePreview = useMemo(() => {
    if (!data?.codingGuide || !process || !docType) return null;
    const type = data.processTypes.find((t) => t.id === process.idProcessType);
    const g = { prefix: data.codingGuide.prefix, pattern: data.codingGuide.pattern, sequenceDigits: data.codingGuide.sequenceDigits };
    const root = buildCodeRoot(g, { processTypeCode: type?.code ?? '', processCode: process.code, documentTypeCode: docType.code });
    return `${root}${'#'.repeat(g.sequenceDigits)}`;
  }, [data, process, docType]);

  const processOptions = (data?.processTypes ?? []).map((t) => ({
    group: t.name,
    items: (data?.processes ?? []).filter((p) => p.idProcessType === t.id).map((p) => ({ value: String(p.id), label: `${p.code} · ${p.name}` })),
  }));

  const submit = async () => {
    setError(null);
    setResult(null);
    if (!idProcess || !idDocumentType || !pdf) {
      setError('Complete proceso, tipo documental y el PDF controlado.');
      return;
    }
    const form = new FormData();
    form.set('company', String(company.idCompany));
    form.set('idProcess', idProcess);
    form.set('idDocumentType', idDocumentType);
    form.set('title', title);
    form.set('code', code);
    form.set('confidentiality', confidentiality);
    if (owner) form.set('idOwnerDepartment', owner);
    form.set('versionNumber', String(versionNumber || 1));
    form.set('effectiveDate', effectiveDate);
    form.set('changeDescription', changeDescription);
    form.set('pdf', pdf);
    if (source) form.set('source', source);
    setBusy(true);
    try {
      const res = await fetch('/api/sgc/documents', { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `Error ${res.status}`);
      setResult(body as Result);
      setTitle('');
      setCode('');
      setChangeDescription('');
      setPdf(null);
      setSource(null);
      setVersionNumber(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (catalogs.error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {catalogs.error}
      </Alert>
    );
  }
  if (!data) {
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  }

  return (
    <Stack gap='lg'>
      {result && (
        <Alert color='green' icon={<IconCheck size={18} />} title={`Documento ${result.code} cargado como vigente`} data-testid='sgc-carga-ok'>
          <Text size='sm'>
            Guardado en <Text span ff='monospace'>{result.storagePath}</Text> · SHA-256{' '}
            <Text span ff='monospace'>{result.pdfSha256.slice(0, 16)}…</Text>
          </Text>
          <Anchor component={Link} href={sgcHref(`${SGC_BASE_URL}/documentos/${result.idDocument}`, company.idCompany)} size='sm'>
            Ver la ficha del documento
          </Anchor>
        </Alert>
      )}
      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)} data-testid='sgc-carga-error'>
          {error}
        </Alert>
      )}

      <Card withBorder radius='md' p='lg' shadow='xs'>
        <Text size='sm' c='dimmed' mb='md'>
          Carga administrativa de documentos que ya están vigentes. Si el documento ya tiene código, escríbalo; si no, se genera con la guía de
          codificación de la empresa{data.codingGuide ? ` (${data.codingGuide.pattern})` : ''}.
        </Text>
        <Grid gutter='md'>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Select label='Proceso' placeholder='Seleccione' data={processOptions} value={idProcess} onChange={setIdProcess} searchable required />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Select
              label='Tipo documental'
              placeholder='Seleccione'
              data={data.documentTypes.map((t) => ({ value: String(t.id), label: `${t.code} · ${t.name}` }))}
              value={idDocumentType}
              onChange={setIdDocumentType}
              required
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 8 }}>
            <TextInput label='Título' value={title} onChange={(e) => setTitle(e.currentTarget.value)} required />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <TextInput
              label='Código'
              description={codePreview ? `Vacío = siguiente consecutivo: ${codePreview}` : 'Vacío = se genera con la guía'}
              value={code}
              onChange={(e) => setCode(e.currentTarget.value.toUpperCase())}
              ff='monospace'
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Select
              label='Confidencialidad'
              data={SGC_CONFIDENTIALITY_LEVELS.map((c) => ({ value: c, label: SGC_CONFIDENTIALITY_LABELS[c] }))}
              value={confidentiality}
              onChange={(v) => setConfidentiality(v ?? 'publica')}
              allowDeselect={false}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Select
              label='Departamento dueño'
              description={process?.department ? `Vacío = el del proceso (${process.department})` : 'Vacío = el del proceso'}
              data={data.departments.map((x) => ({ value: String(x.id), label: x.name }))}
              value={owner}
              onChange={setOwner}
              clearable
              searchable
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <NumberInput label='Versión' min={1} max={999} value={versionNumber} onChange={setVersionNumber} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <TextInput type='date' label='Vigente desde' value={effectiveDate} max={today()} onChange={(e) => setEffectiveDate(e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={12}>
            <Textarea
              label='Descripción de la versión'
              placeholder='Carga inicial del documento vigente.'
              value={changeDescription}
              onChange={(e) => setChangeDescription(e.currentTarget.value)}
              minRows={2}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <FileInput
              label='PDF controlado'
              description='Es lo que se muestra en el visor (con marca de agua). Máximo 25 MB.'
              accept='application/pdf'
              leftSection={<IconFileTypePdf size={16} />}
              value={pdf}
              onChange={setPdf}
              clearable
              required
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <FileInput
              label='Word fuente (opcional)'
              description='Se guarda junto a la versión para editarla más adelante; no se muestra.'
              accept='.docx,.doc'
              leftSection={<IconFileTypeDoc size={16} />}
              value={source}
              onChange={setSource}
              clearable
            />
          </Grid.Col>
        </Grid>
        {docType && (
          <Text size='xs' c='dimmed' mt='md'>
            {docType.name}: revisión cada {docType.reviewMonths} meses, alerta {docType.alertMonths} meses antes
            {docType.requiresTraining ? ', capacitación obligatoria' : ''}.
          </Text>
        )}
        <Group justify='flex-end' mt='lg'>
          <Button leftSection={<IconUpload size={16} />} loading={busy} onClick={submit} data-testid='sgc-carga-enviar'>
            Cargar como vigente
          </Button>
        </Group>
      </Card>
    </Stack>
  );
}

export default function CargaDocumentosPage() {
  return (
    <SgcShell section='Carga de documentos vigentes' subtitle='Alta administrativa por Aseguramiento de Calidad' requireQuality>
      {(company) => <Carga company={company} />}
    </SgcShell>
  );
}
