'use client';

import React, { useMemo, useState } from 'react';
import { Alert, Autocomplete, Badge, Button, Card, Group, Loader, Modal, SimpleGrid, Stack, Table, Tabs, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconDevicesPc, IconFilePlus, IconLock, IconPencil, IconPlus, IconSearch, IconSettings, IconStethoscope } from '@tabler/icons-react';
import SgcShell from '../../../../../components/sgc/SgcShell';
import SgcSelect from '../../../../../components/sgc/SgcSelect';
import BiomedEditor from '../../../../../components/sgc/biomedica/BiomedEditor';
import BiomedInventario from '../../../../../components/sgc/biomedica/BiomedInventario';
import { sgcSend, useSgcFetch } from '../../../../../components/sgc/useSgcFetch';
import type { BiomedAccess } from '../../../../../lib/biomedica/access';
import type { BiomedFormatoDto, BiomedRegistroResumenDto } from '../../../../../lib/biomedica/db';
import { ACTIVIDAD_INSPECCION } from '../../../../../lib/biomedica/hojaVidaTipos';
import type { ResumenInventario } from '../../../../../lib/biomedica/inventario';
import type { SgcCompanyAccess } from '../../../../../lib/sgc/permissions';

/**
 * INGENIERÍA BIOMÉDICA (Gestión de Calidad → Ingeniería biomédica; 2026-11-06,
 * reunión con Juan Mora y boceto de Andrea Barragán). Solo ingenieros
 * biomédicos y Aseguramiento de Calidad. Los formatos son los VIGENTES del SGC
 * que Calidad habilita por actividad; se diligencian encima del PDF y, si el
 * formato deja de estar vigente, el borrador se bloquea.
 * Fase 3 (2026-11-23): la «Inspección de equipos biomédicos nuevos» pide los
 * datos del equipo (al elegir el modelo se llenan solos) y, al cerrarla, el
 * equipo entra al inventario en bodega.
 */

const VACIO_EQ = { equipo: '', marca: '', modelo: '', serie: '', codigoInterno: '', clasificacionRiesgo: '', registroSanitario: '' };
type EquipoInspeccion = typeof VACIO_EQ;

type Datos = { access: BiomedAccess; actividades: string[]; formatos: BiomedFormatoDto[]; registros: BiomedRegistroResumenDto[] };

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }) : '—');

