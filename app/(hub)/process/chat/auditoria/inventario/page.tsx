'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowLeft,
  IconCircleCheck,
  IconListDetails,
  IconLock,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react';

/**
 * AUDITORÍA DE AGENTES → INVENTARIO (F1, solo lectura) — qué tiene cada agente.
 *
 * Por cada agente registrado en SynerLink: qué MCP tiene (con su empresa y si
 * lee o escribe), qué herramientas, skills y canales, cuándo se escaneó y qué
 * riesgos salen de eso. El dato lo publica un recolector que corre en la Mac de
 * horus cada noche; el botón "Re-escanear" deja una solicitud que el recolector
 * toma en su siguiente ronda.
 *
 * El diseño copia a propósito el de "Skills de la flota" y el de la Auditoría
 * (mismo encabezado, misma tarjeta de filtros, mismas tarjetas): es otra
 * pestaña del mismo módulo, no una pantalla nueva.
 *
 * LA REJA ESTÁ EN EL ENDPOINT (/api/chat/auditoria/inventario).
 */

type Mcp = {
  name: string;
  transport: string;
  target: string | null;
  company: string | null;
  access: string;
  auth: string;
  writeTools: string | null;
};
type Canal = {
  type: string;
  policy: string;
  allowed: number | null;
  detail: string | null;
};
type Hallazgo = {
  id: number;
  ruleCode: string;
  severity: string;
  subject: string;
  title: string;
  detail: string | null;
  firstSeenAt: string;
};
type Inventario = {
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
  channels: Canal[];
  scanError: string | null;
  mcps: Mcp[];
};
type Agente = {
  idAgent: number;
  code: string;
  displayName: string;
  handle: string | null;
  empresas: string[];
  inventario: Inventario | null;
  hallazgos: Hallazgo[];
};
type Solicitud = {
  id: number;
  origin: string;
  status: string;
  requestedBy: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  agentsScanned: number;
  errorSummary: string | null;
};
type Respuesta = {
  ultimoEscaneo: Solicitud | null;
  solicitudPendiente: Solicitud | null;
  agentes: Agente[];
};
type Aviso = {
  color: 'green' | 'yellow' | 'red';
  titulo: string;
  texto: string;
};

const SEVERIDADES = ['critico', 'alto', 'medio', 'bajo'] as const;
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
const NOMBRE_TIPO: Record<string, string> = {
  'claude-code': 'Claude Code',
  openclaw: 'OpenClaw',
};
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

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Severidad más alta de los hallazgos abiertos de un agente, o null. */
function peorSeveridad(h: Hallazgo[]): string | null {
  for (const s of SEVERIDADES) if (h.some((x) => x.severity === s)) return s;
  return null;
}

