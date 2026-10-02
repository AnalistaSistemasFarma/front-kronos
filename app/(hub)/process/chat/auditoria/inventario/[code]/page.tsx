'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowLeft,
  IconCircleCheck,
  IconFileTypePdf,
  IconId,
  IconLock,
  IconPencil,
} from '@tabler/icons-react';

/**
 * AUDITORÍA DE AGENTES → INVENTARIO → HOJA DE VIDA (F2) — la ficha de un agente.
 *
 * Propósito y dueño, quién lo usa, qué tiene (inventario de F1), sus reglas
 * vigentes, métricas, historial, hallazgos y el resumen semanal. Se actualiza
 * sola: métricas cada noche y resumen cada semana (redactado con IA solo con
 * datos estructurados, nunca con el texto de las conversaciones).
 *
 * El diseño copia a propósito el de la pestaña Inventario (mismo encabezado,
 * mismas tarjetas, mismos avisos arriba y con color): es una página interna
 * del mismo módulo, a la que se llega desde la tarjeta del agente.
 *
 * LA REJA ESTÁ EN LOS ENDPOINTS (/api/chat/auditoria/hoja-de-vida/...).
 */

type Usuario = {
  id: string;
  nombre: string;
  email: string;
  activo: boolean;
  empresas: string[];
  asignado: boolean;
  mensajes: number;
  mensajes30: number;
  ultimoMensaje: string | null;
};
type Hallazgo = {
  id: number;
  severity: string;
  title: string;
  detail: string | null;
  firstSeenAt: string;
  resolvedAt: string | null;
};
type Totales = {
  mensajesRecibidos: number;
  mensajesEnviados: number;
  conversaciones: number;
  turnos: number;
  tokensTotal: number;
  tokensEntrada: number;
  tokensSalida: number;
  tokensCacheCreacion: number;
  tokensCacheLectura: number;
  diasActivos: number;
  usuariosActivos: number;
};
type Ficha = {
  puedeConfigurar: boolean;
  agente: {
    code: string;
    displayName: string;
    handle: string | null;
    description: string | null;
    activo: boolean;
    creadoEl: string;
    permiso: string | null;
    empresas: { nombre: string; principal: boolean }[];
  };
  perfil: {
    purpose: string | null;
    ownerName: string | null;
    ownerEmail: string | null;
    updatedBy: string | null;
    updatedAt: string;
  } | null;
  usuarios: Usuario[];
  inventario: {
    scannedAt: string;
    kind: string;
    host: string;
    location: string | null;
    model: string | null;
    serviceStatus: string | null;
    execMode: string | null;
    execRequiresApproval: boolean | null;
    tools: { allow: string[]; deny: string[] };
    skills: string[];
    channels: { type: string; policy: string; allowed: number | null; detail: string | null }[];
    scanError: string | null;
    mcps: {
      name: string;
      target: string | null;
      transport: string;
      company: string | null;
      access: string;
      auth: string;
      writeTools: string | null;
    }[];
  } | null;
  metricas: {
    calculadoEl: string | null;
    ultimos30: Totales;
    historico: Totales & { primerDia: string | null };
    dias: { dia: string; recibidos: number; enviados: number; tokens: number; usuarios: number }[];
  };
  historial: {
    id: number;
    occurredAt: string;
    kind: string;
    title: string;
    detail: string | null;
    createdBy: string | null;
  }[];
  hallazgos: { abiertos: Hallazgo[]; cerrados: Hallazgo[] };
  resumenes: { semana: string; texto: string; modelo: string | null; generadoEl: string }[];
};
type Aviso = { color: 'green' | 'yellow' | 'red'; titulo: string; texto: string };

