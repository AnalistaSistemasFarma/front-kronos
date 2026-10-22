'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  Radio,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { IconAlertCircle, IconMail, IconMessagePlus, IconRobot, IconSearch, IconTicket, IconUserPlus } from '@tabler/icons-react';
import AgentAvatar from '../chat/AgentAvatar';
import { MAX_LINK_SUMMARY_CHARS } from '../../lib/chat/projects-rules';
import type {
  AgenteDesignableDto,
  CandidatoDto,
  HiloElegibleDto,
  ProyectoDetalleDto,
  SolicitudElegibleDto,
} from '../../lib/proyectos/tipos';
import { apiGet, apiSend, fechaCorta } from './api';
import { CONSULTA_ESCRITORIO, EsqueletoFilas } from './ui';
import css from './proyectos.module.css';

/** Marco común: a pantalla completa en celular y tableta, con el pie de acciones fijo. */
export function Marco({
  opened,
  onClose,
  titulo,
  icono,
  children,
  pie,
  testId,
}: {
  opened: boolean;
  onClose: () => void;
  titulo: string;
  icono: ReactNode;
  children: ReactNode;
  pie: ReactNode;
  testId: string;
}) {
  const escritorio = useMediaQuery(CONSULTA_ESCRITORIO) ?? true;
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen={!escritorio}
      size='lg'
      radius='md'
      centered
      classNames={{ content: css.modalTactil }}
      closeButtonProps={{ size: escritorio ? 'md' : 'xl', 'aria-label': 'Cerrar' }}
      title={
        <Group gap={8} wrap='nowrap'>
          {icono}
          <Text fw={700}>{titulo}</Text>
        </Group>
      }
      data-testid={testId}
    >
      <Stack gap='md'>
        {children}
        <Group justify='flex-end' gap='sm' className={escritorio ? undefined : css.pieModal}>
          {pie}
        </Group>
      </Stack>
    </Modal>
  );
}

export function ErrorArriba({ error, onClose }: { error: string | null; onClose: () => void }) {
  if (!error) return null;
  return (
    <Alert color='red' radius='md' icon={<IconAlertCircle size={18} />} withCloseButton onClose={onClose} py={8}>
      {error}
    </Alert>
  );
}

/* ─────────────────────────── Nueva conversación ─────────────────────────── */

export function NuevaConversacionModal({
  opened,
  proyecto,
  onClose,
  onCreada,
}: {
  opened: boolean;
  proyecto: ProyectoDetalleDto;
  onClose: () => void;
  onCreada: (idConversation: number) => void;
}) {
  const disponibles = proyecto.agents.filter((a) => a.puedoEscribir);
  const [agente, setAgente] = useState<string>('');
  const [titulo, setTitulo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setTitulo('');
    setError(null);
    setAgente(disponibles[0]?.code ?? '');
  }, [opened]);

  const crear = async () => {
    setEnviando(true);
    setError(null);
    const r = await apiSend<{ idConversation: number }>('POST', `/api/proyectos/${proyecto.idProject}/conversaciones`, { agentCode: agente, title: titulo }, 'No se pudo abrir la conversación.');
    setEnviando(false);
    if (r.ok) onCreada(r.data.idConversation);
    else setError(r.error);
  };

  return (
    <Marco
      opened={opened}
      onClose={onClose}
      titulo='Nueva conversación'
      icono={<IconMessagePlus size={20} />}
      testId='proyecto-modal-conversacion'
      pie={
        <>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void crear()} loading={enviando} disabled={!agente}>
            Abrir conversación
          </Button>
        </>
      }
    >
      <ErrorArriba error={error} onClose={() => setError(null)} />
      <Radio.Group value={agente} onChange={setAgente} label='¿Con qué asistente?' description='Cada conversación tiene su propia memoria y usa el plan de su asistente.'>
        <Stack gap={6} mt={6}>
          {proyecto.agents.map((a) => (
            <Radio.Card
              key={a.code}
              value={a.code}
              disabled={!a.puedoEscribir}
              className={css.opcion}
              data-checked={agente === a.code ? 'true' : 'false'}
              data-disabled={!a.puedoEscribir ? 'true' : 'false'}
              radius='md'
            >
              <Group wrap='nowrap' gap='sm'>
                <Radio.Indicator disabled={!a.puedoEscribir} />
                <AgentAvatar code={a.code} displayName={a.displayName} avatarUrl={a.avatarUrl} avatarVersion={a.avatarVersion} size={30} showStatus={false} withTooltip={false} />
                <div style={{ minWidth: 0 }}>
                  <Text size='sm' fw={600}>
                    {a.displayName}
                  </Text>
                  <Text size='xs' c='dimmed' lineClamp={1}>
                    {a.puedoEscribir ? a.handle ?? '' : a.motivo}
                  </Text>
                </div>
              </Group>
            </Radio.Card>
          ))}
        </Stack>
      </Radio.Group>
      <TextInput label='Título (opcional)' placeholder='Ej.: Cotizaciones de octubre' value={titulo} onChange={(e) => setTitulo(e.currentTarget.value)} maxLength={120} />
    </Marco>
  );
}