function TarjetaAgente({ a }: { a: Agente }) {
  const inv = a.inventario;
  const [verSkills, setVerSkills] = useState(false);
  const skills = inv?.skills ?? [];
  const skillsVisibles = verSkills ? skills : skills.slice(0, 12);

  return (
    <Card withBorder radius='md' padding='md' className='chat-surface'>
      <Group justify='space-between' wrap='nowrap' mb={6} align='flex-start'>
        <div style={{ minWidth: 0 }}>
          <Text fw={700} size='sm'>
            {a.displayName}
          </Text>
          <Text
            size='xs'
            c='dimmed'
            style={{
              fontFamily: 'var(--mantine-font-family-monospace)',
              wordBreak: 'break-word',
            }}
          >
            {a.code}
            {a.handle ? ` · ${a.handle}` : ''}
          </Text>
        </div>
        <Group gap={4} wrap='wrap' justify='flex-end'>
          {inv && (
            <Badge size='xs' variant='light' color='indigo'>
              {NOMBRE_TIPO[inv.kind] ?? inv.kind}
            </Badge>
          )}
          {a.hallazgos.length > 0 && (
            <Badge
              size='xs'
              variant='filled'
              color={COLOR_SEVERIDAD[peorSeveridad(a.hallazgos) ?? 'bajo']}
            >
              {a.hallazgos.length} {a.hallazgos.length === 1 ? 'hallazgo' : 'hallazgos'}
            </Badge>
          )}
        </Group>
      </Group>

      {a.empresas.length > 0 && (
        <Text size='xs' c='dimmed' mb={4}>
          {a.empresas.join(', ')}
        </Text>
      )}

      {!inv && (
        <Text size='xs' c='dimmed'>
          Todavía no se ha escaneado este agente.
        </Text>
      )}

      {inv && (
        <Stack gap={8}>
          <Text size='xs'>
            {inv.host}
            {inv.location ? ` · ${inv.location}` : ''}
            {inv.model ? ` · ${inv.model}` : ''}
          </Text>

          {inv.scanError && (
            <Alert color='yellow' radius='md' p='xs' icon={<IconAlertTriangle size={14} />}>
              <Text size='xs'>{inv.scanError}</Text>
            </Alert>
          )}

          <Group gap={4} wrap='wrap'>
            <Badge
              size='xs'
              variant='light'
              color={
                inv.serviceStatus === 'activo'
                  ? 'green'
                  : inv.serviceStatus === 'detenido'
                    ? 'red'
                    : 'gray'
              }
            >
              {NOMBRE_SERVICIO[inv.serviceStatus ?? 'desconocido'] ?? inv.serviceStatus}
            </Badge>
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
          </Group>

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
                    color={m.auth === 'ninguna' ? 'red' : m.auth === 'requerida' ? 'green' : 'gray'}
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
              Herramientas
            </Text>
            <Text size='xs'>
              {inv.tools.allow.length === 0 && inv.tools.deny.length === 0
                ? 'Sin lista declarada (usa las de su configuración por defecto).'
                : `${inv.tools.allow.length} permitidas · ${inv.tools.deny.length} negadas`}
            </Text>
            {(inv.tools.allow.length > 0 || inv.tools.deny.length > 0) && (
              <Tooltip
                label={[
                  inv.tools.allow.length ? `Permitidas: ${inv.tools.allow.join(', ')}` : '',
                  inv.tools.deny.length ? `Negadas: ${inv.tools.deny.join(', ')}` : '',
                ]
                  .filter(Boolean)
                  .join(' — ')}
                withArrow
                multiline
                w={420}
              >
                <Text size='xs' c='dimmed' style={{ cursor: 'help' }}>
                  Ver detalle
                </Text>
              </Tooltip>
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

          <div>
            <Text size='xs' fw={600} mb={2}>
              Skills ({skills.length})
            </Text>
            <Group gap={4} wrap='wrap'>
              {skills.length === 0 && (
                <Text size='xs' c='dimmed'>
                  Ninguno instalado.
                </Text>
              )}
              {skillsVisibles.map((s) => (
                <Badge key={s} size='xs' variant='outline' color='gray'>
                  {s}
                </Badge>
              ))}
              {skills.length > 12 && (
                <Badge
                  size='xs'
                  variant='light'
                  color='gray'
                  style={{ cursor: 'pointer' }}
                  onClick={() => setVerSkills((v) => !v)}
                >
                  {verSkills ? 'ver menos' : `+${skills.length - 12}`}
                </Badge>
              )}
            </Group>
          </div>

          {a.hallazgos.length > 0 && (
            <div>
              <Text size='xs' fw={600} mb={2}>
                Hallazgos abiertos
              </Text>
              <Stack gap={4}>
                {a.hallazgos.map((h) => (
                  <Group key={h.id} gap={6} wrap='nowrap' align='flex-start'>
                    <Badge size='xs' variant='filled' color={COLOR_SEVERIDAD[h.severity] ?? 'gray'}>
                      {NOMBRE_SEVERIDAD[h.severity] ?? h.severity}
                    </Badge>
                    <Tooltip label={h.detail ?? h.title} withArrow multiline w={360}>
                      <Text size='xs'>{h.title}</Text>
                    </Tooltip>
                  </Group>
                ))}
              </Stack>
            </div>
          )}

          <Text size='xs' c='dimmed'>
            Escaneado el {fechaHora(inv.scannedAt)}
          </Text>
        </Stack>
      )}
    </Card>
  );
}

export default function AuditoriaInventarioPage() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [q, setQ] = useState('');
  const [equipo, setEquipo] = useState<string | null>(null);
  const [riesgo, setRiesgo] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/auditoria/inventario', {
        cache: 'no-store',
      });
      if (res.status === 403) {
        setSinPermiso(true);
        return;
      }
      if (!res.ok) {
        setError('No se pudo consultar el inventario de agentes.');
        return;
      }
      setError(null);
      setDatos(await res.json());
    } catch {
      setError('No se pudo consultar el inventario de agentes.');
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Mientras haya un escaneo pendiente o en curso, la pantalla se refresca
  // sola. Refrescar NO desmonta nada: el aviso de arriba se mantiene.
  const hayPendiente = Boolean(datos?.solicitudPendiente);
  useEffect(() => {
    if (!hayPendiente) return;
    const t = setInterval(() => void cargar(), 20_000);
    return () => clearInterval(t);
  }, [hayPendiente, cargar]);

  const reescanear = async () => {
    setPidiendo(true);
    try {
      const res = await fetch('/api/chat/auditoria/inventario/escanear', {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({
          color: 'red',
          titulo: 'No se pudo solicitar el escaneo',
          texto:
            body?.error ?? `El servidor respondió ${res.status}. Intente de nuevo en unos minutos.`,
        });
        return;
      }
      setAviso(
        body.yaExistia
          ? {
              color: 'yellow',
              titulo: 'Ya hay un escaneo en marcha',
              texto: `La solicitud #${body.solicitud.id} sigue ${body.solicitud.status === 'en_curso' ? 'en curso' : 'pendiente'}. No se creó otra; la pantalla se actualizará cuando termine.`,
            }
          : {
              color: 'green',
              titulo: 'Escaneo solicitado',
              texto: `Quedó registrada la solicitud #${body.solicitud.id}. El recolector la toma en los próximos minutos y esta pantalla se actualiza sola.`,
            }
      );
      await cargar();
    } catch {
      setAviso({
        color: 'red',
        titulo: 'No se pudo solicitar el escaneo',
        texto: 'No hubo respuesta del servidor. Revise su conexión e intente de nuevo.',
      });
    } finally {
      setPidiendo(false);
    }
  };

  const agentes = datos?.agentes ?? [];

  const opcionesEquipo = useMemo(() => {
    const set = new Set<string>();
    for (const a of agentes) if (a.inventario) set.add(a.inventario.host);
    return [...set].sort((x, y) => x.localeCompare(y, 'es'));
  }, [agentes]);

  const resumen = useMemo(() => {
    const r = {
      escaneados: 0,
      sinEscanear: 0,
      mcpEscritura: 0,
      critico: 0,
      alto: 0,
      medio: 0,
      bajo: 0,
    };
    for (const a of agentes) {
      if (a.inventario) r.escaneados += 1;
      else r.sinEscanear += 1;
      r.mcpEscritura += (a.inventario?.mcps ?? []).filter((m) => m.access === 'escritura').length;
      for (const h of a.hallazgos) {
        if (h.severity in r) r[h.severity as 'critico' | 'alto' | 'medio' | 'bajo'] += 1;
      }
    }
    return r;
  }, [agentes]);

  const filtrados = useMemo(() => {
    const texto = q.trim().toLowerCase();
    return agentes.filter((a) => {
      if (equipo && a.inventario?.host !== equipo) return false;
      if (riesgo === 'sin-escanear' && a.inventario) return false;
      if (riesgo === 'con-hallazgos' && a.hallazgos.length === 0) return false;
      if (riesgo && SEVERIDADES.includes(riesgo as (typeof SEVERIDADES)[number])) {
        if (!a.hallazgos.some((h) => h.severity === riesgo)) return false;
      }
      if (!texto) return true;
      const inv = a.inventario;
      return (
        a.displayName.toLowerCase().includes(texto) ||
        a.code.toLowerCase().includes(texto) ||
        a.empresas.some((e) => e.toLowerCase().includes(texto)) ||
        (inv?.mcps ?? []).some(
          (m) =>
            m.name.toLowerCase().includes(texto) || (m.company ?? '').toLowerCase().includes(texto)
        ) ||
        (inv?.skills ?? []).some((s) => s.toLowerCase().includes(texto))
      );
    });
  }, [agentes, q, equipo, riesgo]);

  if (sinPermiso) {
    return (
      <div className='app-page-shell app-page-shell--fill min-h-screen'>
        <div className='max-w-3xl mx-auto py-10 px-4'>
          <Alert icon={<IconLock size={18} />} color='yellow' radius='lg' title='Sin acceso'>
            La auditoría de agentes está reservada a la administración.
          </Alert>
        </div>
      </div>
    );
  }

  const ultimo = datos?.ultimoEscaneo ?? null;
  const pendiente = datos?.solicitudPendiente ?? null;

  return (
    <div className='app-page-shell app-page-shell--fill ios-process-hub min-h-screen'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Group gap='xs' mb={4}>
          <Link href='/process/chat/auditoria' className='chat-text-muted' style={{ fontSize: 13 }}>
            <Group gap={4} wrap='nowrap'>
              <IconArrowLeft size={14} />
              <span>Volver a Auditoría de agentes</span>
            </Group>
          </Link>
        </Group>

        <Group gap='sm' mb={2} wrap='nowrap'>
          <IconListDetails size={26} className='chat-folder__icon' />
          <Title order={1} className='ios-process-hub__title text-3xl'>
            Inventario de agentes
          </Title>
        </Group>
        <Text className='ios-process-hub__subtitle' mb='lg'>
          Qué MCP (con su empresa y si lee o escribe), herramientas, skills y canales tiene cada
          agente registrado en SynerLink, y los riesgos que salen de eso. Se escanea cada noche
          desde la Mac de horus, en solo lectura y sin guardar credenciales.
          {ultimo?.finishedAt && ` Último escaneo: ${fechaHora(ultimo.finishedAt)}.`}
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

        {pendiente && (
          <Alert color='blue' radius='md' mb='md' icon={<Loader size={16} />}>
            Escaneo #{pendiente.id} {pendiente.status === 'en_curso' ? 'en curso' : 'pendiente'}
            {pendiente.requestedBy ? `, pedido por ${pendiente.requestedBy}` : ''} el{' '}
            {fechaHora(pendiente.requestedAt)}.
          </Alert>
        )}

        {ultimo?.errorSummary && (
          <Alert color='yellow' radius='md' mb='md' icon={<IconAlertTriangle size={18} />}>
            Último escaneo con novedades: {ultimo.errorSummary}
          </Alert>
        )}

        <Card withBorder radius='md' padding='md' mb='md' className='chat-surface'>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing='sm'>
            <TextInput
              label='Buscar'
              size='xs'
              placeholder='Agente, empresa, MCP o skill'
              leftSection={<IconSearch size={14} />}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
            <Select
              label='Equipo'
              size='xs'
              placeholder='Todos'
              clearable
              value={equipo}
              onChange={setEquipo}
              data={opcionesEquipo}
            />
            <Select
              label='Riesgo'
              size='xs'
              placeholder='Todos'
              clearable
              value={riesgo}
              onChange={setRiesgo}
              data={[
                { value: 'con-hallazgos', label: 'Con hallazgos abiertos' },
                { value: 'critico', label: 'Con hallazgos críticos' },
                { value: 'alto', label: 'Con hallazgos altos' },
                { value: 'medio', label: 'Con hallazgos medios' },
                { value: 'bajo', label: 'Con hallazgos bajos' },
                { value: 'sin-escanear', label: 'Sin escanear' },
              ]}
            />
            <Group mt={20} gap='xs'>
              <Button
                size='xs'
                leftSection={<IconRefresh size={14} />}
                loading={pidiendo}
                disabled={Boolean(pendiente)}
                onClick={() => void reescanear()}
              >
                Re-escanear
              </Button>
            </Group>
          </SimpleGrid>
        </Card>

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

        {datos && (
          <>
            <Card withBorder radius='md' padding='md' mb='md' className='chat-surface'>
              <Text fw={600} size='sm' mb={6}>
                Resumen
              </Text>
              <Group gap='xl' wrap='wrap'>
                <div>
                  <Text size='xs' c='dimmed'>
                    Agentes registrados
                  </Text>
                  <Text fw={700}>{agentes.length}</Text>
                </div>
                <div>
                  <Text size='xs' c='dimmed'>
                    Escaneados
                  </Text>
                  <Text fw={700}>{resumen.escaneados}</Text>
                </div>
                <div>
                  <Text size='xs' c='dimmed'>
                    Sin escanear
                  </Text>
                  <Text>{resumen.sinEscanear}</Text>
                </div>
                <div>
                  <Text size='xs' c='dimmed'>
                    MCP con escritura
                  </Text>
                  <Text>{resumen.mcpEscritura}</Text>
                </div>
                {SEVERIDADES.map((s) => (
                  <div key={s}>
                    <Text size='xs' c='dimmed'>
                      Hallazgos {NOMBRE_SEVERIDAD[s].toLowerCase()}
                    </Text>
                    <Text
                      fw={resumen[s] > 0 && (s === 'critico' || s === 'alto') ? 700 : undefined}
                      c={resumen[s] > 0 ? COLOR_SEVERIDAD[s] : undefined}
                    >
                      {resumen[s]}
                    </Text>
                  </div>
                ))}
              </Group>
              <Text size='xs' c='dimmed' mt={8}>
                Los hallazgos se calculan solos con cada escaneo: si el riesgo deja de aparecer, el
                hallazgo se cierra. Solo se incluyen los agentes registrados en SynerLink.
              </Text>
            </Card>

            <Text size='sm' c='dimmed' mb={6}>
              {filtrados.length} de {agentes.length} agentes
            </Text>
            <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing='sm'>
              {filtrados.map((a) => (
                <TarjetaAgente key={a.idAgent} a={a} />
              ))}
            </SimpleGrid>
            {filtrados.length === 0 && (
              <Text size='sm' c='dimmed' ta='center' py='xl'>
                Ningún agente coincide con esos filtros.
              </Text>
            )}
          </>
        )}
      </div>
    </div>
  );
}