const COLOR_SEVERIDAD: Record<string, string> = {
  critico: 'red',
  alto: 'orange',
  medio: 'yellow',
  bajo: 'gray',
};
const NOMBRE_SEVERIDAD: Record<string, string> = {
  critico: 'Crítico',
  alto: 'Alto',
  medio: 'Medio',
  bajo: 'Bajo',
};
const NOMBRE_TIPO: Record<string, string> = { 'claude-code': 'Claude Code', openclaw: 'OpenClaw' };
const NOMBRE_SERVICIO: Record<string, string> = {
  activo: 'en ejecución',
  detenido: 'detenido',
  'sin-servicio': 'sin servicio',
  desconocido: 'estado desconocido',
};
const NOMBRE_POLITICA: Record<string, string> = {
  'lista-blanca': 'lista blanca',
  emparejamiento: 'emparejamiento',
  abierta: 'abierto',
  desconocida: 'política desconocida',
};
const NOMBRE_ENTRADA: Record<string, { label: string; color: string }> = {
  alta: { label: 'Alta', color: 'indigo' },
  inventario: { label: 'Inventario', color: 'teal' },
  hallazgo_abierto: { label: 'Hallazgo', color: 'orange' },
  hallazgo_cerrado: { label: 'Hallazgo cerrado', color: 'green' },
  perfil: { label: 'Hoja de vida', color: 'blue' },
};

const fmt = new Intl.NumberFormat('es-CO');
const num = (v: number) => fmt.format(Math.round(v));