/* ───────────────────────────── Vincular correo ──────────────────────────── */

export function VincularCorreoModal({
  opened,
  proyecto,
  onClose,
  onVinculado,
}: {
  opened: boolean;
  proyecto: ProyectoDetalleDto;
  onClose: () => void;
  onVinculado: () => void;
}) {
  const [q, setQ] = useState('');
  const [qDeb] = useDebouncedValue(q, 350);
  const [hilos, setHilos] = useState<HiloElegibleDto[] | null>(null);
  const [buzon, setBuzon] = useState<string | null>(null);
  const [elegido, setElegido] = useState<HiloElegibleDto | null>(null);
  const [resumen, setResumen] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortar = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!opened) return;
    setQ('');
    setElegido(null);
    setResumen('');
    setError(null);
  }, [opened]);

  useEffect(() => {
    if (!opened || elegido) return;
    abortar.current?.abort();
    const ac = new AbortController();
    abortar.current = ac;
    setHilos(null);
    void apiGet<{ mailbox: string; threads: HiloElegibleDto[] }>(
      `/api/proyectos/${proyecto.idProject}/vinculos/correos?q=${encodeURIComponent(qDeb.trim())}`,
      'No se pudo leer su buzón.',
      ac.signal
    ).then((r) => {
      if (ac.signal.aborted) return;
      if (r.ok) {
        setHilos(r.data.threads);
        setBuzon(r.data.mailbox);
      } else {
        setHilos([]);
        if (r.error) setError(r.error);
      }
    });
    return () => ac.abort();
  }, [opened, qDeb, proyecto.idProject, elegido]);

  const escoger = (h: HiloElegibleDto) => {
    setElegido(h);
    setResumen((h.extracto ?? '').slice(0, MAX_LINK_SUMMARY_CHARS));
  };

  const vincular = async () => {
    if (!elegido) return;
    setEnviando(true);
    setError(null);
    const r = await apiSend('POST', `/api/proyectos/${proyecto.idProject}/vinculos/correos`, { conversationId: elegido.conversationId, summary: resumen }, 'No se pudo vincular el correo.');
    setEnviando(false);
    if (r.ok) onVinculado();
    else setError(r.error);
  };

  return (
    <Marco
      opened={opened}
      onClose={onClose}
      titulo='Vincular un correo'
      icono={<IconMail size={20} />}
      testId='proyecto-modal-correo'
      pie={
        elegido ? (
          <>
            <Button variant='default' onClick={() => setElegido(null)}>
              Volver
            </Button>
            <Button onClick={() => void vincular()} loading={enviando}>
              Vincular al proyecto
            </Button>
          </>
        ) : (
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
        )
      }
    >
      <ErrorArriba error={error} onClose={() => setError(null)} />
      {elegido ? (
        <Stack gap='sm'>
          <div>
            <Text size='sm' fw={600}>
              {elegido.subject || '(Sin asunto)'}
            </Text>
            <Text size='xs' c='dimmed'>
              {elegido.senderName ?? elegido.senderEmail} · {fechaCorta(elegido.lastMessageAt)}
            </Text>
          </div>
          <Textarea
            label='Resumen que verán los miembros y los asistentes'
            description='Revíselo: es lo único del contenido que se comparte. El cuerpo del correo sigue solo en su buzón.'
            value={resumen}
            onChange={(e) => setResumen(e.currentTarget.value)}
            maxLength={MAX_LINK_SUMMARY_CHARS}
            autosize
            minRows={3}
            maxRows={8}
          />
          <Text size='xs' c='dimmed' ta='right'>
            {resumen.length} / {MAX_LINK_SUMMARY_CHARS}
          </Text>
        </Stack>
      ) : (
        <Stack gap='sm'>
          <Text size='xs' c='dimmed'>
            Solo aparecen hilos de su propio buzón{buzon ? ` (${buzon})` : ''}.
          </Text>
          <TextInput
            placeholder='Buscar por asunto o remitente'
            leftSection={<IconSearch size={16} />}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            radius='xl'
            aria-label='Buscar correos'
          />
          {hilos === null ? (
            <EsqueletoFilas n={5} />
          ) : hilos.length === 0 ? (
            <Text size='sm' c='dimmed' ta='center' py='md'>
              No se encontraron correos.
            </Text>
          ) : (
            <Stack gap={4}>
              {hilos.map((h) => (
                <UnstyledButton
                  key={h.conversationId}
                  className={`${css.fila} ${css.filaBoton}`}
                  onClick={() => escoger(h)}
                  disabled={h.yaVinculado}
                  style={h.yaVinculado ? { opacity: 0.55, cursor: 'default' } : undefined}
                  data-testid='proyecto-hilo-elegible'
                >
                  <IconMail size={20} style={{ flexShrink: 0 }} color='var(--mantine-color-dimmed)' />
                  <div className={css.item} style={{ flex: 1 }}>
                    <Group justify='space-between' wrap='nowrap' gap={6}>
                      <Text size='sm' fw={600} className={css.truncar}>
                        {h.subject || '(Sin asunto)'}
                      </Text>
                      <Text size='xs' c='dimmed' style={{ flexShrink: 0 }}>
                        {h.yaVinculado ? 'Ya vinculado' : fechaCorta(h.lastMessageAt)}
                      </Text>
                    </Group>
                    <Text size='xs' c='dimmed' className={css.truncar}>
                      {h.senderName ?? h.senderEmail}
                      {h.extracto ? ` — ${h.extracto}` : ''}
                    </Text>
                  </div>
                </UnstyledButton>
              ))}
            </Stack>
          )}
        </Stack>
      )}
    </Marco>
  );
}

