'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Anchor, Badge, Breadcrumbs, Button, Card, Checkbox, Group, Loader, Modal, MultiSelect, Stack, Table, Tabs, Text, Textarea, Title, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconChevronRight, IconEdit, IconPlugConnectedX, IconSettings } from '@tabler/icons-react';
import AgentAvatar from '../chat/AgentAvatar';
import SgcSelect, { sgcTouchComboboxProps } from '../sgc/SgcSelect';
import { apiGet, apiSend } from './api';
import { PROJECT_PROFILES, profileLabel } from '../../lib/chat/projects-rules';
import { MAX_CONFIG_REASON_CHARS, MIN_CONFIG_REASON_CHARS } from '../../lib/proyectos/config-agentes-rules';
import type { AccesoConfigDto, AgenteConfigDto, ConfigEmpresaDto } from '../../lib/proyectos/config-agentes-tipos';

/**
 * CONFIGURACIÓN del módulo «Proyectos» (/process/proyectos/configuracion).
 * Pedido de Nicolás Rivera del 2026-10-20: qué asistentes pueden trabajar en
 * proyectos se decide aquí, por empresa, y no en el .env del servidor.
 *
 * Mismo marco que la Configuración del SGC (components/sgc/SgcShell.tsx y
 * app/(hub)/process/sgc-documental/configuracion/page.tsx): migas, título con
 * icono, empresa a la derecha, pestañas, tarjetas con tabla y un modal de
 * edición con «Motivo del cambio» que queda en el registro. Nada se borra: se
 * deshabilita.
 */

type Feedback = { color: 'green' | 'red'; text: string } | null;
type Edicion = { agente: AgenteConfigDto; enabled: boolean; profiles: string[]; reason: string };

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

const perfilesTexto = (keys: string[]) => (keys.length ? keys.map(profileLabel).join(', ') : '—');

function EstadoBadge({ habilitado }: { habilitado: boolean }) {
  return (
    <Badge size='xs' color={habilitado ? 'green' : 'gray'} variant='light'>
      {habilitado ? 'Habilitado' : 'No habilitado'}
    </Badge>
  );
}

