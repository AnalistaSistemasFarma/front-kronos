'use client';

import { useMemo, useState } from 'react';
import { Accordion, Alert, Badge, Button, Card, Group, Loader, Menu, Modal, SegmentedControl, SimpleGrid, Stack, Switch, Text, TextInput, ActionIcon } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertTriangle, IconArrowBackUp, IconCheck, IconDots, IconEdit, IconSearch, IconArchive, IconStar, IconAdjustments, IconPhoto } from '@tabler/icons-react';
import SgcSelect from '../sgc/SgcSelect';
import { CANAL_LABEL, VITRINA_LIMITS, type VitrinaCanal } from '../../lib/vitrina/constants';
import type { CodigoPresentacion, CompanyAccess, Presentacion } from './types';
import { CanalBadge, EstadoBadge, RegistroBadge, VisibilidadBadge } from './VitrinaBadges';
import PresentacionModal from './PresentacionModal';
import { errorTexto, fmtFechaHora, nombrePresentacion, OPCIONES_CANAL, OPCIONES_ESTADO, OPCIONES_VISIBILIDAD, useVitrinaFetch, vitrinaSend, type Avisar } from './vitrinaClient';

/**
 * Presentaciones de la empresa: estado, visibilidad, áreas y sus códigos SAP. Por
 * código: activar o desactivar (a mano), canal, visibilidad del canal y devolverlo a la
 * bandeja. «No visible» / «Interna» / «Vista al cliente» / «Ofertable» es lo que
 * resultaría HOY con las reglas (terceros, canal, registro, datos mínimos).
 */