/* ──────────────────────────── Vincular solicitud ────────────────────────── */

export function VincularSolicitudModal({
  opened,
  proyecto,
  onClose,
  onVinculado,
}: {
  opened: boolean;
  proyecto: ProyectoDetalleDto;
  onClose: () => void;
  onVinculado: () => void;
}) {
  const [q, setQ] = useState('');
  const [qDeb] = useDebouncedValue(q, 350);
  const [lista, setLista] = useState<SolicitudElegibleDto[] | null>(null);
  const [enviando, setEnviando] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opened) {
      setQ('');
      setError(null);
    }
  }, [opened]);

  useEffect(() => {
    if (!opened) return;
    const ac = new AbortController();
    setLista(null);
    void apiGet<{ requests: SolicitudElegibleDto[] }>(
      `/api/proyectos/${proyecto.idProject}/vinculos/solicitudes?q=${encodeURIComponent(qDeb.trim())}`,
      'No se pudieron buscar las solicitudes.',
      ac.signal
    ).then((r) => {
      if (ac.signal.aborted) return;
      setLista(r.ok ? r.data.requests : []);
      if (!r.ok && r.error) setError(r.error);
    });
    return () => ac.abort();
  }, [opened, qDeb, proyecto.idProject]);

  const vincular = async (idRequest: number) => {
    setEnviando(idRequest);
    setError(null);
    const r = await apiSend('POST', `/api/proyectos/${proyecto.idProject}/vinculos/solicitudes`, { idRequest }, 'No se pudo vincular la solicitud.');
    setEnviando(null);
    if (r.ok) onVinculado();
    else setError(r.error);
  };

  return (
    <Marco
      opened={opened}
      onClose={onClose}
      titulo='Vincular una solicitud'
      icono={<IconTicket size={20} />}
      testId='proyecto-modal-solicitud'
      pie={
        <Button variant='default' onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      <ErrorArriba error={error} onClose={() => setError(null)} />
      <Text size='xs' c='dimmed'>
        Casos de {proyecto.company.companyName} en los que usted participa (solicitante, responsable o con una tarea).
      </Text>
      <TextInput
        placeholder='Número o asunto de la solicitud'
        leftSection={<IconSearch size={16} />}
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
        radius='xl'
        aria-label='Buscar solicitudes'
      />
      {lista === null ? (
        <EsqueletoFilas n={5} />
      ) : lista.length === 0 ? (
        <Text size='sm' c='dimmed' ta='center' py='md'>
          No se encontraron solicitudes.
        </Text>
      ) : (
        <Stack gap={4}>
          {lista.map((s) => (
            <Group key={s.idRequest} wrap='nowrap' gap='sm' className={css.fila} style={{ border: '1px solid var(--mantine-color-default-border)' }}>
              <div className={css.item} style={{ flex: 1 }}>
                <Group gap={6} wrap='nowrap'>
                  <Text size='sm' fw={700} style={{ flexShrink: 0 }}>
                    #{s.idRequest}
                  </Text>
                  <Text size='sm' className={css.truncar}>
                    {s.subject}
                  </Text>
                </Group>
                <Text size='xs' c='dimmed' className={css.truncar}>
                  {[s.estado, s.processName, fechaCorta(s.createdAt)].filter(Boolean).join(' · ')}
                </Text>
              </div>
              <Button size='xs' variant='light' disabled={s.yaVinculada} loading={enviando === s.idRequest} onClick={() => void vincular(s.idRequest)}>
                {s.yaVinculada ? 'Vinculada' : 'Vincular'}
              </Button>
            </Group>
          ))}
        </Stack>
      )}
    </Marco>
  );
}

