'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, Modal, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import SgcSelect from '../sgc/SgcSelect';
import { ALCANCE_LABEL, CANAL_LABEL, VITRINA_ALCANCES, VITRINA_LIMITS, type VitrinaAlcance, type VitrinaCanal } from '../../lib/vitrina/constants';
import type { CompanyAccess, Exclusividad, Presentacion } from './types';
import { errorTexto, fmtFecha, nombrePresentacion, OPCIONES_CANAL, useVitrinaFetch, vitrinaSend, type Avisar } from './vitrinaClient';

/** Exclusividades por presentación (cliente beneficiario, país, canal, alcance y vigencia), con aviso al vencer. */
const ESTADO_EXCL: Record<Exclusividad['estado'], { label: string; color: string }> = {
  VIGENTE: { label: 'Vigente', color: 'green' },
  POR_VENCER: { label: 'Por vencer', color: 'yellow' },
  VENCIDA: { label: 'Vencida', color: 'red' },
  FUTURA: { label: 'Aún no inicia', color: 'gray' },
};

const fechaCorta = (d: string | null) => (d ? fmtFecha(`${d}T12:00:00Z`) : null);

export default function VitrinaExclusividades({ company, version, avisar }: { company: CompanyAccess; version: number; avisar: Avisar }) {
  const { data, error, loading, reload } = useVitrinaFetch<{ exclusividades: Exclusividad[] }>(`/api/vitrina/gestion/exclusividades?company=${company.idCompany}&v=${version}`);
  const [form, setForm] = useState<Exclusividad | 'nueva' | null>(null);
  const [borrar, setBorrar] = useState<Exclusividad | null>(null);
  const [busy, setBusy] = useState(false);
  const lista = data?.exclusividades ?? [];

  const eliminar = async () => {
    if (!borrar) return;
    setBusy(true);
    try {
      await vitrinaSend(`/api/vitrina/gestion/exclusividades/${borrar.id}?company=${company.idCompany}`, 'DELETE');
      avisar(true, `Exclusividad de «${borrar.clienteBeneficiario}» eliminada (queda en el historial).`);
      setBorrar(null);
      await reload(true);
    } catch (e) {
      avisar(false, errorTexto(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap='md'>
      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}
      <Group justify='space-between'>
        <Text c='dimmed' size='sm'>
          Las registran los administradores cuando el cliente la confirma (p. ej. Vitamina C x10 exclusiva de OLP).
        </Text>
        <Button size='md' leftSection={<IconPlus size={18} />} onClick={() => setForm('nueva')} data-testid='vitrina-nueva-exclusividad'>
          Nueva exclusividad
        </Button>
      </Group>
      {loading && !data ? (
        <Group justify='center' py='lg'>
          <Loader />
        </Group>
      ) : lista.length === 0 ? (
        <Card withBorder radius='md' p='lg'>
          <Text c='dimmed'>No hay exclusividades registradas.</Text>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing='sm'>
          {lista.map((e) => (
            <Card key={e.id} withBorder radius='md' p='md' data-testid='vitrina-exclusividad'>
              <Group justify='space-between' wrap='nowrap' align='flex-start'>
                <div style={{ minWidth: 0 }}>
                  <Text fw={700}>{e.clienteBeneficiario}</Text>
                  <Text size='sm' lineClamp={2}>
                    {e.presentacion}
                  </Text>
                </div>
                <Badge variant='light' color={ESTADO_EXCL[e.estado].color}>
                  {ESTADO_EXCL[e.estado].label}
                </Badge>
              </Group>
              <Group gap={6} mt={8} wrap='wrap'>
                <Badge variant='outline' size='sm'>{ALCANCE_LABEL[e.alcance as VitrinaAlcance] ?? e.alcance}</Badge>
                {e.pais && <Badge variant='outline' color='gray' size='sm'>{e.pais}</Badge>}
                {e.canal && <Badge variant='outline' color='gray' size='sm'>Canal {CANAL_LABEL[e.canal as VitrinaCanal]?.toLowerCase()}</Badge>}
              </Group>
              <Text size='sm' c='dimmed' mt={8}>
                Vigencia: {fechaCorta(e.vigenteDesde) ?? 'sin inicio'} → {fechaCorta(e.vigenteHasta) ?? 'sin fin'}
              </Text>
              {e.observacion && (
                <Text size='sm' mt={4}>
                  {e.observacion}
                </Text>
              )}
              <Group gap='sm' mt='sm'>
                <Button size='sm' variant='default' leftSection={<IconEdit size={16} />} onClick={() => setForm(e)}>
                  Editar
                </Button>
                <Button size='sm' variant='light' color='red' leftSection={<IconTrash size={16} />} onClick={() => setBorrar(e)}>
                  Eliminar
                </Button>
              </Group>
            </Card>
          ))}
        </SimpleGrid>
      )}

      {form && (
        <ExclusividadModal
          idCompany={company.idCompany}
          actual={form === 'nueva' ? null : form}
          onClose={() => setForm(null)}
          onSaved={(t) => {
            setForm(null);
            avisar(true, t);
            void reload(true);
          }}
        />
      )}
      <Modal opened={Boolean(borrar)} onClose={() => setBorrar(null)} title='Eliminar exclusividad' radius='md'>
        <Stack gap='sm'>
          <Text>
            ¿Eliminar la exclusividad de «{borrar?.clienteBeneficiario}» sobre {borrar?.presentacion}? Quedará registrada en el historial.
          </Text>
          <Group justify='flex-end' gap='sm'>
            <Button variant='default' onClick={() => setBorrar(null)}>
              Cancelar
            </Button>
            <Button color='red' onClick={eliminar} loading={busy} data-testid='vitrina-confirmar-eliminar'>
              Eliminar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function ExclusividadModal({ idCompany, actual, onClose, onSaved }: { idCompany: number; actual: Exclusividad | null; onClose: () => void; onSaved: (t: string) => void }) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const { data } = useVitrinaFetch<{ presentaciones: Presentacion[] }>(`/api/vitrina/gestion/presentaciones?company=${idCompany}`);
  const [idPresentacion, setIdPresentacion] = useState<string | null>(actual ? String(actual.idPresentacion) : null);
  const [cliente, setCliente] = useState(actual?.clienteBeneficiario ?? '');
  const [pais, setPais] = useState(actual?.pais ?? '');
  const [canal, setCanal] = useState<string | null>(actual?.canal ?? null);
  const [alcance, setAlcance] = useState<string>(actual?.alcance ?? 'EXHIBIR');
  const [desde, setDesde] = useState(actual?.vigenteDesde ?? '');
  const [hasta, setHasta] = useState(actual?.vigenteHasta ?? '');
  const [obs, setObs] = useState(actual?.observacion ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opciones = (data?.presentaciones ?? []).map((p) => ({ value: String(p.id), label: nombrePresentacion(p) }));

  const guardar = async () => {
    setBusy(true);
    setError(null);
    const body = { company: idCompany, id_presentacion: idPresentacion ? Number(idPresentacion) : null, cliente_beneficiario: cliente, pais, canal, alcance, vigente_desde: desde, vigente_hasta: hasta, observacion: obs };
    try {
      if (actual) await vitrinaSend(`/api/vitrina/gestion/exclusividades/${actual.id}`, 'PATCH', body);
      else await vitrinaSend('/api/vitrina/gestion/exclusividades', 'POST', body);
      onSaved(actual ? `Exclusividad de «${cliente.trim()}» actualizada.` : `Exclusividad de «${cliente.trim()}» registrada.`);
    } catch (e) {
      setError(errorTexto(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={actual ? 'Editar exclusividad' : 'Nueva exclusividad'} size='lg' fullScreen={mobile} radius='md'>
      <Stack gap='sm'>
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />}>
            {error}
          </Alert>
        )}
        <SgcSelect label='Presentación' required size='md' data={opciones} value={idPresentacion} onChange={setIdPresentacion} searchable disabled={Boolean(actual)} nothingFoundMessage='Sin presentaciones' />
        <TextInput label='Cliente beneficiario' required size='md' value={cliente} onChange={(e) => setCliente(e.currentTarget.value)} maxLength={VITRINA_LIMITS.cliente} />
        <Group grow wrap='wrap' gap='sm'>
          <TextInput label='País' size='md' value={pais} onChange={(e) => setPais(e.currentTarget.value)} maxLength={VITRINA_LIMITS.pais} miw={160} />
          <SgcSelect label='Canal' size='md' data={OPCIONES_CANAL} value={canal} onChange={setCanal} clearable placeholder='Todos' miw={160} />
        </Group>
        <div>
          <Text size='sm' fw={500} mb={4}>
            Alcance
          </Text>
          <SegmentedControl fullWidth size='md' data={VITRINA_ALCANCES.map((a) => ({ value: a, label: ALCANCE_LABEL[a] }))} value={alcance} onChange={setAlcance} />
        </div>
        <Group grow wrap='wrap' gap='sm'>
          <TextInput type='date' label='Vigente desde' size='md' value={desde} onChange={(e) => setDesde(e.currentTarget.value)} miw={160} />
          <TextInput type='date' label='Vigente hasta' size='md' value={hasta} onChange={(e) => setHasta(e.currentTarget.value)} miw={160} />
        </Group>
        <Textarea label='Observación' size='md' autosize minRows={2} value={obs} onChange={(e) => setObs(e.currentTarget.value)} maxLength={VITRINA_LIMITS.observacion} />
        <Group justify='flex-end' gap='sm' mt='sm'>
          <Button variant='default' size='md' onClick={onClose}>
            Cancelar
          </Button>
          <Button size='md' onClick={guardar} loading={busy} disabled={!idPresentacion || !cliente.trim()}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