function Configuracion({ idCompany }: { idCompany: number }) {
  const [data, setData] = useState<ConfigEmpresaDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [editing, setEditing] = useState<Edicion | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    const r = await apiGet<ConfigEmpresaDto>(`/api/proyectos/configuracion?company=${idCompany}`, 'No se pudo cargar la configuración.');
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else if (r.error) setError(r.error);
  }, [idCompany]);

  useEffect(() => {
    setData(null);
    void cargar();
  }, [cargar]);

  if (error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />}>
        {error}
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

  const guardar = async () => {
    if (!editing) return;
    setBusy(true);
    setFeedback(null);
    const r = await apiSend<{ ok: true; copiados: number }>('POST', '/api/proyectos/configuracion', {
      company: idCompany,
      idAgent: editing.agente.idAgent,
      enabled: editing.enabled,
      profiles: editing.profiles,
      reason: editing.reason,
    });
    setBusy(false);
    if (r.ok) {
      const copia = r.data.copiados > 0 ? ` La configuración que venía del servidor para ${r.data.copiados} asistente(s) más quedó copiada y registrada.` : '';
      setFeedback({ color: 'green', text: `Cambio guardado y registrado en la auditoría.${copia}` });
      setEditing(null);
      void cargar();
    } else {
      setFeedback({ color: 'red', text: r.error || 'No se pudo guardar el cambio.' });
    }
  };

  const motivoCorto = (editing?.reason.trim().length ?? 0) < MIN_CONFIG_REASON_CHARS;
  const sinPerfil = !!editing?.enabled && editing.profiles.length === 0;

  return (
    <Stack gap='lg'>
      {feedback && (
        <Alert
          color={feedback.color}
          icon={feedback.color === 'green' ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />}
          withCloseButton
          onClose={() => setFeedback(null)}
          data-testid='proyectos-config-feedback'
        >
          {feedback.text}
        </Alert>
      )}

      {!data.tablaLista ? (
        <Alert color='yellow' icon={<IconAlertTriangle size={18} />} title='Configuración aún no instalada' data-testid='proyectos-config-sin-tabla'>
          La base de datos todavía no tiene la tabla de configuración. Mientras tanto se usa la configuración del servidor (CHAT_PROJECTS_AGENTS) y
          esta pantalla es de solo lectura.
        </Alert>
      ) : data.origen === 'env' ? (
        <Alert color='blue' icon={<IconSettings size={18} />} title='Esta empresa usa la configuración del servidor' data-testid='proyectos-config-origen-env'>
          Hoy los asistentes de esta empresa se habilitan desde el servidor (CHAT_PROJECTS_AGENTS). Al guardar el primer cambio, lo que dice el
          servidor se copia aquí y queda registrado; desde ese momento manda esta pantalla.
        </Alert>
      ) : null}

      <Tabs defaultValue='asistentes' keepMounted={false}>
        <Tabs.List mb='md'>
          <Tabs.Tab value='asistentes'>Asistentes</Tabs.Tab>
          <Tabs.Tab value='registro'>Registro de cambios</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value='asistentes'>
          <Card withBorder radius='md' p='lg' shadow='xs'>
            <Text size='sm' c='dimmed' mb='sm'>
              Asistentes activos de la empresa. Marque cuáles pueden trabajar en proyectos y con qué perfiles de conectores. El permiso de cada persona
              para usar Proyectos y cada asistente se sigue dando en Administración → Usuarios.
            </Text>
            {data.agentes.length === 0 ? (
              <Text size='sm' c='dimmed' ta='center' py='lg'>
                La empresa no tiene asistentes activos.
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={760}>
                <Table verticalSpacing='xs' data-testid='proyectos-config-tabla'>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Asistente</Table.Th>
                      <Table.Th>Proyectos</Table.Th>
                      <Table.Th>Perfiles de conectores</Table.Th>
                      <Table.Th>Puente</Table.Th>
                      <Table.Th>Último cambio</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.agentes.map((a) => {
                      const soloLectura = !a.puente || !data.tablaLista;
                      return (
                        <Table.Tr key={a.idAgent} data-testid='proyectos-config-fila' data-agente={a.code}>
                          <Table.Td>
                            <Group gap='sm' wrap='nowrap'>
                              <AgentAvatar code={a.code} displayName={a.displayName} avatarUrl={a.avatarUrl} avatarVersion={a.avatarVersion} size={30} showStatus={false} withTooltip={false} />
                              <div>
                                <Text size='sm' fw={500}>
                                  {a.displayName}
                                </Text>
                                <Text size='xs' c='dimmed' ff='monospace'>
                                  {a.code}
                                </Text>
                              </div>
                            </Group>
                          </Table.Td>
                          <Table.Td style={{ minWidth: 170 }}>
                            <Checkbox
                              checked={a.habilitado}
                              disabled={soloLectura}
                              aria-label={`Habilitar a ${a.displayName} en Proyectos`}
                              label={<EstadoBadge habilitado={a.habilitado} />}
                              onChange={(e) =>
                                setEditing({
                                  agente: a,
                                  enabled: e.currentTarget.checked,
                                  profiles: a.perfiles.length ? a.perfiles : a.perfilesEnv,
                                  reason: '',
                                })
                              }
                              data-testid='proyectos-config-casilla'
                            />
                          </Table.Td>
                          <Table.Td>
                            <Text size='sm'>{perfilesTexto(a.perfiles)}</Text>
                          </Table.Td>
                          <Table.Td>
                            {a.puente ? (
                              <Badge size='xs' color='teal' variant='light'>
                                Puente activo
                              </Badge>
                            ) : (
                              <Tooltip label='No tiene llave de proyectos en el servidor: nadie atendería sus proyectos. Solo lectura.' withArrow multiline w={260}>
                                <Badge size='xs' color='gray' variant='light' leftSection={<IconPlugConnectedX size={12} />} data-testid='proyectos-config-sin-puente'>
                                  Sin puente activo
                                </Badge>
                              </Tooltip>
                            )}
                          </Table.Td>
                          <Table.Td>
                            {a.ultimoCambio ? (
                              <Text size='xs' c='dimmed'>
                                {a.ultimoCambio.por ?? '—'} · {fechaHora(a.ultimoCambio.fecha)}
                              </Text>
                            ) : (
                              <Text size='xs' c='dimmed'>
                                {data.origen === 'env' ? 'Configuración del servidor' : 'Sin configurar'}
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Button
                              size='xs'
                              variant='subtle'
                              leftSection={<IconEdit size={14} />}
                              disabled={soloLectura}
                              onClick={() =>
                                setEditing({ agente: a, enabled: a.habilitado, profiles: a.perfiles.length ? a.perfiles : a.perfilesEnv, reason: '' })
                              }
                            >
                              Editar
                            </Button>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Card>
        </Tabs.Panel>

        <Tabs.Panel value='registro'>
          <Card withBorder radius='md' p='lg' shadow='xs'>
            {data.registro.length === 0 ? (
              <Text size='sm' c='dimmed' ta='center' py='lg' data-testid='proyectos-config-registro-vacio'>
                Todavía no hay cambios registrados en esta empresa.
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={760}>
                <Table verticalSpacing='xs' data-testid='proyectos-config-registro'>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Fecha</Table.Th>
                      <Table.Th>Asistente</Table.Th>
                      <Table.Th>Cambio</Table.Th>
                      <Table.Th>Motivo</Table.Th>
                      <Table.Th>Por</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.registro.map((r) => (
                      <Table.Tr key={r.id}>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          <Text size='xs'>{fechaHora(r.fecha)}</Text>
                        </Table.Td>
                        <Table.Td>{r.agente}</Table.Td>
                        <Table.Td style={{ minWidth: 250 }}>
                          {r.accion === 'copia_env' ? (
                            <Badge size='xs' variant='light' color='blue'>
                              Copiado del servidor
                            </Badge>
                          ) : (
                            <Group gap={4} wrap='nowrap'>
                              {r.habilitadoAntes !== null && <EstadoBadge habilitado={r.habilitadoAntes} />}
                              <IconChevronRight size={12} />
                              <EstadoBadge habilitado={r.habilitadoDespues} />
                            </Group>
                          )}
                          <Text size='xs' c='dimmed' mt={2}>
                            {r.accion === 'copia_env' || perfilesTexto(r.perfilesAntes) === perfilesTexto(r.perfilesDespues)
                              ? perfilesTexto(r.perfilesDespues)
                              : `${perfilesTexto(r.perfilesAntes)} → ${perfilesTexto(r.perfilesDespues)}`}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size='sm'>{r.motivo}</Text>
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          <Text size='sm'>{r.por}</Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Card>
        </Tabs.Panel>
      </Tabs>

      <Modal opened={!!editing} onClose={() => setEditing(null)} title={editing ? `Editar · ${editing.agente.displayName}` : 'Editar'} centered>
        {editing && (
          <Stack>
            <Checkbox
              label='Habilitado para trabajar en Proyectos'
              description='Deshabilitarlo deja sus conversaciones de proyecto en solo lectura; no borra nada.'
              checked={editing.enabled}
              onChange={(e) => setEditing({ ...editing, enabled: e.currentTarget.checked })}
              data-testid='proyectos-config-modal-habilitado'
            />
            <MultiSelect
              label='Perfiles de conectores'
              description='Los que se pueden escoger al crear un proyecto con este asistente en esta empresa.'
              data={PROJECT_PROFILES.map((p) => ({ value: p.key, label: p.label }))}
              value={editing.profiles}
              onChange={(v) => setEditing({ ...editing, profiles: v })}
              error={sinPerfil ? 'Escoja al menos un perfil para habilitarlo.' : undefined}
              comboboxProps={sgcTouchComboboxProps()}
              data-testid='proyectos-config-modal-perfiles'
            />
            {editing.agente.perfilesEnv.length > 0 && (
              <Text size='xs' c='dimmed'>
                En el servidor (CHAT_PROJECTS_AGENTS): {perfilesTexto(editing.agente.perfilesEnv)}.
              </Text>
            )}
            <Textarea
              autoComplete='off'
              data-1p-ignore='true'
              data-lpignore='true'
              label='Motivo del cambio'
              description='Queda en la auditoría (registro de cambios).'
              value={editing.reason}
              maxLength={MAX_CONFIG_REASON_CHARS}
              onChange={(e) => setEditing({ ...editing, reason: e.currentTarget.value })}
              minRows={2}
              data-testid='proyectos-config-modal-motivo'
            />
            <Button loading={busy} disabled={motivoCorto || sinPerfil} onClick={() => void guardar()} data-testid='proyectos-config-modal-guardar'>
              Guardar
            </Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

export default function ConfiguracionProyectos() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [acceso, setAcceso] = useState<AccesoConfigDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await apiGet<AccesoConfigDto>('/api/proyectos/configuracion', 'No se pudo cargar la configuración.');
      if (r.ok) setAcceso(r.data);
      else if (r.error) setError(r.error);
    })();
  }, []);

  const companies = useMemo(() => acceso?.companies ?? [], [acceso]);
  const pedida = Number.parseInt(searchParams.get('company') ?? '', 10);
  const companyId = companies.some((c) => c.idCompany === pedida) ? pedida : companies[0]?.idCompany ?? null;
  const setCompanyId = (v: string | null) => {
    if (!v) return;
    const q = new URLSearchParams(searchParams.toString());
    q.set('company', v);
    router.replace(`/process/proyectos/configuracion?${q.toString()}`);
  };

  if (error) {
    return (
      <Alert color='red' icon={<IconAlertTriangle size={18} />} title='Configuración de Proyectos' mt='md'>
        {error}
      </Alert>
    );
  }
  if (!acceso) {
    return (
      <Group justify='center' mt='xl'>
        <Loader />
      </Group>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--mantine-color-body)' }}>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Card shadow='sm' p='xl' radius='md' withBorder mb='lg'>
          <Breadcrumbs separator={<IconChevronRight size={16} />} className='mb-4'>
            <Anchor component={Link} href='/process'>
              Procesos
            </Anchor>
            <Anchor component={Link} href='/process/proyectos'>
              Proyectos
            </Anchor>
            <Text>Configuración</Text>
          </Breadcrumbs>

          <Group justify='space-between' align='flex-end' wrap='wrap' gap='md'>
            <div>
              <Title order={1} className='text-3xl font-bold mb-2 flex items-center gap-3' data-testid='proyectos-config-titulo'>
                <IconSettings size={32} className='text-blue-600' />
                Configuración
              </Title>
              <Text size='lg' c='dimmed'>
                Asistentes que pueden trabajar en Proyectos, por empresa
              </Text>
            </div>
            {companies.length > 1 && companyId !== null && (
              <SgcSelect
                label='Empresa'
                data={companies.map((c) => ({ value: String(c.idCompany), label: c.companyName }))}
                value={String(companyId)}
                onChange={setCompanyId}
                allowDeselect={false}
                w={240}
                data-testid='proyectos-config-empresa'
              />
            )}
          </Group>
        </Card>

        {companyId === null ? (
          <Alert color='yellow' icon={<IconAlertTriangle size={18} />} title='Solo administradores del módulo' data-testid='proyectos-config-sin-permiso'>
            No tiene permiso para configurar Proyectos. Lo otorga Tecnología en Administración → Usuarios → Asignar subprocesos («Configuración de
            Proyectos»), por empresa.
          </Alert>
        ) : (
          <Configuracion idCompany={companyId} />
        )}
      </div>
    </div>
  );
}