/* ──────────────────────────────── Invitar ──────────────────────────────── */

export function InvitarModal({
  opened,
  proyecto,
  onClose,
  onInvitados,
}: {
  opened: boolean;
  proyecto: ProyectoDetalleDto;
  onClose: () => void;
  onInvitados: (n: number) => void;
}) {
  const [candidatos, setCandidatos] = useState<CandidatoDto[] | null>(null);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [rol, setRol] = useState<'editor' | 'reader'>('editor');
  const [q, setQ] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setElegidos([]);
    setQ('');
    setRol('editor');
    setError(null);
    setCandidatos(null);
    void apiGet<{ users: CandidatoDto[] }>(`/api/proyectos/${proyecto.idProject}/miembros?candidatos=1`, 'No se pudo cargar la lista de personas.').then((r) => {
      setCandidatos(r.ok ? r.data.users : []);
      if (!r.ok) setError(r.error);
    });
  }, [opened, proyecto.idProject]);

  const filtrados = (candidatos ?? []).filter((u) => {
    const t = q.trim().toLowerCase();
    return !t || u.name.toLowerCase().includes(t) || u.email.toLowerCase().includes(t);
  });

  const invitar = async () => {
    setEnviando(true);
    setError(null);
    const r = await apiSend('POST', `/api/proyectos/${proyecto.idProject}/miembros`, { idUsers: elegidos, role: rol }, 'No se pudo invitar.');
    setEnviando(false);
    if (r.ok) onInvitados(elegidos.length);
    else setError(r.error);
  };

  return (
    <Marco
      opened={opened}
      onClose={onClose}
      titulo='Invitar al proyecto'
      icono={<IconUserPlus size={20} />}
      testId='proyecto-modal-invitar'
      pie={
        <>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void invitar()} loading={enviando} disabled={elegidos.length === 0}>
            Invitar{elegidos.length > 0 ? ` (${elegidos.length})` : ''}
          </Button>
        </>
      }
    >
      <ErrorArriba error={error} onClose={() => setError(null)} />
      <Text size='xs' c='dimmed'>
        Solo aparecen quienes tienen el permiso «Proyectos» en {proyecto.company.companyName}. Verán todo lo trabajado en el proyecto.
      </Text>
      <Stack gap={4}>
        <Text size='sm' fw={500}>
          Rol
        </Text>
        <SegmentedControl
          value={rol}
          onChange={(v) => setRol(v as 'editor' | 'reader')}
          data={[
            { value: 'editor', label: 'Editor' },
            { value: 'reader', label: 'Lector' },
          ]}
          fullWidth
        />
        <Text size='xs' c='dimmed'>
          {rol === 'editor' ? 'Conversa con los asistentes, vincula correos y solicitudes y carga archivos.' : 'Solo consulta: no escribe ni vincula.'}
        </Text>
      </Stack>
      <TextInput placeholder='Buscar por nombre o correo' leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} radius='xl' aria-label='Buscar personas' />
      {candidatos === null ? (
        <EsqueletoFilas n={4} />
      ) : filtrados.length === 0 ? (
        <Text size='sm' c='dimmed' ta='center' py='md'>
          No hay más personas que se puedan invitar.
        </Text>
      ) : (
        <Checkbox.Group value={elegidos} onChange={setElegidos}>
          <Stack gap={4}>
            {filtrados.map((u) => (
              <Checkbox.Card key={u.id} value={u.id} className={css.opcion} data-checked={elegidos.includes(u.id) ? 'true' : 'false'} radius='md'>
                <Group wrap='nowrap' gap='sm'>
                  <Checkbox.Indicator />
                  <div style={{ minWidth: 0 }}>
                    <Text size='sm' className={css.truncar}>
                      {u.name}
                    </Text>
                    <Text size='xs' c='dimmed' className={css.truncar}>
                      {u.email}
                    </Text>
                  </div>
                </Group>
              </Checkbox.Card>
            ))}
          </Stack>
        </Checkbox.Group>
      )}
    </Marco>
  );
}

