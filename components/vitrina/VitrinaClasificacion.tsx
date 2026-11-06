'use client';

import { useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, Group, Loader, Modal, NumberInput, SegmentedControl, SimpleGrid, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconEdit, IconInfoCircle, IconPlus } from '@tabler/icons-react';
import { VITRINA_LIMITS } from '../../lib/vitrina/constants';
import type { Clasificacion, CompanyAccess } from './types';
import { errorTexto, useVitrinaFetch, vitrinaSend, type Avisar } from './vitrinaClient';

/**
 * Gestión · Clasificación: los tres catálogos con los que navega el comercial.
 *   - Líneas comerciales: POR EMPRESA (las de Farmalógica no se ven en Ryan).
 *   - Grupos terapéuticos: catálogo COMÚN a las empresas.
 *   - Servicios (áreas asistenciales): catálogo común (antes, pestaña «Áreas»).
 * Ninguno se borra: se desactiva. Todo cambio queda en el historial.
 */
type Tipo = 'lineas' | 'grupos' | 'areas';

interface Config {
  url: string;
  clave: 'lineas' | 'grupos' | 'areas';
  singular: string;
  agregar: string;
  max: number;
  ayuda: (empresa: string) => string;
}

const CONFIG: Record<Tipo, Config> = {
  lineas: {
    url: '/api/vitrina/gestion/lineas',
    clave: 'lineas',
    singular: 'línea comercial',
    agregar: 'Agregar línea comercial',
    max: VITRINA_LIMITS.lineaNombre,
    ayuda: (empresa) => `Líneas comerciales de ${empresa}: cada presentación pertenece a una sola línea de su empresa (o a ninguna).`,
  },
  grupos: {
    url: '/api/vitrina/gestion/grupos-terapeuticos',
    clave: 'grupos',
    singular: 'grupo terapéutico',
    agregar: 'Agregar grupo terapéutico',
    max: VITRINA_LIMITS.grupoNombre,
    ayuda: (empresa) => `Lista común a todas las empresas (los cambios se ven en todas); el conteo es solo de ${empresa}. Una presentación puede tener varios grupos.`,
  },
  areas: {
    url: '/api/vitrina/gestion/areas',
    clave: 'areas',
    singular: 'servicio',
    agregar: 'Agregar servicio',
    max: VITRINA_LIMITS.areaNombre,
    ayuda: () => 'Servicios o áreas asistenciales (UCI, Urgencias…). Lista común a todas las empresas.',
  },
};

export default function VitrinaClasificacion({ company, version, avisar }: { company: CompanyAccess; version: number; avisar: Avisar }) {
  const [tipo, setTipo] = useState<Tipo>('lineas');
  return (
    <Stack gap='md'>
      <SegmentedControl
        fullWidth
        size='md'
        value={tipo}
        onChange={(v) => setTipo(v as Tipo)}
        data={[
          { value: 'lineas', label: 'Líneas' },
          { value: 'grupos', label: 'Grupos terapéuticos' },
          { value: 'areas', label: 'Servicios' },
        ]}
        data-testid='vitrina-clasificacion-tipo'
      />
      <ListaClasificacion key={tipo} config={CONFIG[tipo]} company={company} version={version} avisar={avisar} />
    </Stack>
  );
}

