'use client';

import type { ReactNode } from 'react';
import { Anchor, Badge, Divider, Grid, Group, Modal, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconCpu, IconFileInvoice, IconUser } from '@tabler/icons-react';
import type { ItAssetListItem } from '../../lib/it-dashboard/db';
import { isServerType } from '../../lib/it-dashboard/server';
import ServerPanel from './ServerPanel';
import { formatDate, formatMoney, isHttpUrl, statusColor, text } from './assetFormat';
import { iconForAssetType } from './assetTypeIcons';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap={2} style={{ minWidth: 0 }}>
      <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
        {label}
      </Text>
      <Text size='sm' style={{ wordBreak: 'break-word' }} component='div'>
        {children}
      </Text>
    </Stack>
  );
}

function DocumentLink({ url }: { url: string | null }) {
  if (!url || !url.trim()) return <>—</>;
  if (!isHttpUrl(url)) return <>{url.trim()}</>;
  return (
    <Anchor href={url.trim()} target='_blank' rel='noopener noreferrer' size='sm'>
      Abrir documento
    </Anchor>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof IconUser; children: ReactNode }) {
  return (
    <Stack gap='sm'>
      <Group gap='xs'>
        <ThemeIcon variant='light' size='sm' radius='md'>
          <Icon size={14} />
        </ThemeIcon>
        <Title order={6}>{title}</Title>
      </Group>
      <SimpleGrid cols={{ base: 1, xs: 2, sm: 3 }} spacing='md' verticalSpacing='sm'>
        {children}
      </SimpleGrid>
    </Stack>
  );
}

/**
 * Preview window with the full detail of one asset (opened on top of the
 * asset list; it does not leave the Dashboard TI).
 */
export default function AssetDetailModal({
  asset,
  onClose,
}: {
  asset: ItAssetListItem | null;
  onClose: () => void;
}) {
  const TypeIcon = iconForAssetType(asset?.type ?? '');
  const cost = asset?.cost == null ? null : Number(asset.cost);
  const isServer = isServerType(asset?.type);

  return (
    <Modal
      opened={asset != null}
      onClose={onClose}
      size={isServer ? '80rem' : 'xl'}
      radius='md'
      zIndex={400}
      centered
      title={
        asset ? (
          <Group gap='sm' wrap='nowrap'>
            <ThemeIcon variant='light' radius='md' size='lg'>
              <TypeIcon size={20} />
            </ThemeIcon>
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text fw={700} lineClamp={1}>
                {text(asset.name)}
              </Text>
              <Text size='xs' c='dimmed'>
                {text(asset.type)} · {text(asset.subtype)}
              </Text>
            </Stack>
          </Group>
        ) : null
      }
    >
      {asset ? (
        <Grid gutter='lg' align='stretch'>
        <Grid.Col span={{ base: 12, md: isServer ? 7 : 12 }}>
        <Stack gap='lg'>
          <Group gap='xs'>
            <Badge variant='light' color={statusColor(asset.status)}>
              {text(asset.status)}
            </Badge>
            <Badge variant='light' color={asset.active ? 'teal' : 'gray'}>
              {asset.active ? 'Activo' : 'Inactivo'}
            </Badge>
            {asset.renewal ? (
              <Badge variant='light' color='grape'>
                Renovación {asset.renewalDate ? formatDate(asset.renewalDate) : ''}
              </Badge>
            ) : null}
          </Group>

          <Section title='Identificación' icon={IconFileInvoice}>
            <Field label='Etiqueta'>{text(asset.label)}</Field>
            <Field label='Serial'>{text(asset.serial)}</Field>
            <Field label='Modelo'>{text(asset.model)}</Field>
            <Field label='Empresa'>{text(asset.company)}</Field>
            <Field label='Sede'>{text(asset.site)}</Field>
            <Field label='Fecha de compra'>{formatDate(asset.purchaseDate)}</Field>
            <Field label='Costo del equipo'>{cost != null && Number.isFinite(cost) ? formatMoney(cost) : '—'}</Field>
            <Field label='Factura'>
              <DocumentLink url={asset.invoice} />
            </Field>
            <Field label='Acta de salida'>
              <DocumentLink url={asset.exitRecord} />
            </Field>
          </Section>

          <Divider />

          <Section title='Asignación' icon={IconUser}>
            <Field label='Usuario'>{text(asset.user)}</Field>
            <Field label='Cargo'>{text(asset.userRole)}</Field>
            <Field label='Correo'>{text(asset.userEmail)}</Field>
            <Field label='Departamento'>{text(asset.department)}</Field>
          </Section>

          <Divider />

          <Section title='Características' icon={IconCpu}>
            <Field label='Procesador'>{text(asset.processor)}</Field>
            <Field label='RAM'>{text(asset.ram)}</Field>
            <Field label='Almacenamiento'>{text(asset.storage)}</Field>
            <Field label='Sistema operativo'>{text(asset.os)}</Field>
            <Field label='SIM'>{text(asset.sim)}</Field>
          </Section>
        </Stack>
        </Grid.Col>
        {isServer ? (
          <Grid.Col span={{ base: 12, md: 5 }}>
            <ServerPanel asset={asset} />
          </Grid.Col>
        ) : null}
        </Grid>
      ) : null}
    </Modal>
  );
}