/* ──────────────────────────── Designar asistente ────────────────────────── */

export function DesignarAgenteModal({
  opened,
  proyecto,
  onClose,
  onDesignados,
}: {
  opened: boolean;
  proyecto: ProyectoDetalleDto;
  onClose: () => void;
  onDesignados: () => void;
}) {
  const [candidatos, setCandidatos] = useState<AgenteDesignableDto[] | null>(null);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setElegidos([]);
    setError(null);
    setCandidatos(null);
    void apiGet<{ agents: AgenteDesignableDto[] }>(`/api/proyectos/${proyecto.idProject}/agentes`, 'No se pudo cargar la lista de asistentes.').then((r) => {
      setCandidatos(r.ok ? r.data.agents : []);
      if (!r.ok) setError(r.error);
    });
  }, [opened, proyecto.idProject]);

  const designar = async () => {
    setEnviando(true);
    setError(null);
    const r = await apiSend('POST', `/api/proyectos/${proyecto.idProject}/agentes`, { agentCodes: elegidos }, 'No se pudo agregar el asistente.');
    setEnviando(false);
    if (r.ok) onDesignados();
    else setError(r.error);
  };

  return (
    <Marco
      opened={opened}
      onClose={onClose}
      titulo='Agregar asistentes'
      icono={<IconRobot size={20} />}
      testId='proyecto-modal-agentes'
      pie={
        <>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void designar()} loading={enviando} disabled={elegidos.length === 0}>
            Agregar
          </Button>
        </>
      }
    >
      <ErrorArriba error={error} onClose={() => setError(null)} />
      <Text size='xs' c='dimmed'>
        Asistentes que usted tiene en {proyecto.company.companyName}, con proyectos habilitados y con el perfil «{proyecto.profile.label}».
      </Text>
      {candidatos === null ? (
        <EsqueletoFilas n={3} />
      ) : candidatos.length === 0 ? (
        <Text size='sm' c='dimmed' ta='center' py='md'>
          No hay más asistentes que se puedan agregar.
        </Text>
      ) : (
        <Checkbox.Group value={elegidos} onChange={setElegidos}>
          <Stack gap={4}>
            {candidatos.map((a) => (
              <Checkbox.Card key={a.code} value={a.code} className={css.opcion} data-checked={elegidos.includes(a.code) ? 'true' : 'false'} radius='md'>
                <Group wrap='nowrap' gap='sm'>
                  <Checkbox.Indicator />
                  <AgentAvatar code={a.code} displayName={a.displayName} avatarUrl={a.avatarUrl} avatarVersion={a.avatarVersion} size={30} showStatus={false} withTooltip={false} />
                  <Text size='sm' fw={600}>
                    {a.displayName}
                  </Text>
                </Group>
              </Checkbox.Card>
            ))}
          </Stack>
        </Checkbox.Group>
      )}
    </Marco>
  );
}

/* ─────────────────────────────── Confirmar ─────────────────────────────── */

export function ConfirmarModal({
  opened,
  titulo,
  texto,
  accion,
  color = 'red',
  cargando,
  onClose,
  onConfirmar,
}: {
  opened: boolean;
  titulo: string;
  texto: string;
  accion: string;
  color?: string;
  cargando: boolean;
  onClose: () => void;
  onConfirmar: () => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title={<Text fw={700}>{titulo}</Text>} centered radius='md' classNames={{ content: css.modalTactil }}>
      <Stack gap='md'>
        <Text size='sm'>{texto}</Text>
        <Group justify='flex-end' gap='sm'>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button color={color} onClick={onConfirmar} loading={cargando}>
            {accion}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
