'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, Card, Group, Loader, Table, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconListDetails, IconSearch } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import { SgcDocumentCode } from '../../../../../components/sgc/SgcBadges';
import { sgcHref } from '../../../../../components/sgc/useSgcCompany';
import { useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import { useSgcRowLink } from '../../../../../components/sgc/useSgcRowLink';
import { SGC_BASE_URL } from '../../../../../lib/sgc/constants';
import type { SgcGeneratorItem } from '../../../../../lib/sgc/db/generator';
import { canUseSgcGenerator } from '../../../../../lib/sgc/generator';
import { filterMasterList } from '../../../../../lib/sgc/masterList';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

/**
 * GENERADOR DE DOCUMENTOS (2026-10-05): listado de documentos VIGENTES con
 * buscador. Al elegir uno, su contenido vigente se abre en el editor como
 * copia de trabajo (sin tocar el documento controlado) y se genera un PDF con
 * el encabezado del documento de origen. Ver lib/sgc/generator.ts.
 */

const NOWRAP = { whiteSpace: 'nowrap' } as const;

function Listado({ company }: { company: SgcCompanyAccess }) {
  const rowLink = useSgcRowLink();
  const [q, setQ] = useState('');
  const allowed = canUseSgcGenerator(company);
  const docs = useSgcFetch<{ documents: SgcGeneratorItem[] }>(allowed ? `/api/sgc/generator?company=${company.idCompany}` : null);
  const items = useMemo(() => filterMasterList(docs.data?.documents ?? [], { q, processTypeId: null, processId: null, documentTypeId: null }) as SgcGeneratorItem[], [docs.data, q]);

  if (!allowed) {
    return (
      <Alert color='yellow' icon={<IconAlertTriangle size={18} />} data-testid='sgc-generador-sin-permiso'>
        El generador de documentos es para gestión documental o Aseguramiento de Calidad.
      </Alert>
    );
  }

  return (
    <Card withBorder radius='md' p='lg' shadow='xs'>
      <Group gap='sm' mb='md' align='flex-end' wrap='wrap'>
        <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true'
          label='Buscar'
          placeholder='Código o título'
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          w={260}
          data-testid='sgc-generador-buscador'
        />
      </Group>

      {docs.error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} mb='md'>
          {docs.error}
        </Alert>
      )}

      <Group justify='space-between' mb='xs'>
        <Text size='sm' c='dimmed' data-testid='sgc-conteo'>
          {docs.loading ? 'Cargando…' : `${items.length} documento${items.length === 1 ? '' : 's'} vigente${items.length === 1 ? '' : 's'}`}
        </Text>
      </Group>

      {docs.loading && !docs.data ? (
        <Group justify='center' my='xl'>
          <Loader />
        </Group>
      ) : items.length === 0 ? (
        <Text c='dimmed' ta='center' my='xl' data-testid='sgc-generador-vacio'>
          {docs.data?.documents.length ? 'Ningún documento coincide con la búsqueda.' : 'No hay documentos vigentes que usted pueda consultar.'}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={900}>
          <Table striped highlightOnHover verticalSpacing='sm' data-testid='sgc-generador-listado'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Código · versión</Table.Th>
                <Table.Th>Título</Table.Th>
                <Table.Th>Tipo documental</Table.Th>
                <Table.Th>Proceso</Table.Th>
                <Table.Th>Vigente desde</Table.Th>
                <Table.Th>Contenido</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((d) => (
                <Table.Tr key={d.idDocument} {...rowLink(sgcHref(`${SGC_BASE_URL}/generador/${d.idDocument}`, company.idCompany))} data-testid='sgc-generador-fila'>
                  <Table.Td style={NOWRAP}>
                    <SgcDocumentCode code={d.code} versionNumber={d.versionNumber} />
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm' fw={500}>
                      {d.title}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm'>{d.documentType.name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size='sm'>{d.process.name}</Text>
                  </Table.Td>
                  <Table.Td style={NOWRAP}>
                    <Text size='sm'>{d.effectiveDate ?? '—'}</Text>
                  </Table.Td>
                  <Table.Td style={NOWRAP}>
                    {d.sourceFormat ? (
                      <Badge variant='light' color='teal' size='sm'>
                        {d.sourceFormat === 'docx' ? 'Word' : 'Editor'}
                      </Badge>
                    ) : (
                      <Badge variant='light' color='gray' size='sm'>
                        Solo PDF
                      </Badge>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  );
}

export default function SgcGeneradorPage() {
  return (
    <SgcShell
      section='Generador de documentos'
      subtitle='Genere un documento a partir de un vigente: se edita una copia de trabajo, sin tocar el documento controlado'
      actions={(company) => (
        <Button component={Link} href={sgcHref(`${SGC_BASE_URL}/listado`, company.idCompany)} variant='light' leftSection={<IconListDetails size={16} />}>
          Listado maestro
        </Button>
      )}
    >
      {(company) => <Listado company={company} />}
    </SgcShell>
  );
}
