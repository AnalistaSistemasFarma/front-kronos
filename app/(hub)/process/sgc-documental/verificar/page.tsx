'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Anchor, Badge, Card, Code, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconQrcode } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import { useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import type { SgcVerifyResult } from '../../../../../lib/sgc/db/verify';

/**
 * VERIFICACIÓN POR QR (Sprint 4): el código QR de la portada del PDF
 * controlado abre esta página, que confirma si ESA versión del documento
 * sigue vigente, ya es obsoleta, está en divulgación o fue anulada. Exige
 * iniciar sesión y acceso al SGC de la empresa; cada verificación queda en la
 * auditoría.
 */
const VERDICT_COLOR: Record<SgcVerifyResult['verdict'], string> = {
  vigente: 'green',
  obsoleta: 'red',
  en_divulgacion: 'yellow',
  anulada: 'red',
  no_encontrada: 'gray',
};

const VERDICT_LABEL: Record<SgcVerifyResult['verdict'], string> = {
  vigente: 'VIGENTE',
  obsoleta: 'OBSOLETA',
  en_divulgacion: 'EN DIVULGACIÓN — AÚN NO VIGENTE',
  anulada: 'ANULADA',
  no_encontrada: 'NO ENCONTRADA',
};

function Verify({ idCompany }: { idCompany: number }) {
  const [query, setQuery] = useState<{ empresa: string; codigo: string; version: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setQuery({ empresa: q.get('empresa') ?? String(idCompany), codigo: q.get('codigo') ?? '', version: q.get('version') ?? '' });
  }, [idCompany]);
  const url = query ? `/api/sgc/verify?empresa=${encodeURIComponent(query.empresa)}&codigo=${encodeURIComponent(query.codigo)}&version=${encodeURIComponent(query.version)}` : null;
  const { data, error, loading } = useSgcFetch<SgcVerifyResult>(url);

  if (loading || !data) {
    if (error) {
      return (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} title='No se pudo verificar' data-testid='sgc-verificar-error'>
          {error}
        </Alert>
      );
    }
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  }
  const ok = data.verdict === 'vigente';
  return (
    <Card shadow='sm' p='xl' radius='md' withBorder data-testid='sgc-verificar'>
      <Stack>
        <Group gap='sm'>
          {ok ? <IconCircleCheck size={36} className='text-green-600' /> : <IconCircleX size={36} className={data.verdict === 'en_divulgacion' ? 'text-yellow-600' : 'text-red-600'} />}
          <div>
            <Title order={3}>
              {data.code} · Versión {data.versionNumber}
            </Title>
            {data.title && <Text size='sm'>{data.title}</Text>}
          </div>
          <Badge color={VERDICT_COLOR[data.verdict]} size='xl' radius='sm' variant='light' data-testid='sgc-verificar-veredicto'>
            {VERDICT_LABEL[data.verdict]}
          </Badge>
        </Group>
        <Alert color={VERDICT_COLOR[data.verdict]} variant='light' data-testid='sgc-verificar-mensaje'>
          {data.message}
        </Alert>
        <Stack gap={4}>
          {data.company && <Text size='sm'>Empresa: {data.company}</Text>}
          {data.effectiveDate && <Text size='sm'>Vigente desde: {data.effectiveDate}</Text>}
          {data.obsoleteDate && <Text size='sm'>{data.verdict === 'anulada' ? 'Anulada el' : 'Obsoleta desde'}: {data.obsoleteDate}</Text>}
          {data.currentVersionNumber !== null && data.currentVersionNumber !== data.versionNumber && (
            <Text size='sm' data-testid='sgc-verificar-vigente'>
              La versión vigente del documento es la V{data.currentVersionNumber}.
            </Text>
          )}
          {data.pdfSha256 && (
            <Text size='xs' c='dimmed'>
              Huella registrada del PDF controlado (SHA-256): <Code>{data.pdfSha256}</Code>
            </Text>
          )}
        </Stack>
        {data.idDocument && (
          <Anchor component={Link} href={`/process/sgc-documental/documentos/${data.idDocument}?empresa=${query?.empresa}`}>
            Abrir la ficha del documento
          </Anchor>
        )}
      </Stack>
    </Card>
  );
}

export default function SgcVerifyPage() {
  return (
    <SgcShell section='Verificación de versión' subtitle='Código QR del PDF controlado: ¿esta versión sigue vigente?'>
      {(company) => (
        <Stack>
          <Group gap='xs'>
            <IconQrcode size={18} />
            <Text size='sm' c='dimmed'>
              Esta verificación consulta el registro del SGC en este momento y queda en la auditoría.
            </Text>
          </Group>
          <Verify idCompany={company.idCompany} />
        </Stack>
      )}
    </SgcShell>
  );
}