export default function VitrinaPresentaciones({ company, version, avisar, onMedios }: { company: CompanyAccess; version: number; avisar: Avisar; onMedios?: (id: number) => void }) {
  const { data, error, loading, reload } = useVitrinaFetch<{ presentaciones: Presentacion[] }>(`/api/vitrina/gestion/presentaciones?company=${company.idCompany}&v=${version}`);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<string | null>(null);
  const [editar, setEditar] = useState<Presentacion | null>(null);
  const [codigo, setCodigo] = useState<{ p: Presentacion; c: CodigoPresentacion } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const lista = useMemo(() => {
    const all = data?.presentaciones ?? [];
    const t = q.trim().toLowerCase();
    return all.filter(
      (p) =>
        (!estado || p.estado === estado) &&
        (!t || [nombrePresentacion(p), p.familia ?? '', ...p.codigos.map((c) => c.itemCode)].some((v) => v.toLowerCase().includes(t)))
    );
  }, [data, q, estado]);

  const accion = async (clave: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(clave);
    try {
      await fn();
      avisar(true, ok);
      await reload(true);
    } catch (e) {
      avisar(false, errorTexto(e));
    } finally {
      setBusy(null);
    }
  };

  const patchPresentacion = (p: Presentacion, body: Record<string, unknown>) => vitrinaSend(`/api/vitrina/gestion/presentaciones/${p.id}`, 'PATCH', { company: company.idCompany, ...body });
  const patchCodigo = (c: CodigoPresentacion, body: Record<string, unknown>) => vitrinaSend(`/api/vitrina/gestion/codigos/${c.id}`, 'PATCH', { company: company.idCompany, ...body });

  return (
    <Stack gap='md'>
      {error && (
        <Alert color='red' icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
        <TextInput size='md' placeholder='Buscar por molécula, familia o código' leftSection={<IconSearch size={18} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <SgcSelect size='md' placeholder='Estado' data={OPCIONES_ESTADO} value={estado} onChange={setEstado} clearable />
      </SimpleGrid>

      {loading && !data ? (
        <Group justify='center' py='lg'>
          <Loader />
        </Group>
      ) : lista.length === 0 ? (
        <Card withBorder radius='md' p='lg'>
          <Text c='dimmed'>{(data?.presentaciones.length ?? 0) === 0 ? 'Aún no hay presentaciones. Créelas desde la bandeja, eligiendo los códigos SAP que se agrupan.' : 'Ninguna presentación coincide.'}</Text>
        </Card>
      ) : (
        <Accordion variant='separated' radius='md' chevronPosition='right' data-testid='vitrina-presentaciones'>
          {lista.map((p) => (
            <Accordion.Item key={p.id} value={String(p.id)}>
              <Accordion.Control>
                <Stack gap={4}>
                  <Group gap={6} wrap='nowrap'>
                    {p.destacada && <IconStar size={16} style={{ flexShrink: 0 }} />}
                    <Text fw={600} lineClamp={2}>
                      {nombrePresentacion(p)}
                    </Text>
                  </Group>
                  <Group gap={6} wrap='wrap'>
                    <EstadoBadge estado={p.estado} />
                    <VisibilidadBadge visibilidad={p.visibilidad} />
                    {p.esParaTerceros && <Badge variant='light' color='grape' size='sm'>Para terceros</Badge>}
                    <Badge variant='outline' color='gray' size='sm'>
                      {p.activos}/{p.codigos.length} activos
                    </Badge>
                    {p.familia && <Badge variant='outline' color='gray' size='sm'>{p.familia}</Badge>}
                    {p.exclusividades > 0 && <Badge variant='light' color='orange' size='sm'>{p.exclusividades} exclusividad(es)</Badge>}
                  </Group>
                </Stack>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap='sm'>
                  {p.faltantes.length > 0 && (
                    <Alert color='yellow' variant='light' icon={<IconAlertTriangle size={16} />} p='xs'>
                      <Text size='sm'>Faltan datos para mostrarla al cliente: {p.faltantes.join(', ')}.</Text>
                    </Alert>
                  )}
                  <Text size='sm'>
                    {[p.formaFarmaceutica, p.tallMan ? `Tall Man: ${p.tallMan}` : null].filter(Boolean).join(' · ') || 'Sin forma farmacéutica'}
                  </Text>
                  <Group gap={6}>
                    {p.areas.length ? p.areas.map((a) => <Badge key={a.id} variant='light' size='sm'>{a.nombre}</Badge>) : <Text size='sm' c='dimmed'>Sin áreas asistenciales</Text>}
                  </Group>
                  <Group gap='sm' wrap='wrap'>
                    <Button size='sm' variant='default' leftSection={<IconEdit size={16} />} onClick={() => setEditar(p)}>
                      Editar
                    </Button>
                    {onMedios && p.estado !== 'RETIRADA' && (
                      <Button size='sm' variant='default' leftSection={<IconPhoto size={16} />} onClick={() => onMedios(p.id)}>
                        Imágenes y documentos
                      </Button>
                    )}
                    {p.estado !== 'VALIDADA' && p.estado !== 'RETIRADA' && (
                      <Button size='sm' leftSection={<IconCheck size={16} />} loading={busy === `v${p.id}`} onClick={() => accion(`v${p.id}`, () => patchPresentacion(p, { estado: 'VALIDADA' }), `«${nombrePresentacion(p)}» validada.`)}>
                        Validar
                      </Button>
                    )}
                    {p.estado !== 'PENDIENTE' && (
                      <Button size='sm' variant='default' leftSection={<IconArrowBackUp size={16} />} loading={busy === `p${p.id}`} onClick={() => accion(`p${p.id}`, () => patchPresentacion(p, { estado: 'PENDIENTE' }), `«${nombrePresentacion(p)}» volvió a pendiente de validar.`)}>
                        Volver a pendiente
                      </Button>
                    )}
                    {p.estado !== 'RETIRADA' && (
                      <Button size='sm' variant='light' color='red' leftSection={<IconArchive size={16} />} loading={busy === `r${p.id}`} onClick={() => accion(`r${p.id}`, () => patchPresentacion(p, { estado: 'RETIRADA' }), `«${nombrePresentacion(p)}» retirada; sus códigos quedaron desactivados.`)}>
                        Retirar
                      </Button>
                    )}
                  </Group>
                  <Text fw={600} size='sm' mt='xs'>
                    Códigos SAP
                  </Text>
                  {p.codigos.length === 0 && <Text size='sm' c='dimmed'>Sin códigos. Agréguelos desde la bandeja.</Text>}
                  {p.codigos.map((c) => (
                    <Card key={c.id} withBorder radius='md' p='sm' data-testid='vitrina-codigo'>
                      <Group justify='space-between' wrap='nowrap' align='flex-start' gap='sm'>
                        <div style={{ minWidth: 0 }}>
                          <Text fw={700} size='sm'>
                            {c.itemCode}
                            {c.pais ? ` · ${c.pais}` : ''}
                          </Text>
                          <Text size='xs' c='dimmed' lineClamp={2}>
                            {c.itemName}
                          </Text>
                        </div>
                        <Group gap={4} wrap='nowrap'>
                          <Switch
                            checked={c.activado}
                            disabled={busy === `c${c.id}` || (!c.activado && (!c.activoEnSap || p.estado === 'RETIRADA'))}
                            onChange={(e) => {
                              const activar = e.currentTarget.checked;
                              void accion(`c${c.id}`, () => patchCodigo(c, { activado_vitrina: activar }), activar ? `${c.itemCode} activado en la Vitrina.` : `${c.itemCode} desactivado.`);
                            }}
                            aria-label={`Activo en la Vitrina ${c.itemCode}`}
                            size='md'
                            data-testid='vitrina-activar'
                          />
                          <Menu position='bottom-end' withinPortal>
                            <Menu.Target>
                              <ActionIcon variant='subtle' size='lg' aria-label={`Acciones de ${c.itemCode}`}>
                                <IconDots size={18} />
                              </ActionIcon>
                            </Menu.Target>
                            <Menu.Dropdown>
                              <Menu.Item leftSection={<IconAdjustments size={16} />} onClick={() => setCodigo({ p, c })}>
                                Canal, país y marca
                              </Menu.Item>
                              <Menu.Item
                                leftSection={<IconArrowBackUp size={16} />}
                                color='red'
                                onClick={() => accion(`c${c.id}`, () => patchCodigo(c, { quitar: true }), `${c.itemCode} devuelto a la bandeja.`)}
                              >
                                Devolver a la bandeja
                              </Menu.Item>
                            </Menu.Dropdown>
                          </Menu>
                        </Group>
                      </Group>
                      <Group gap={6} mt={6} wrap='wrap'>
                        <VisibilidadBadge visibilidad={c.visibilidadEfectiva} />
                        <RegistroBadge estado={c.registroEstado} venceEn={c.registroVenceEn} />
                        <CanalBadge canal={c.canal} />
                        {c.canal !== 'SIN_DATO' && <Badge variant='outline' color='gray' size='sm'>Canal en {OPCIONES_VISIBILIDAD.find((o) => o.value === c.visibilidadCanal)?.label.toLowerCase()}</Badge>}
                        {!c.activoEnSap && <Badge variant='light' color='red' size='sm'>Inactivo en SAP</Badge>}
                        {c.clienteMarca && <Badge variant='outline' color='gray' size='sm'>{c.clienteMarca}</Badge>}
                      </Group>
                      {c.motivos.length > 0 && c.visibilidadEfectiva !== 'CLIENTE' && c.visibilidadEfectiva !== 'OFERTABLE' && (
                        <Text size='xs' c='dimmed' mt={6}>
                          No llega al cliente: {c.motivos.join(' · ')}
                        </Text>
                      )}
                      {c.ultimaLectura && (
                        <Text size='xs' c='dimmed' mt={2}>
                          Leído de SAP: {fmtFechaHora(c.ultimaLectura)}
                        </Text>
                      )}
                    </Card>
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}

      <PresentacionModal
        opened={Boolean(editar)}
        onClose={() => setEditar(null)}
        idCompany={company.idCompany}
        presentacion={editar}
        onSaved={(t) => {
          setEditar(null);
          avisar(true, t);
          void reload(true);
        }}
      />
      {codigo && (
        <CodigoModal
          key={codigo.c.id}
          idCompany={company.idCompany}
          presentacion={codigo.p}
          codigo={codigo.c}
          onClose={() => setCodigo(null)}
          onSaved={(t) => {
            setCodigo(null);
            avisar(true, t);
            void reload(true);
          }}
        />
      )}
    </Stack>
  );
}

function CodigoModal({ idCompany, presentacion, codigo, onClose, onSaved }: { idCompany: number; presentacion: Presentacion; codigo: CodigoPresentacion; onClose: () => void; onSaved: (t: string) => void }) {
  const mobile = useMediaQuery('(max-width: 48em)') ?? false;
  const [canal, setCanal] = useState<string>(codigo.canal);
  const [visCanal, setVisCanal] = useState<string>(codigo.visibilidadCanal);
  const [pais, setPais] = useState(codigo.pais ?? '');
  const [marca, setMarca] = useState(codigo.clienteMarca ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terceros = presentacion.esParaTerceros;

  const guardar = async () => {
    setBusy(true);
    setError(null);
    try {
      await vitrinaSend(`/api/vitrina/gestion/codigos/${codigo.id}`, 'PATCH', { company: idCompany, canal, visibilidad_canal: terceros ? 'INTERNA' : visCanal, pais, cliente_marca: marca });
      onSaved(`${codigo.itemCode} actualizado.`);
    } catch (e) {
      setError(errorTexto(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={`Código ${codigo.itemCode}`} size='md' fullScreen={mobile} radius='md'>
      <Stack gap='sm'>
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />}>
            {error}
          </Alert>
        )}
        <SgcSelect label='Canal' size='md' data={OPCIONES_CANAL} value={canal} onChange={(v) => setCanal(v ?? 'SIN_DATO')} allowDeselect={false} />
        {canal !== 'SIN_DATO' && (
          <div>
            <Text size='sm' fw={500} mb={4}>
              Visibilidad del canal {CANAL_LABEL[canal as VitrinaCanal].toLowerCase()}
            </Text>
            <SegmentedControl fullWidth size='md' data={OPCIONES_VISIBILIDAD} value={terceros ? 'INTERNA' : visCanal} onChange={setVisCanal} disabled={terceros} />
            <Text size='xs' c='dimmed' mt={4}>
              Los canales empiezan en «Interna». El código nunca supera la visibilidad de la presentación.
            </Text>
          </div>
        )}
        <TextInput label='País' size='md' value={pais} onChange={(e) => setPais(e.currentTarget.value)} maxLength={VITRINA_LIMITS.pais} />
        <TextInput label='Cliente o marca' description='PISA, Bioselect, CORVAL…' size='md' value={marca} onChange={(e) => setMarca(e.currentTarget.value)} maxLength={VITRINA_LIMITS.clienteMarca} />
        <Group justify='flex-end' gap='sm' mt='sm'>
          <Button variant='default' size='md' onClick={onClose}>
            Cancelar
          </Button>
          <Button size='md' onClick={guardar} loading={busy}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