function ListaClasificacion({ config, company, version, avisar }: { config: Config; company: CompanyAccess; version: number; avisar: Avisar }) {
  const { data, error, loading, reload } = useVitrinaFetch<Partial<Record<Config['clave'], Clasificacion[]>>>(`${config.url}?company=${company.idCompany}&v=${version}`);
  const [nombre, setNombre] = useState('');
  const [orden, setOrden] = useState<number | string>('');
  const [busy, setBusy] = useState<number | 'nueva' | null>(null);
  const [editar, setEditar] = useState<Clasificacion | null>(null);
  const lista = data?.[config.clave] ?? [];

  const agregar = async () => {
    setBusy('nueva');
    try {
      const siguiente = orden === '' ? (lista.length ? Math.max(...lista.map((a) => a.orden)) + 10 : 10) : Number(orden);
      await vitrinaSend(config.url, 'POST', { company: company.idCompany, nombre, orden: siguiente });
      avisar(true, `Se agregó «${nombre.trim()}».`);
      setNombre('');
      setOrden('');
      await reload(true);
    } catch (e) {
      avisar(false, errorTexto(e));
    } finally {
      setBusy(null);
    }
  };

  const activar = async (a: Clasificacion, activa: boolean) => {
    setBusy(a.id);
    try {
      await vitrinaSend(`${config.url}/${a.id}`, 'PATCH', { company: company.idCompany, activa });
      avisar(true, activa ? `«${a.nombre}» activado.` : `«${a.nombre}» desactivado: ya no se ofrece para nuevas asignaciones ni se muestra a los comerciales.`);
      await reload(true);
    } catch (e) {
      avisar(false, errorTexto(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap='md' data-testid={`vitrina-clasificacion-${config.clave}`}>
      <Alert color='blue' variant='light' icon={<IconInfoCircle size={18} />} p='sm'>
        <Text size='sm'>{config.ayuda(company.companyName.trim().replace(/\.+$/, ''))}</Text>
      </Alert>
      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}
      <Card withBorder radius='md' p='md'>
        <Text fw={600} mb='xs'>
          {config.agregar}
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing='sm' style={{ alignItems: 'end' }}>
          <TextInput label='Nombre' size='md' value={nombre} onChange={(e) => setNombre(e.currentTarget.value)} maxLength={config.max} data-testid='vitrina-clasificacion-nombre' />
          <NumberInput label='Orden' size='md' min={0} max={10000} allowDecimal={false} value={orden} onChange={setOrden} />
          <Button size='md' leftSection={<IconPlus size={18} />} onClick={agregar} loading={busy === 'nueva'} disabled={!nombre.trim()} data-testid='vitrina-clasificacion-agregar'>
            Agregar
          </Button>
        </SimpleGrid>
      </Card>
      {loading && !data ? (
        <Group justify='center' py='lg'>
          <Loader />
        </Group>
      ) : lista.length === 0 ? (
        <Card withBorder radius='md' p='lg'>
          <Text c='dimmed'>Aún no hay ningún(a) {config.singular}.</Text>
        </Card>
      ) : (
        <Stack gap='xs'>
          {lista.map((a) => (
            <Card key={a.id} withBorder radius='md' p='sm' data-testid='vitrina-clasificacion-item'>
              <Group justify='space-between' wrap='nowrap' gap='sm'>
                <div style={{ minWidth: 0 }}>
                  <Text fw={600} c={a.activa ? undefined : 'dimmed'} lineClamp={2}>
                    {a.nombre}
                  </Text>
                  <Group gap={6} mt={2}>
                    <Badge variant='outline' color='gray' size='sm'>
                      Orden {a.orden}
                    </Badge>
                    <Badge variant='light' size='sm'>
                      {a.presentaciones} {a.presentaciones === 1 ? 'presentación' : 'presentaciones'}
                    </Badge>
                    {!a.activa && (
                      <Badge variant='light' color='gray' size='sm'>
                        Inactivo
                      </Badge>
                    )}
                  </Group>
                </div>
                <Group gap='xs' wrap='nowrap'>
                  <ActionIcon variant='subtle' size='lg' onClick={() => setEditar(a)} aria-label={`Editar ${a.nombre}`}>
                    <IconEdit size={18} />
                  </ActionIcon>
                  <Switch aria-label={`Activo: ${a.nombre}`} checked={a.activa} disabled={busy === a.id} onChange={(e) => activar(a, e.currentTarget.checked)} size='md' />
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
      )}
      {editar && (
        <EditarModal
          key={editar.id}
          config={config}
          item={editar}
          idCompany={company.idCompany}
          onClose={() => setEditar(null)}
          onSaved={(t) => {
            setEditar(null);
            avisar(true, t);
            void reload(true);
          }}
        />
      )}
    </Stack>
  );
}

function EditarModal({ config, item, idCompany, onClose, onSaved }: { config: Config; item: Clasificacion; idCompany: number; onClose: () => void; onSaved: (t: string) => void }) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const [nombre, setNombre] = useState(item.nombre);
  const [orden, setOrden] = useState<number | string>(item.orden);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setBusy(true);
    setError(null);
    try {
      await vitrinaSend(`${config.url}/${item.id}`, 'PATCH', { company: idCompany, nombre, orden: orden === '' ? 0 : Number(orden) });
      onSaved(`«${nombre.trim()}» actualizado.`);
    } catch (e) {
      setError(errorTexto(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={`Editar ${config.singular}`} size='md' fullScreen={mobile} radius='md'>
      <Stack gap='sm'>
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />}>
            {error}
          </Alert>
        )}
        <TextInput label='Nombre' size='md' value={nombre} onChange={(e) => setNombre(e.currentTarget.value)} maxLength={config.max} required />
        <NumberInput label='Orden' description='Menor número, primero en la lista' size='md' min={0} max={10000} allowDecimal={false} value={orden} onChange={setOrden} />
        <Group justify='flex-end' gap='sm' mt='sm'>
          <Button variant='default' size='md' onClick={onClose}>
            Cancelar
          </Button>
          <Button size='md' onClick={guardar} loading={busy} disabled={!nombre.trim()}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
