'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Accordion, Alert, Anchor, Badge, Button, Card, Grid, Group, Loader, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconAlertTriangle, IconFolder, IconListDetails } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import { sgcHref } from '../../../../../components/sgc/useSgcCompany';
import { useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import { SGC_BASE_URL } from '../../../../../lib/sgc/constants';
import type { SgcCatalogs } from '../../../../../lib/sgc/db/catalogs';
import { buildProcessCascade, type SgcMasterItem } from '../../../../../lib/sgc/masterList';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

/**
 * MAPA DE PROCESOS en cascada (referencia de experiencia: ICalidad, sin su
 * estética): tipo de proceso → proceso → carpeta por tipo documental →
 * documento con código y versión. Solo muestra lo que la persona puede
 * consultar.
 */

function MapaProcesos({ company }: { company: SgcCompanyAccess }) {
  const catalogs = useSgcFetch<SgcCatalogs>(`/api/sgc/catalogs?company=${company.idCompany}`);
  const docs = useSgcFetch<{ documents: SgcMasterItem[] }>(`/api/sgc/documents?company=${company.idCompany}`);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [processId, setProcessId] = useState<number | null>(null);

  const cascade = useMemo(() => {
    if (!catalogs.data || !docs.data) return [];
    return buildProcessCascade(catalogs.data.processTypes, catalogs.data.processes, catalogs.data.documentTypes, docs.data.documents);
  }, [catalogs.data, docs.data]);

  useEffect(() => {
    if (typeId === null && cascade[0]) setTypeId(cascade[0].processType.id);
  }, [cascade, typeId]);

  const selectedType = cascade.find((t) => t.processType.id === typeId) ?? null;
  const selectedProcess = selectedType?.processes.find((p) => p.process.id === processId) ?? null;

  if (catalogs.error || docs.error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {catalogs.error || docs.error}
      </Alert>
    );
  }
  if (!catalogs.data || !docs.data) {
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  }
  if (cascade.length === 0) {
    return (
      <Alert color='yellow' icon={<IconAlertTriangle size={18} />}>
        La empresa aún no tiene configurado su mapa de procesos. Aseguramiento de Calidad lo configura en «Configuración del SGC».
      </Alert>
    );
  }

  return (
    <Grid gutter='lg' data-testid='sgc-mapa'>
      <Grid.Col span={{ base: 12, md: 4 }}>
        <Stack gap='sm'>
          {cascade.map((t) => {
            const active = t.processType.id === typeId;
            return (
              <UnstyledButton
                key={t.processType.id}
                onClick={() => {
                  setTypeId(t.processType.id);
                  setProcessId(null);
                }}
                data-testid='sgc-mapa-tipo'
              >
                <Card
                  withBorder
                  radius='md'
                  p='md'
                  shadow={active ? 'sm' : 'xs'}
                  style={{
                    borderLeft: `6px solid var(--mantine-color-${t.processType.color}-6)`,
                    background: active ? `var(--mantine-color-${t.processType.color}-light)` : undefined,
                  }}
                >
                  <Group justify='space-between' wrap='nowrap'>
                    <Text fw={700} size='sm' tt='uppercase'>
                      {t.processType.name}
                    </Text>
                    <Badge color={t.processType.color} variant='light'>
                      {t.total}
                    </Badge>
                  </Group>
                </Card>
              </UnstyledButton>
            );
          })}
        </Stack>
      </Grid.Col>

      <Grid.Col span={{ base: 12, md: 4 }}>
        <Card withBorder radius='md' p={0}>
          {selectedType && selectedType.processes.length === 0 && (
            <Text c='dimmed' size='sm' p='md'>
              Sin procesos configurados.
            </Text>
          )}
          {selectedType?.processes.map((p) => {
            const active = p.process.id === processId;
            return (
              <UnstyledButton
                key={p.process.id}
                onClick={() => setProcessId(p.process.id)}
                w='100%'
                p='md'
                style={{
                  borderBottom: '1px solid var(--mantine-color-default-border)',
                  background: active ? 'var(--mantine-color-default-hover)' : undefined,
                }}
                data-testid='sgc-mapa-proceso'
              >
                <Group justify='space-between' wrap='nowrap'>
                  <div>
                    <Text size='sm' fw={600}>
                      {p.process.name}
                    </Text>
                    <Text size='xs' c='dimmed' ff='monospace'>
                      {p.process.code}
                    </Text>
                  </div>
                  <Badge variant='light' color='gray'>
                    {p.total}
                  </Badge>
                </Group>
              </UnstyledButton>
            );
          })}
        </Card>
      </Grid.Col>

      <Grid.Col span={{ base: 12, md: 4 }}>
        {!selectedProcess ? (
          <Text c='dimmed' size='sm'>
            Seleccione un proceso para ver sus documentos por tipo documental.
          </Text>
        ) : selectedProcess.folders.length === 0 ? (
          <Text c='dimmed' size='sm'>
            Este proceso aún no tiene documentos que usted pueda consultar.
          </Text>
        ) : (
          <Accordion variant='separated' multiple defaultValue={selectedProcess.folders.map((f) => String(f.documentType.id))}>
            {selectedProcess.folders.map((f) => (
              <Accordion.Item key={f.documentType.id} value={String(f.documentType.id)}>
                <Accordion.Control icon={<IconFolder size={18} />}>
                  <Group justify='space-between' wrap='nowrap' pr='sm'>
                    <Text size='sm' fw={600}>
                      {f.documentType.pluralName}
                    </Text>
                    <Badge size='xs' variant='light'>
                      {f.documents.length}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap={8}>
                    {f.documents.map((d) => (
                      <Anchor
                        key={d.idDocument}
                        component={Link}
                        href={sgcHref(`${SGC_BASE_URL}/documentos/${d.idDocument}`, company.idCompany)}
                        size='sm'
                        data-testid='sgc-mapa-documento'
                      >
                        <Text span ff='monospace' fw={700} size='sm'>
                          {d.code} V{d.versionNumber}
                        </Text>{' '}
                        {d.title}
                      </Anchor>
                    ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
      </Grid.Col>
    </Grid>
  );
}

export default function MapaProcesosPage() {
  return (
    <SgcShell
      section='Mapa de procesos'
      subtitle='Tipo de proceso → proceso → tipo documental → documento'
      actions={(company) => (
        <Button component={Link} href={sgcHref(`${SGC_BASE_URL}/listado`, company.idCompany)} variant='light' leftSection={<IconListDetails size={16} />}>
          Listado maestro
        </Button>
      )}
    >
      {(company) => <MapaProcesos company={company} />}
    </SgcShell>
  );
}
