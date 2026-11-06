'use client';

import { useMemo, useState } from 'react';
import { Alert, Anchor, Badge, Box, Button, Card, Checkbox, Group, Loader, Modal, SimpleGrid, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconFolderPlus, IconPlus, IconSearch } from '@tabler/icons-react';
import SgcSelect from '../sgc/SgcSelect';
import { fuenteDeEmpresa } from '../../lib/vitrina/rules';
import type { BandejaItem, BandejaResp, CompanyAccess, Presentacion } from './types';
import { CanalBadge, RegistroBadge } from './VitrinaBadges';
import PresentacionModal from './PresentacionModal';
import { errorTexto, nombrePresentacion, useVitrinaFetch, vitrinaSend, type Avisar } from './vitrinaClient';

/**
 * Bandeja: artículos de SAP de la empresa que todavía no tienen presentación.
 * Celular primero: tarjetas con casilla; al elegir, aparece abajo la barra fija
 * «Crear presentación» / «Agregar a una existente». En Ryan se puede ver la
 * bandeja agrupada por producto (3 últimos dígitos del código) como SUGERENCIA.
 */
export default function VitrinaBandeja({ company, version, avisar }: { company: CompanyAccess; version: number; avisar: Avisar }) {
  const desktop = useMediaQuery('(min-width: 48em)') ?? false;
  const esRyan = Boolean(fuenteDeEmpresa(company.idCompany)?.codigoRyan);
  const [q, setQ] = useState('');
  const [qDeb] = useDebouncedValue(q, 350);
  const [grupo, setGrupo] = useState<string | null>(null);
  const [pais, setPais] = useState<string | null>(null);
  const [agrupar, setAgrupar] = useState(esRyan);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [crear, setCrear] = useState(false);
  const [asignar, setAsignar] = useState(false);

  const params = new URLSearchParams({ company: String(company.idCompany), v: String(version) });
  if (qDeb.trim()) params.set('q', qDeb.trim());
  if (grupo) params.set('grupo', grupo);
  if (pais) params.set('pais', pais);
  const { data, error, loading, reload } = useVitrinaFetch<BandejaResp>(`/api/vitrina/gestion/bandeja?${params.toString()}`);

  const items = useMemo(() => data?.items ?? [], [data]);
  const seleccionados = items.filter((i) => sel.has(i.id));
  const toggle = (id: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const elegirGrupo = (ids: number[]) =>
    setSel((s) => {
      const n = new Set(s);
      const todos = ids.every((id) => n.has(id));
      for (const id of ids) {
        if (todos) n.delete(id);
        else n.add(id);
      }
      return n;
    });

  const grupos = useMemo(() => {
    if (!esRyan || !agrupar) return null;
    const visibles = new Set(items.map((i) => i.id));
    return (data?.gruposRyan ?? [])
      .map((g) => ({ ...g, ids: g.ids.filter((id) => visibles.has(id)) }))
      .filter((g) => g.ids.length > 0);
  }, [esRyan, agrupar, items, data]);
  const porId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const terminado = (texto: string) => {
    setCrear(false);
    setAsignar(false);
    setSel(new Set());
    avisar(true, texto);
    void reload(true);
  };

  const barra = seleccionados.length > 0;

  const acciones = (
    <>
      <Button size='md' h={desktop ? undefined : 52} px={desktop ? undefined : 'xs'} leftSection={desktop ? <IconPlus size={18} /> : undefined} onClick={() => setCrear(true)} disabled={!barra} data-testid='vitrina-crear-presentacion'>
        {desktop ? 'Crear presentación' : 'Nueva presentación'}
      </Button>
      <Button size='md' h={desktop ? undefined : 52} px={desktop ? undefined : 'xs'} variant='default' leftSection={desktop ? <IconFolderPlus size={18} /> : undefined} onClick={() => setAsignar(true)} disabled={!barra} data-testid='vitrina-agregar-existente'>
        {desktop ? 'Agregar a existente' : 'Agregar a otra'}
      </Button>
    </>
  );

  return (
    <Stack gap='md' pb={barra && !desktop ? 96 : 0}>
      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing='sm'>
        <TextInput
          size='md'
          placeholder='Buscar por código, nombre o sugerencia'
          leftSection={<IconSearch size={18} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          data-testid='vitrina-bandeja-buscar'
        />
        <SgcSelect
          size='md'
          placeholder='Grupo de SAP'
          data={(data?.grupos ?? []).map((g) => ({ value: String(g.codigo), label: g.nombre }))}
          searchable
          value={grupo}
          onChange={setGrupo}
          clearable
        />
        <SgcSelect
          size='md'
          placeholder='País'
          data={[{ value: '__sin__', label: 'Sin país' }, ...(data?.paises ?? []).map((p) => ({ value: p, label: p }))]}
          value={pais}
          onChange={setPais}
          clearable
          searchable
        />
      </SimpleGrid>
      <Group justify='space-between' wrap='wrap' gap='sm'>
        <Title order={2} size='h4'>
          Artículos sin presentación <Badge variant='light' size='lg' ml={6}>{items.length}</Badge>
          {data && data.totalBandeja !== items.length && (
            <Text span size='sm' c='dimmed' ml='xs'>
              de {data.totalBandeja}
            </Text>
          )}
        </Title>
        <Group gap='sm'>
          {esRyan && <Switch label='Agrupar por producto' checked={agrupar} onChange={(e) => setAgrupar(e.currentTarget.checked)} />}
          {desktop && acciones}
        </Group>
      </Group>
      {seleccionados.length > 0 && (
        <Text size='sm' c='dimmed'>
          {seleccionados.length} seleccionado(s).{' '}
          <Anchor component='button' type='button' size='sm' onClick={() => setSel(new Set())}>
            Quitar selección
          </Anchor>
        </Text>
      )}

      {loading && !data ? (
        <Group justify='center' py='lg'>
          <Loader />
        </Group>
      ) : items.length === 0 ? (
        <Card withBorder radius='md' p='lg'>
          <Text c='dimmed'>
            {data?.totalBandeja === 0
              ? 'La bandeja está vacía. Use «Actualizar ahora» para leer SAP o «Importar carga inicial» para cargar las sugerencias.'
              : 'Ningún artículo coincide con los filtros.'}
          </Text>
        </Card>
      ) : grupos ? (
        <Stack gap='lg'>
          {grupos.map((g) => (
            <Stack key={g.producto} gap='xs'>
              <Group justify='space-between' wrap='nowrap'>
                <Text fw={600}>
                  Producto {g.producto} <Badge variant='light' color='gray' size='sm' ml={4}>{g.ids.length}</Badge>
                </Text>
                <Button size='xs' variant='subtle' onClick={() => elegirGrupo(g.ids)}>
                  {g.ids.every((id) => sel.has(id)) ? 'Quitar grupo' : 'Elegir grupo'}
                </Button>
              </Group>
              {g.avisos.length > 0 && (
                <Alert color='yellow' variant='light' icon={<IconAlertTriangle size={16} />} p='xs'>
                  <Text size='xs'>Revisar antes de agrupar: {g.avisos.join(' · ')}</Text>
                </Alert>
              )}
              <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing='sm'>
                {g.ids.map((id) => {
                  const it = porId.get(id);
                  return it ? <TarjetaBandeja key={id} item={it} checked={sel.has(id)} onToggle={() => toggle(id)} /> : null;
                })}
              </SimpleGrid>
            </Stack>
          ))}
        </Stack>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing='sm'>
          {items.map((it) => (
            <TarjetaBandeja key={it.id} item={it} checked={sel.has(it.id)} onToggle={() => toggle(it.id)} />
          ))}
        </SimpleGrid>
      )}

      {barra && !desktop && (
        <Box pos='fixed' bottom={0} left={0} right={0} p='md' bg='var(--mantine-color-body)' style={{ borderTop: '1px solid var(--mantine-color-default-border)', zIndex: 150 }}>
          <SimpleGrid cols={2} spacing='sm'>
            {acciones}
          </SimpleGrid>
        </Box>
      )}

      <PresentacionModal opened={crear} onClose={() => setCrear(false)} idCompany={company.idCompany} codigos={seleccionados} onSaved={terminado} />
      <AsignarModal opened={asignar} onClose={() => setAsignar(false)} idCompany={company.idCompany} codigos={seleccionados} onSaved={terminado} />
    </Stack>
  );
}

function TarjetaBandeja({ item, checked, onToggle }: { item: BandejaItem; checked: boolean; onToggle: () => void }) {
  const s = item.sugerencia;
  return (
    <Card withBorder radius='md' p='md' style={{ cursor: 'pointer' }} onClick={onToggle} data-testid='vitrina-bandeja-item'>
      <Group justify='space-between' wrap='nowrap' align='flex-start' gap='sm'>
        <div style={{ minWidth: 0 }}>
          <Text fw={700}>{item.itemCode}</Text>
          <Text size='sm' lineClamp={2}>
            {item.itemName}
          </Text>
        </div>
        <Checkbox checked={checked} onChange={onToggle} onClick={(e) => e.stopPropagation()} size='md' aria-label={`Elegir ${item.itemCode}`} />
      </Group>
      <Group gap={6} mt={8} wrap='wrap'>
        {item.grupoNombre && (
          <Badge variant='outline' color='gray' size='sm' tt='none' title={item.grupo !== null ? `Grupo de SAP ${item.grupo}` : undefined}>
            {item.grupoNombre}
          </Badge>
        )}
        {item.pais && <Badge variant='outline' color='gray' size='sm'>{item.pais}</Badge>}
        <CanalBadge canal={item.canal} />
        {item.leidoEnSap ? <RegistroBadge estado={item.registroEstado} venceEn={item.registroVenceEn} /> : <Badge variant='light' color='gray' size='sm'>Sin leer de SAP</Badge>}
        {item.leidoEnSap && !item.activoEnSap && <Badge variant='light' color='red' size='sm'>Inactivo en SAP</Badge>}
        {s.esParaTerceros && <Badge variant='light' color='grape' size='sm'>Para terceros{item.clienteMarca ? ` · ${item.clienteMarca}` : ''}</Badge>}
      </Group>
      {(s.presentacion || s.familia || s.tipo || s.observacion) && (
        <Text size='xs' c='dimmed' mt={8}>
          Sugerido: {[s.presentacion, s.familia, s.tipo, s.observacion].filter(Boolean).join(' · ')}
        </Text>
      )}
    </Card>
  );
}

function AsignarModal({ opened, onClose, idCompany, codigos, onSaved }: { opened: boolean; onClose: () => void; idCompany: number; codigos: BandejaItem[]; onSaved: (t: string) => void }) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const { data } = useVitrinaFetch<{ presentaciones: Presentacion[] }>(opened ? `/api/vitrina/gestion/presentaciones?company=${idCompany}` : null);
  const [id, setId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opciones = (data?.presentaciones ?? []).filter((p) => p.estado !== 'RETIRADA').map((p) => ({ value: String(p.id), label: nombrePresentacion(p) }));

  const guardar = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const r = await vitrinaSend<{ codigos: number }>(`/api/vitrina/gestion/presentaciones/${id}/codigos`, 'POST', { company: idCompany, codigos: codigos.map((c) => c.id) });
      onSaved(`${r.codigos} código(s) agregados a «${opciones.find((o) => o.value === id)?.label ?? 'la presentación'}». Siguen sin activar.`);
      setId(null);
    } catch (e) {
      setError(errorTexto(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title='Agregar a una presentación existente' size='md' fullScreen={mobile} radius='md'>
      <Stack gap='sm'>
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />}>
            {error}
          </Alert>
        )}
        <Group gap={6}>
          {codigos.map((c) => (
            <Badge key={c.id} variant='outline' size='md'>
              {c.itemCode}
            </Badge>
          ))}
        </Group>
        <SgcSelect label='Presentación' size='md' data={opciones} value={id} onChange={setId} searchable nothingFoundMessage='Sin presentaciones' data-testid='vitrina-asignar-select' />
        <Group justify='flex-end' gap='sm' mt='sm'>
          <Button variant='default' size='md' onClick={onClose}>
            Cancelar
          </Button>
          <Button size='md' onClick={guardar} loading={busy} disabled={!id}>
            Agregar códigos
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