/** Un 'YYYY-MM-DD' es un día de Colombia: se lee a mediodía para que no retroceda. */
function aFecha(v: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00.000Z`) : new Date(v);
}
function fecha(iso: string | null): string {
  if (!iso) return '—';
  return aFecha(iso).toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function fechaLarga(iso: string): string {
  return aFecha(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function Dato({ k, v, nota, fuerte }: { k: string; v: string; nota?: string; fuerte?: boolean }) {
  return (
    <div>
      <Text size='xs' c='dimmed'>
        {k}
      </Text>
      <Text fw={fuerte ? 700 : undefined}>{v}</Text>
      {nota && (
        <Text size='xs' c='dimmed'>
          {nota}
        </Text>
      )}
    </div>
  );
}

function Grafica({ dias }: { dias: Ficha['metricas']['dias'] }) {
  const max = Math.max(1, ...dias.map((d) => d.recibidos + d.enviados));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90 }}>
        {dias.map((d) => (
          <Tooltip
            key={d.dia}
            label={`${fecha(d.dia)}: ${num(d.recibidos)} recibidos, ${num(d.enviados)} enviados, ${num(d.usuarios)} usuarios, ${num(d.tokens)} tokens`}
            withArrow
          >
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', height: '100%' }}>
              <div
                style={{
                  height: `${(d.recibidos / max) * 100}%`,
                  background: 'var(--mantine-color-blue-8)',
                  borderRadius: 2,
                }}
              />
              <div
                style={{
                  height: `${(d.enviados / max) * 100}%`,
                  background: 'var(--mantine-color-blue-3)',
                  borderRadius: 2,
                }}
              />
            </div>
          </Tooltip>
        ))}
      </div>
      <Group justify='space-between' mt={4}>
        <Text size='xs' c='dimmed'>
          {fecha(dias[0]?.dia ?? null)}
        </Text>
        <Group gap='xs'>
          <Badge size='xs' variant='filled' color='blue.8'>
            Recibidos
          </Badge>
          <Badge size='xs' variant='filled' color='blue.3'>
            Enviados
          </Badge>
        </Group>
        <Text size='xs' c='dimmed'>
          {fecha(dias[dias.length - 1]?.dia ?? null)}
        </Text>
      </Group>
    </div>
  );
}

function TablaUsuarios({ lista }: { lista: Usuario[] }) {
  return (
    <Table.ScrollContainer minWidth={520}>
      <Table striped highlightOnHover verticalSpacing={4} fz='xs'>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Persona</Table.Th>
            <Table.Th>Empresas</Table.Th>
            <Table.Th ta='right'>Mensajes (30 días)</Table.Th>
            <Table.Th ta='right'>Mensajes (total)</Table.Th>
            <Table.Th>Último mensaje</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {lista.map((u) => (
            <Table.Tr key={u.id}>
              <Table.Td>
                <Text size='xs' fw={600}>
                  {u.nombre}
                </Text>
                <Text size='xs' c='dimmed'>
                  {u.email}
                  {u.activo ? '' : ' · usuario inactivo'}
                </Text>
              </Table.Td>
              <Table.Td>{u.empresas.join(', ') || '—'}</Table.Td>
              <Table.Td ta='right'>{num(u.mensajes30)}</Table.Td>
              <Table.Td ta='right'>{num(u.mensajes)}</Table.Td>
              <Table.Td>{fecha(u.ultimoMensaje)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function ListaHallazgos({ lista, cerrados }: { lista: Hallazgo[]; cerrados?: boolean }) {
  if (lista.length === 0) {
    return (
      <Text size='xs' c='dimmed'>
        {cerrados ? 'Ninguno cerrado todavía.' : 'Sin hallazgos abiertos.'}
      </Text>
    );
  }
  return (
    <Stack gap={4}>
      {lista.map((h) => (
        <Group key={h.id} gap={6} wrap='nowrap' align='flex-start'>
          <Badge
            size='xs'
            variant={cerrados ? 'light' : 'filled'}
            color={COLOR_SEVERIDAD[h.severity] ?? 'gray'}
          >
            {NOMBRE_SEVERIDAD[h.severity] ?? h.severity}
          </Badge>
          <Tooltip label={h.detail ?? h.title} withArrow multiline w={360}>
            <Text size='xs'>{h.title}</Text>
          </Tooltip>
          <Text size='xs' c='dimmed' style={{ whiteSpace: 'nowrap', marginLeft: 'auto' }}>
            {cerrados ? `cerrado ${fecha(h.resolvedAt)}` : `desde ${fecha(h.firstSeenAt)}`}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

export default function HojaDeVidaAgentePage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(String(params?.code ?? ''));

  const [datos, setDatos] = useState<Ficha | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);
  const [noExiste, setNoExiste] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  const [form, setForm] = useState({ purpose: '', ownerName: '', ownerEmail: '' });
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/auditoria/hoja-de-vida/${encodeURIComponent(code)}`, {
        cache: 'no-store',
      });
      if (res.status === 403) {
        setSinPermiso(true);
        return;
      }
      if (res.status === 404) {
        setNoExiste(true);
        return;
      }
      if (!res.ok) {
        setError('No se pudo consultar la hoja de vida del agente.');
        return;
      }
      setError(null);
      setDatos(await res.json());
    } catch {
      setError('No se pudo consultar la hoja de vida del agente.');
    }
  }, [code]);

  useEffect(() => {
    if (code) void cargar();
  }, [code, cargar]);

  const abrirEdicion = () => {
    setForm({
      purpose: datos?.perfil?.purpose ?? '',
      ownerName: datos?.perfil?.ownerName ?? '',
      ownerEmail: datos?.perfil?.ownerEmail ?? '',
    });
    setErrorEdicion(null);
    setEditando(true);
  };

  const guardar = async () => {
    setGuardando(true);
    setErrorEdicion(null);
    try {
      const res = await fetch(`/api/chat/auditoria/hoja-de-vida/${encodeURIComponent(code)}/perfil`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // El error se muestra arriba del formulario, que sigue abierto.
        setErrorEdicion(body?.error ?? `El servidor respondió ${res.status}. Intente de nuevo.`);
        return;
      }
      setEditando(false);
      setAviso(
        body.cambios?.length
          ? {
              color: 'green',
              titulo: 'Hoja de vida actualizada',
              texto: `${body.cambios.join(' ')} El cambio quedó en el historial.`,
            }
          : {
              color: 'yellow',
              titulo: 'Sin cambios',
              texto: 'Los datos ya estaban así; no se registró nada nuevo.',
            }
      );
      // Refrescar NO desmonta la vista: el aviso de arriba se mantiene.
      await cargar();
    } catch {
      setErrorEdicion('No hubo respuesta del servidor. Revise su conexión e intente de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  const descargarPdf = async () => {
    setGenerandoPdf(true);
    try {
      const res = await fetch(`/api/chat/auditoria/hoja-de-vida/${encodeURIComponent(code)}/pdf`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setAviso({
          color: 'red',
          titulo: 'No se pudo generar el PDF',
          texto: body?.error ?? `El servidor respondió ${res.status}. Intente de nuevo en unos minutos.`,
        });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
        `hoja-de-vida-${code}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setAviso({
        color: 'green',
        titulo: 'PDF generado',
        texto: 'La hoja de vida se descargó con la marca GSS, lista para entregar a Gobierno de IA.',
      });
    } catch {
      setAviso({
        color: 'red',
        titulo: 'No se pudo generar el PDF',
        texto: 'No hubo respuesta del servidor. Revise su conexión e intente de nuevo.',
      });
    } finally {
      setGenerandoPdf(false);
    }
  };

  if (sinPermiso || noExiste) {
    return (
      <div className='app-page-shell app-page-shell--fill min-h-screen'>
        <div className='max-w-3xl mx-auto py-10 px-4'>
          <Alert
            icon={<IconLock size={18} />}
            color='yellow'
            radius='lg'
            title={sinPermiso ? 'Sin acceso' : 'Agente no encontrado'}
          >
            {sinPermiso
              ? 'La auditoría de agentes está reservada a la administración.'
              : 'No existe un agente registrado con ese código.'}
          </Alert>
        </div>
      </div>
    );
  }

  const a = datos?.agente;
  const inv = datos?.inventario ?? null;
  const m30 = datos?.metricas.ultimos30;
  const mh = datos?.metricas.historico;
  const asignados = datos?.usuarios.filter((u) => u.asignado) ?? [];
  const noAsignados = datos?.usuarios.filter((u) => !u.asignado) ?? [];
  const resumen = datos?.resumenes[0] ?? null;
  const historial = datos?.historial ?? [];
  const historialVisible = verHistorial ? historial : historial.slice(0, 15);

  return (
    <div className='app-page-shell app-page-shell--fill ios-process-hub min-h-screen'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Group gap='xs' mb={4}>
          <Link
            href='/process/chat/auditoria/inventario'
            className='chat-text-muted'
            style={{ fontSize: 13 }}
          >
            <Group gap={4} wrap='nowrap'>
              <IconArrowLeft size={14} />
              <span>Volver al inventario de agentes</span>
            </Group>
          </Link>
        </Group>

        <Group gap='sm' mb={2} wrap='nowrap'>
          <IconId size={26} className='chat-folder__icon' />
          <Title order={1} className='ios-process-hub__title text-3xl'>
            Hoja de vida{a ? ` de ${a.displayName}` : ''}
          </Title>
        </Group>
        <Text className='ios-process-hub__subtitle' mb='lg'>
          Propósito, dueño, usuarios, herramientas, reglas, métricas, historial y hallazgos del
          agente. Las métricas se actualizan cada noche y el resumen cada semana, redactado con IA
          solo a partir de cifras e inventario: nunca se lee el texto de las conversaciones.
          {datos?.metricas.calculadoEl &&
            ` Métricas calculadas: ${fechaHora(datos.metricas.calculadoEl)}`}
        </Text>

        {aviso && (
          <Alert
            color={aviso.color}
            radius='md'
            mb='md'
            title={aviso.titulo}
            withCloseButton
            onClose={() => setAviso(null)}
            icon={
              aviso.color === 'green' ? (
                <IconCircleCheck size={18} />
              ) : aviso.color === 'yellow' ? (
                <IconAlertTriangle size={18} />
              ) : (
                <IconAlertCircle size={18} />
              )
            }
          >
            {aviso.texto}
          </Alert>
        )}

        {error && (
          <Alert color='red' radius='md' icon={<IconAlertCircle size={18} />} mb='md'>
            {error}
          </Alert>
        )}

        {!datos && !error && (
          <Center py='xl'>
            <Loader size='sm' />
          </Center>
        )}

        {datos && a && m30 && mh && (
          <>
            <Card withBorder radius='md' padding='md' mb='md' className='chat-surface'>
              <Group justify='space-between' align='flex-start' wrap='wrap' gap='sm'>
                <div style={{ minWidth: 0 }}>
                  <Group gap={6} wrap='wrap'>
                    <Text fw={700}>{a.displayName}</Text>
                    {inv && (
                      <Badge size='xs' variant='light' color='indigo'>
                        {NOMBRE_TIPO[inv.kind] ?? inv.kind}
                      </Badge>
                    )}
                    <Badge size='xs' variant='light' color={a.activo ? 'green' : 'gray'}>
                      {a.activo ? 'activo' : 'inactivo'}
                    </Badge>
                    {datos.hallazgos.abiertos.length > 0 && (
                      <Badge
                        size='xs'
                        variant='filled'
                        color={
                          COLOR_SEVERIDAD[
                            ['critico', 'alto', 'medio', 'bajo'].find((s) =>
                              datos.hallazgos.abiertos.some((h) => h.severity === s)
                            ) ?? 'bajo'
                          ]
                        }
                      >
                        {datos.hallazgos.abiertos.length}{' '}
                        {datos.hallazgos.abiertos.length === 1 ? 'hallazgo' : 'hallazgos'}
                      </Badge>
                    )}
                  </Group>
                  <Text
                    size='xs'
                    c='dimmed'
                    style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}
                  >
                    {a.code}
                    {a.handle ? ` · ${a.handle}` : ''}
                  </Text>
                </div>
                <Group gap='xs'>
                  {datos.puedeConfigurar && (
                    <Button
                      size='xs'
                      variant='light'
                      leftSection={<IconPencil size={14} />}
                      onClick={abrirEdicion}
                    >
                      Editar propósito y dueño
                    </Button>
                  )}
                  <Button
                    size='xs'
                    leftSection={<IconFileTypePdf size={14} />}
                    loading={generandoPdf}
                    onClick={() => void descargarPdf()}
                  >
                    Exportar PDF
                  </Button>
                </Group>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing='sm' mt='sm'>
                <Dato k='Empresas' v={a.empresas.map((e) => e.nombre).join(', ') || '—'} />
                <Dato k='Permiso para usarlo' v={a.permiso ?? 'Sin subproceso asignado'} />
                <Dato k='En SynerLink desde' v={fechaLarga(a.creadoEl)} />
                <Dato
                  k='Equipo'
                  v={inv ? `${inv.host}${inv.model ? ` · ${inv.model}` : ''}` : 'Sin escanear'}
                  nota={
                    inv
                      ? `${NOMBRE_SERVICIO[inv.serviceStatus ?? 'desconocido'] ?? inv.serviceStatus} · escaneado el ${fechaHora(inv.scannedAt)}`
                      : undefined
                  }
                />
              </SimpleGrid>
            </Card>

            <SimpleGrid cols={{ base: 1, md: 2 }} spacing='sm' mb='md'>
              <Card withBorder radius='md' padding='md' className='chat-surface'>
                <Text fw={600} size='sm' mb={6}>
                  Propósito y dueño
                </Text>
                {datos.perfil?.purpose ? (
                  <Text size='sm' style={{ whiteSpace: 'pre-line' }}>
                    {datos.perfil.purpose}
                  </Text>
                ) : (
                  <Text size='sm' c='dimmed'>
                    Sin propósito registrado.
                    {a.description ? ` Descripción del catálogo: ${a.description}` : ''}
                  </Text>
                )}
                <Text size='sm' mt={8}>
                  <Text span fw={600}>
                    Dueño:{' '}
                  </Text>
                  {datos.perfil?.ownerName || datos.perfil?.ownerEmail ? (
                    `${datos.perfil?.ownerName ?? ''}${datos.perfil?.ownerEmail ? ` · ${datos.perfil.ownerEmail}` : ''}`
                  ) : (
                    <Text span c='dimmed'>
                      sin dueño registrado.
                    </Text>
                  )}
                </Text>
                {datos.perfil?.updatedAt && (
                  <Text size='xs' c='dimmed' mt={6}>
                    Actualizado el {fechaHora(datos.perfil.updatedAt)}
                    {datos.perfil.updatedBy ? ` por ${datos.perfil.updatedBy}` : ''}
                  </Text>
                )}
                {!datos.puedeConfigurar && (
                  <Text size='xs' c='dimmed' mt={6}>
                    Para editarlos se necesita el permiso «Auditoría de agentes · Configurar».
                  </Text>
                )}
              </Card>

              <Card withBorder radius='md' padding='md' className='chat-surface'>
                <Text fw={600} size='sm' mb={6}>
                  Resumen de la semana
                </Text>
                {resumen ? (
                  <>
                    <Text size='sm' style={{ whiteSpace: 'pre-line' }}>
                      {resumen.texto}
                    </Text>
                    <Text size='xs' c='dimmed' mt={6}>
                      Semana del {fechaLarga(resumen.semana)} · redactado con IA solo a partir de
                      cifras, inventario y hallazgos.
                    </Text>
                  </>
                ) : (
                  <Text size='sm' c='dimmed'>
                    Todavía no hay resumen semanal. Se genera cada lunes con los datos de la semana
                    anterior.
                  </Text>
                )}
              </Card>
            </SimpleGrid>

            <Card withBorder radius='md' padding='md' mb='md' className='chat-surface'>
              <Text fw={600} size='sm' mb={6}>
                Métricas
              </Text>
              <Group gap='xl' wrap='wrap' mb='sm'>
                <Dato k='Mensajes recibidos (30 días)' v={num(m30.mensajesRecibidos)} fuerte />
                <Dato k='Mensajes enviados (30 días)' v={num(m30.mensajesEnviados)} fuerte />
                <Dato k='Usuarios activos (30 días)' v={num(m30.usuariosActivos)} fuerte />
                <Dato k='Días activos (30 días)' v={num(m30.diasActivos)} />
                <Dato
                  k='Consumo en tokens (30 días)'
                  v={num(m30.tokensTotal)}
                  nota={`${num(m30.turnos)} turnos reportados`}
                />
                <Dato
                  k='Mensajes históricos'
                  v={num(mh.mensajesRecibidos + mh.mensajesEnviados)}
                  nota={mh.primerDia ? `desde ${fecha(mh.primerDia)}` : undefined}
                />
                <Dato k='Usuarios históricos' v={num(mh.usuariosActivos)} />
                <Dato k='Días activos históricos' v={num(mh.diasActivos)} />
              </Group>
              <Grafica dias={datos.metricas.dias} />
              <Text size='xs' c='dimmed' mt={8}>
                Mensajes por día en los últimos 30 días. El consumo lo declara cada agente y se cuenta
                una sola vez por turno, aunque el turno haya atendido varias conversaciones.
              </Text>
            </Card>

            <Card withBorder radius='md' padding='md' mb='md' className='chat-surface'>
              <Text fw={600} size='sm' mb={6}>
                Usuarios asignados ({asignados.length})
              </Text>
              {asignados.length === 0 ? (
                <Text size='xs' c='dimmed'>
                  Nadie tiene asignado este agente.
                </Text>
              ) : (
                <TablaUsuarios lista={asignados} />
              )}
              {noAsignados.length > 0 && (
                <>
                  <Text size='xs' fw={600} mt='sm' mb={2}>
                    Le han escrito sin tenerlo asignado hoy ({noAsignados.length})
                  </Text>
                  <Text size='xs' c='dimmed' mb={4}>
                    Por ejemplo en un grupo, o antes de que se les retirara el permiso.
                  </Text>
                  <TablaUsuarios lista={noAsignados} />
                </>
              )}
            </Card>

            <SimpleGrid cols={{ base: 1, md: 2 }} spacing='sm' mb='md'>
              <Card withBorder radius='md' padding='md' className='chat-surface'>
                <Text fw={600} size='sm' mb={6}>
                  Herramientas, MCP y skills
                </Text>
                {!inv && (
                  <Text size='xs' c='dimmed'>
                    Todavía no se ha escaneado este agente.
                  </Text>
                )}
                {inv && (
                  <Stack gap={8}>
                    {inv.scanError && (
                      <Alert color='yellow' radius='md' p='xs' icon={<IconAlertTriangle size={14} />}>
                        <Text size='xs'>{inv.scanError}</Text>
                      </Alert>
                    )}
                    <div>
                      <Text size='xs' fw={600} mb={2}>
                        MCP ({inv.mcps.length})
                      </Text>
                      {inv.mcps.length === 0 && (
                        <Text size='xs' c='dimmed'>
                          Ninguno configurado.
                        </Text>
                      )}
                      <Stack gap={4}>
                        {inv.mcps.map((m) => (
                          <Group key={m.name} gap={4} wrap='wrap'>
                            <Tooltip label={m.target ?? m.transport} withArrow multiline w={320}>
                              <Text
                                size='xs'
                                style={{
                                  fontFamily: 'var(--mantine-font-family-monospace)',
                                  wordBreak: 'break-word',
                                }}
                              >
                                {m.name}
                              </Text>
                            </Tooltip>
                            {m.company && (
                              <Badge size='xs' variant='outline' color='gray'>
                                {m.company}
                              </Badge>
                            )}
                            <Tooltip
                              label={
                                m.writeTools
                                  ? `Escritura: ${m.writeTools}`
                                  : 'Sin herramientas de escritura detectadas'
                              }
                              withArrow
                              multiline
                              w={320}
                            >
                              <Badge
                                size='xs'
                                variant='light'
                                color={
                                  m.access === 'escritura'
                                    ? 'orange'
                                    : m.access === 'lectura'
                                      ? 'teal'
                                      : 'gray'
                                }
                              >
                                {m.access}
                              </Badge>
                            </Tooltip>
                            <Badge
                              size='xs'
                              variant='light'
                              color={
                                m.auth === 'ninguna' ? 'red' : m.auth === 'requerida' ? 'green' : 'gray'
                              }
                            >
                              {m.auth === 'ninguna'
                                ? 'sin autenticación'
                                : m.auth === 'requerida'
                                  ? 'con autenticación'
                                  : m.auth === 'local'
                                    ? 'local (stdio)'
                                    : 'autenticación desconocida'}
                            </Badge>
                          </Group>
                        ))}
                      </Stack>
                    </div>
                    <div>
                      <Text size='xs' fw={600} mb={2}>
                        Skills ({inv.skills.length})
                      </Text>
                      <Group gap={4} wrap='wrap'>
                        {inv.skills.length === 0 && (
                          <Text size='xs' c='dimmed'>
                            Ninguno instalado.
                          </Text>
                        )}
                        {inv.skills.map((s) => (
                          <Badge key={s} size='xs' variant='outline' color='gray'>
                            {s}
                          </Badge>
                        ))}
                      </Group>
                    </div>
                  </Stack>
                )}
              </Card>

              <Card withBorder radius='md' padding='md' className='chat-surface'>
                <Text fw={600} size='sm' mb={6}>
                  Reglas vigentes
                </Text>
                {!inv && (
                  <Text size='xs' c='dimmed'>
                    Sin inventario: no hay reglas que mostrar todavía.
                  </Text>
                )}
                {inv && (
                  <Stack gap={8}>
                    <div>
                      <Text size='xs' fw={600} mb={2}>
                        Ejecución de comandos
                      </Text>
                      <Badge
                        size='xs'
                        variant='light'
                        color={
                          inv.execRequiresApproval === false
                            ? 'orange'
                            : inv.execRequiresApproval
                              ? 'green'
                              : 'gray'
                        }
                      >
                        {inv.execRequiresApproval === false
                          ? 'comandos sin aprobación'
                          : inv.execRequiresApproval
                            ? 'comandos con aprobación'
                            : 'ejecución sin determinar'}
                      </Badge>
                      {inv.execMode && (
                        <Text size='xs' c='dimmed' span ml={6}>
                          {inv.execMode}
                        </Text>
                      )}
                    </div>
                    <div>
                      <Text size='xs' fw={600} mb={2}>
                        Herramientas
                      </Text>
                      <Text size='xs'>
                        {inv.tools.allow.length === 0 && inv.tools.deny.length === 0
                          ? 'Sin lista declarada (usa las de su configuración por defecto).'
                          : `${inv.tools.allow.length} permitidas · ${inv.tools.deny.length} negadas`}
                      </Text>
                      {inv.tools.allow.length > 0 && (
                        <Text size='xs' c='dimmed'>
                          Permitidas: {inv.tools.allow.join(', ')}
                        </Text>
                      )}
                      {inv.tools.deny.length > 0 && (
                        <Text size='xs' c='dimmed'>
                          Negadas: {inv.tools.deny.join(', ')}
                        </Text>
                      )}
                    </div>
                    <div>
                      <Text size='xs' fw={600} mb={2}>
                        Canales
                      </Text>
                      <Group gap={4} wrap='wrap'>
                        {inv.channels.length === 0 && (
                          <Text size='xs' c='dimmed'>
                            Ninguno detectado.
                          </Text>
                        )}
                        {inv.channels.map((c, i) => (
                          <Tooltip
                            key={`${c.type}-${i}`}
                            label={c.detail ?? NOMBRE_POLITICA[c.policy]}
                            withArrow
                          >
                            <Badge
                              size='xs'
                              variant='outline'
                              color={c.policy === 'abierta' ? 'red' : 'gray'}
                            >
                              {c.type} · {NOMBRE_POLITICA[c.policy] ?? c.policy}
                              {typeof c.allowed === 'number' ? ` (${c.allowed})` : ''}
                            </Badge>
                          </Tooltip>
                        ))}
                      </Group>
                    </div>
                    <Text size='xs' c='dimmed'>
                      Las reglas de negocio, roles y personalidad administrados desde SynerLink
                      llegan con la fase de gobierno; por ahora se muestra lo que el agente tiene
                      configurado.
                    </Text>
                  </Stack>
                )}
              </Card>
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, md: 2 }} spacing='sm' mb='md'>
              <Card withBorder radius='md' padding='md' className='chat-surface'>
                <Text fw={600} size='sm' mb={6}>
                  Hallazgos abiertos ({datos.hallazgos.abiertos.length})
                </Text>
                <ListaHallazgos lista={datos.hallazgos.abiertos} />
              </Card>
              <Card withBorder radius='md' padding='md' className='chat-surface'>
                <Text fw={600} size='sm' mb={6}>
                  Hallazgos cerrados recientes ({datos.hallazgos.cerrados.length})
                </Text>
                <ListaHallazgos lista={datos.hallazgos.cerrados} cerrados />
              </Card>
            </SimpleGrid>

            <Card withBorder radius='md' padding='md' mb='md' className='chat-surface'>
              <Text fw={600} size='sm' mb={6}>
                Historial
              </Text>
              {historial.length === 0 && (
                <Text size='xs' c='dimmed'>
                  Sin entradas todavía.
                </Text>
              )}
              <Stack gap={8}>
                {historialVisible.map((e) => (
                  <Group key={e.id} gap={8} wrap='nowrap' align='flex-start'>
                    <Text size='xs' c='dimmed' style={{ whiteSpace: 'nowrap', minWidth: 74 }}>
                      {fecha(e.occurredAt)}
                    </Text>
                    <Badge
                      size='xs'
                      variant='light'
                      color={NOMBRE_ENTRADA[e.kind]?.color ?? 'gray'}
                      style={{ flexShrink: 0 }}
                    >
                      {NOMBRE_ENTRADA[e.kind]?.label ?? e.kind}
                    </Badge>
                    <div style={{ minWidth: 0 }}>
                      <Text size='xs' fw={600}>
                        {e.title}
                      </Text>
                      {e.detail && (
                        <Text size='xs' c='dimmed' style={{ whiteSpace: 'pre-line' }}>
                          {e.detail}
                        </Text>
                      )}
                      {e.createdBy && (
                        <Text size='xs' c='dimmed'>
                          Por {e.createdBy}
                        </Text>
                      )}
                    </div>
                  </Group>
                ))}
              </Stack>
              {historial.length > 15 && (
                <Button
                  size='xs'
                  variant='subtle'
                  mt='xs'
                  onClick={() => setVerHistorial((v) => !v)}
                >
                  {verHistorial ? 'Ver menos' : `Ver las ${historial.length} entradas`}
                </Button>
              )}
            </Card>
          </>
        )}

        <Modal
          opened={editando}
          onClose={() => setEditando(false)}
          title='Editar propósito y dueño'
          radius='md'
          size='lg'
        >
          <Stack gap='sm'>
            {errorEdicion && (
              <Alert color='red' radius='md' icon={<IconAlertCircle size={18} />} title='No se guardó'>
                {errorEdicion}
              </Alert>
            )}
            <Textarea
              label='Propósito'
              description='Para qué existe este agente y a quién le sirve (máximo 1.000 caracteres).'
              autosize
              minRows={3}
              maxLength={1000}
              value={form.purpose}
              onChange={(e) => setForm((f) => ({ ...f, purpose: e.currentTarget.value }))}
            />
            <TextInput
              label='Dueño'
              description='Persona responsable del agente.'
              maxLength={160}
              value={form.ownerName}
              onChange={(e) => setForm((f) => ({ ...f, ownerName: e.currentTarget.value }))}
            />
            <TextInput
              label='Correo del dueño'
              maxLength={255}
              value={form.ownerEmail}
              onChange={(e) => setForm((f) => ({ ...f, ownerEmail: e.currentTarget.value }))}
            />
            <Group justify='flex-end' gap='xs'>
              <Button size='xs' variant='default' onClick={() => setEditando(false)}>
                Cancelar
              </Button>
              <Button size='xs' loading={guardando} onClick={() => void guardar()}>
                Guardar
              </Button>
            </Group>
          </Stack>
        </Modal>
      </div>
    </div>
  );
}