function Biomedica({ company }: { company: SgcCompanyAccess }) {
  const [q, setQ] = useState('');
  const datos = useSgcFetch<Datos>(`/api/biomedica?company=${company.idCompany}${q.trim().length >= 2 ? `&q=${encodeURIComponent(q.trim())}` : ''}`);
  const docs = useSgcFetch<{ documents: { idDocument: number; code: string; title: string }[] }>(datos.data?.access.canConfigure ? `/api/sgc/documents?company=${company.idCompany}&status=vigente` : null);
  const [nuevo, setNuevo] = useState<BiomedFormatoDto | null>(null);
  const [equipo, setEquipo] = useState('');
  const [serial, setSerial] = useState('');
  const [eqIns, setEqIns] = useState<EquipoInspeccion>(VACIO_EQ);
  const esInspeccion = nuevo?.actividad === ACTIVIDAD_INSPECCION;
  const resumenInv = useSgcFetch<{ resumen: ResumenInventario }>(esInspeccion ? `/api/biomedica/inventario?company=${company.idCompany}&resumen=1&pageSize=1` : null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [cfgDoc, setCfgDoc] = useState<string | null>(null);
  const [cfgAct, setCfgAct] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const porActividad = useMemo(() => {
    const m = new Map<string, BiomedFormatoDto[]>();
    for (const f of datos.data?.formatos ?? []) if (f.isActive) m.set(f.actividad, [...(m.get(f.actividad) ?? []), f]);
    return m;
  }, [datos.data]);

  if (datos.error) {
    return (
      <Alert color='orange' icon={<IconLock size={18} />} data-testid='biomed-sin-acceso'>
        {datos.error}
      </Alert>
    );
  }
  if (!datos.data) {
    return (
      <Group justify='center' my='xl'>
        <Loader />
      </Group>
    );
  }
  const d = datos.data;

  const crear = async () => {
    if (!nuevo) return;
    setBusy(true);
    setError(null);
    try {
      const r = await sgcSend<{ id: number }>(
        '/api/biomedica/registros',
        'POST',
        esInspeccion ? { company: company.idCompany, idFormato: nuevo.id, equipoDatos: eqIns } : { company: company.idCompany, idFormato: nuevo.id, equipo, serial }
      );
      setNuevo(null);
      setEquipo('');
      setSerial('');
      setEqIns(VACIO_EQ);
      datos.reload();
      setAbierto(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const habilitar = async (idDocument: number, actividad: string, isActive = true) => {
    setBusy(true);
    setError(null);
    try {
      await sgcSend('/api/biomedica/formatos', 'POST', { company: company.idCompany, idDocument, actividad, isActive });
      setCfgDoc(null);
      datos.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap='md'>
      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Tabs defaultValue='formatos' keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value='formatos' leftSection={<IconFilePlus size={16} />}>
            Diligenciar
          </Tabs.Tab>
          <Tabs.Tab value='registros' leftSection={<IconStethoscope size={16} />}>
            Formatos diligenciados ({d.registros.length})
          </Tabs.Tab>
          <Tabs.Tab value='inventario' leftSection={<IconDevicesPc size={16} />} data-testid='biomed-tab-inventario'>
            Inventario de equipos
          </Tabs.Tab>
          {d.access.canConfigure && (
            <Tabs.Tab value='config' leftSection={<IconSettings size={16} />}>
              Formatos del módulo
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value='formatos' pt='md'>
          {porActividad.size === 0 ? (
            <Alert color='gray'>Aún no hay formatos habilitados. Aseguramiento de Calidad los elige en Formatos del módulo.</Alert>
          ) : (
            <Stack gap='sm'>
              {d.actividades
                .filter((a) => porActividad.has(a))
                .concat([...porActividad.keys()].filter((a) => !d.actividades.includes(a)))
                .map((act) => (
                  <Card key={act} withBorder radius='md' p='md'>
                    <Text fw={600} mb='xs'>
                      {act}
                    </Text>
                    <Stack gap={6}>
                      {porActividad.get(act)!.map((f) => (
                        <Group key={f.id} justify='space-between' wrap='nowrap' data-testid='biomed-formato'>
                          <Text size='sm'>
                            <b>{f.code}</b> · {f.title} {f.vigente ? <Badge size='xs' variant='light'>V{f.vigente.versionNumber}</Badge> : <Badge size='xs' color='orange'>no vigente</Badge>}
                          </Text>
                          <Button size='xs' leftSection={<IconPencil size={14} />} disabled={!f.vigente} onClick={() => setNuevo(f)} data-testid='biomed-diligenciar'>
                            Diligenciar
                          </Button>
                        </Group>
                      ))}
                    </Stack>
                  </Card>
                ))}
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value='inventario' pt='md'>
          <BiomedInventario idCompany={company.idCompany} empresa={company.companyName} />
        </Tabs.Panel>

        <Tabs.Panel value='registros' pt='md'>
          <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' leftSection={<IconSearch size={16} />} placeholder='Buscar por equipo o serial' value={q} onChange={(e) => setQ(e.currentTarget.value)} w={300} mb='sm' />
          {d.registros.length === 0 ? (
            <Text size='sm' c='dimmed'>
              No hay formatos diligenciados.
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={760}>
              <Table striped highlightOnHover verticalSpacing='xs' data-testid='biomed-registros'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Equipo</Table.Th>
                    <Table.Th>Serial</Table.Th>
                    <Table.Th>Formato</Table.Th>
                    <Table.Th>Actividad</Table.Th>
                    <Table.Th>Estado</Table.Th>
                    <Table.Th>Fecha</Table.Th>
                    <Table.Th>Por</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {d.registros.map((r) => (
                    <Table.Tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setAbierto(r.id)} data-testid='biomed-registro'>
                      <Table.Td>{r.equipo}</Table.Td>
                      <Table.Td>{r.serial ?? '—'}</Table.Td>
                      <Table.Td>
                        {r.code} V{r.versionNumber}
                      </Table.Td>
                      <Table.Td>{r.actividad}</Table.Td>
                      <Table.Td>
                        <Badge variant='light' color={r.estado === 'cerrado' ? 'green' : r.bloqueado ? 'orange' : 'blue'}>
                          {r.estado === 'cerrado' ? 'Cerrado' : r.bloqueado ? 'Bloqueado (formato no vigente)' : 'Borrador'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{fecha(r.closedAt ?? r.createdAt)}</Table.Td>
                      <Table.Td>{r.createdBy}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Tabs.Panel>

        {d.access.canConfigure && (
          <Tabs.Panel value='config' pt='md'>
            <Card withBorder radius='md' p='md' mb='md'>
              <Text size='sm' c='dimmed' mb='sm'>
                Elija los formatos VIGENTES del SGC que los ingenieros diligencian en el módulo y la actividad a la que pertenecen. Si un formato deja de estar vigente, sus borradores se bloquean.
              </Text>
              <Group align='flex-end' wrap='wrap'>
                <SgcSelect label='Formato vigente del SGC' searchable data={(docs.data?.documents ?? []).map((x) => ({ value: String(x.idDocument), label: `${x.code} · ${x.title}` }))} value={cfgDoc} onChange={setCfgDoc} w={420} data-testid='biomed-cfg-doc' />
                <SgcSelect label='Actividad' data={d.actividades} value={cfgAct} onChange={setCfgAct} w={340} data-testid='biomed-cfg-actividad' />
                <Button leftSection={<IconPlus size={16} />} disabled={!cfgDoc || !cfgAct} loading={busy} onClick={() => void habilitar(Number(cfgDoc), cfgAct!)} data-testid='biomed-cfg-habilitar'>
                  Habilitar
                </Button>
              </Group>
            </Card>
            <Table verticalSpacing='xs'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Formato</Table.Th>
                  <Table.Th>Actividad</Table.Th>
                  <Table.Th>Vigencia</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {d.formatos.map((f) => (
                  <Table.Tr key={f.id} style={{ opacity: f.isActive ? 1 : 0.5 }}>
                    <Table.Td>
                      {f.code} · {f.title}
                    </Table.Td>
                    <Table.Td>{f.actividad}</Table.Td>
                    <Table.Td>{f.vigente ? `V${f.vigente.versionNumber} vigente` : 'No vigente'}</Table.Td>
                    <Table.Td>
                      <Button size='xs' variant='subtle' color={f.isActive ? 'red' : 'blue'} disabled={!f.isActive && !f.vigente} onClick={() => void habilitar(f.idDocument, f.actividad, !f.isActive)}>
                        {f.isActive ? 'Retirar' : 'Volver a habilitar'}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Tabs.Panel>
        )}
      </Tabs>

      <Modal opened={Boolean(nuevo)} onClose={() => setNuevo(null)} title={nuevo ? `Diligenciar ${nuevo.code}` : ''} size={esInspeccion ? 'lg' : 'md'}>
        <Stack gap='sm'>
          <Text size='sm' c='dimmed'>
            Se diligencia la versión vigente ({nuevo?.vigente ? `V${nuevo.vigente.versionNumber}` : '—'}). El formato del SGC no cambia: lo escrito va encima.
          </Text>
          {esInspeccion ? (
            <InspeccionCampos v={eqIns} onChange={setEqIns} resumen={resumenInv.data?.resumen ?? null} />
          ) : (
            <>
              <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Equipo' required value={equipo} onChange={(e) => setEquipo(e.currentTarget.value)} data-testid='biomed-equipo' />
              <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Serial (opcional)' value={serial} onChange={(e) => setSerial(e.currentTarget.value)} data-testid='biomed-serial' />
              <Text size='xs' c='dimmed'>
                Si el serial es de un equipo del inventario, el formato queda en su hoja de vida.
              </Text>
            </>
          )}
          {error && (
            <Alert color='red' icon={<IconAlertTriangle size={16} />}>
              {error}
            </Alert>
          )}
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setNuevo(null)}>
              Cancelar
            </Button>
            <Button disabled={esInspeccion ? eqIns.equipo.trim().length < 2 || !eqIns.serie.trim() : equipo.trim().length < 2} loading={busy} onClick={() => void crear()} data-testid='biomed-crear'>
              Diligenciar
            </Button>
          </Group>
        </Stack>
      </Modal>

      {abierto !== null && <BiomedEditor idCompany={company.idCompany} idRegistro={abierto} onClose={() => setAbierto(null)} onChanged={() => datos.reload()} />}
    </Stack>
  );
}

/** Datos del equipo NUEVO que se inspecciona: al elegir un modelo ya usado se llenan los demás. */
function InspeccionCampos({ v, onChange, resumen }: { v: EquipoInspeccion; onChange: (v: EquipoInspeccion) => void; resumen: ResumenInventario | null }) {
  const set = (k: keyof EquipoInspeccion, x: string) => {
    const p = k === 'modelo' ? resumen?.plantillas?.[x] : undefined;
    onChange({
      ...v,
      [k]: x,
      ...(p
        ? {
            equipo: v.equipo || p.equipo || '',
            marca: v.marca || p.marca || '',
            codigoInterno: v.codigoInterno || p.codigoInterno || '',
            clasificacionRiesgo: v.clasificacionRiesgo || p.clasificacionRiesgo || '',
            registroSanitario: v.registroSanitario || p.registroSanitario || '',
          }
        : {}),
    });
  };
  const campo = { autoComplete: 'off', 'data-1p-ignore': 'true', 'data-lpignore': 'true' } as const;
  return (
    <Stack gap='xs' data-testid='biomed-inspeccion-campos'>
      <Alert color='blue' variant='light' p='xs'>
        <Text size='sm'>Al cerrar la inspección, el equipo entra al inventario en bodega con su hoja de vida.</Text>
      </Alert>
      <SimpleGrid cols={2} spacing='xs'>
        <Autocomplete label='Modelo' data={resumen?.modelos ?? []} value={v.modelo} onChange={(x) => set('modelo', x)} limit={30} {...campo} data-testid='biomed-ins-modelo' />
        <TextInput label='Serie' required value={v.serie} onChange={(e) => set('serie', e.currentTarget.value)} {...campo} data-testid='biomed-ins-serie' />
        <Autocomplete label='Equipo' required data={resumen?.equipos ?? []} value={v.equipo} onChange={(x) => set('equipo', x)} limit={30} {...campo} data-testid='biomed-ins-equipo' />
        <Autocomplete label='Marca' data={resumen?.marcas ?? []} value={v.marca} onChange={(x) => set('marca', x)} limit={30} {...campo} />
        <Autocomplete label='Código interno' data={resumen?.codigos ?? []} value={v.codigoInterno} onChange={(x) => set('codigoInterno', x)} limit={30} {...campo} />
        <Autocomplete label='Clasificación de riesgo' data={resumen?.clasificaciones ?? []} value={v.clasificacionRiesgo} onChange={(x) => set('clasificacionRiesgo', x)} limit={30} {...campo} />
        <TextInput label='Registro sanitario' value={v.registroSanitario} onChange={(e) => set('registroSanitario', e.currentTarget.value)} {...campo} />
      </SimpleGrid>
    </Stack>
  );
}

export default function BiomedicaPage() {
  return (
    <SgcShell section='Ingeniería biomédica' subtitle='Gestión de Calidad · formatos vigentes del SGC diligenciados por los ingenieros biomédicos'>
      {(company) => <Biomedica company={company} />}
    </SgcShell>
  );
}
