'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconAlertCircle, IconLink, IconPencil, IconPlus } from '@tabler/icons-react';

/**
 * HOJA DE VIDA COMPLETA (incremento 1, 2026-10-20) — secciones nuevas de la
 * ficha del agente: identificación ampliada, calidad de respuesta, gobierno
 * vigente, casos de SynerLink vinculados y hallazgos de Gobierno IA.
 *
 * Mismo diseño que el resto de la ficha (tarjetas `chat-surface`, títulos
 * `fw=600 size=sm`, insignias `xs`): es una ampliación de la misma página, no
 * una pantalla nueva. Los avisos de éxito o error se muestran ARRIBA de la
 * página con color (callback `onAviso` de la página), nunca abajo.
 *
 * Nada de aquí lee ni muestra el texto de las conversaciones.
 */

export type Aviso = { color: 'green' | 'yellow' | 'red'; titulo: string; texto: string };

export type BloqueGobierno = {
  marker: string;
  addedOn: string | null;
  author: string | null;
  caseRef: number | null;
  text: string | null;
  file: string | null;
};

export type Completa = {
  ejecucion: {
    vistoEl: string;
    authMode: string;
    authDetail: string | null;
    tokenFingerprint: string | null;
    compartidaCon: string[];
    processStartedAt: string | null;
    lastRotationAt: string | null;
    lastRotationStatus: string | null;
    lastRotationDetail: string | null;
    personaFingerprint: string | null;
    personaFiles: string[];
    governance: BloqueGobierno[];
    usageHook: boolean | null;
  } | null;
  gobierno: {
    directorName: string | null;
    directorEmail: string | null;
    privilegeTemplate: string | null;
    privilegeAppliedOn: string | null;
    notes: string | null;
    updatedBy: string | null;
    updatedAt: string;
  } | null;
  casos: {
    idRequest: number;
    relation: string;
    enEstaBase: boolean;
    asunto: string | null;
    proceso: string | null;
    empresa: string | null;
    estado: string | null;
    creadoEl: string | null;
    resueltoEl: string | null;
    vinculadoPor: string | null;
    vinculadoEl: string;
    tareas: {
      id: number;
      tarea: string;
      estado: string | null;
      responsable: string | null;
      inicio: string | null;
      resueltaEl: string | null;
    }[];
  }[];
  eventosCasos: { occurredAt: string; kind: string; title: string; detail: string | null }[];
  hallazgosExternos: {
    id: number;
    source: string;
    refCode: string;
    severity: string;
    title: string;
    detail: string | null;
    recommendation: string | null;
    status: string;
    reportedOn: string;
    resolvedOn: string | null;
    idRequest: number | null;
    createdBy: string | null;
  }[];
  calidad30: {
    preguntas: number;
    respondidas: number;
    sinRespuesta: number;
    enEspera: number;
    medianaSeg: number | null;
    p90Seg: number | null;
    tardias: number;
    pendientes: number;
    reportaConsumo: boolean | null;
  };
};

const fmt = new Intl.NumberFormat('es-CO');
const num = (v: number) => fmt.format(Math.round(v));

function aFecha(v: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00.000Z`) : new Date(v);
}
export function fechaCorta(iso: string | null): string {
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

export function duracion(seg: number | null): string {
  if (seg === null) return '—';
  if (seg < 60) return `${seg} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

const MODO_AUTH: Record<string, string> = {
  token: 'Token propio',
  'api-key': 'Llave de API',
  'oauth-llavero': 'Sesión OAuth (llavero)',
  'perfil-openclaw': 'Perfil de openclaw',
  desconocido: 'Sin determinar',
};
const RELACION: Record<string, string> = {
  'gobierno-ia': 'Gobierno IA',
  incidente: 'Incidente',
  cambio: 'Cambio',
  otro: 'Otro',
};
const COLOR_SEVERIDAD: Record<string, string> = { critico: 'red', alto: 'orange', medio: 'yellow', bajo: 'gray' };
const NOMBRE_SEVERIDAD: Record<string, string> = { critico: 'Crítico', alto: 'Alto', medio: 'Medio', bajo: 'Bajo' };
const ESTADO_EXTERNO: Record<string, { label: string; color: string }> = {
  abierto: { label: 'abierto', color: 'orange' },
  resuelto: { label: 'resuelto', color: 'green' },
  aceptado: { label: 'riesgo aceptado', color: 'gray' },
};

function Dato({ k, v, nota }: { k: string; v: string; nota?: string }) {
  return (
    <div>
      <Text size='xs' c='dimmed'>
        {k}
      </Text>
      <Text>{v}</Text>
      {nota && (
        <Text size='xs' c='dimmed'>
          {nota}
        </Text>
      )}
    </div>
  );
}

function rutaCaso(id: number) {
  return `/process/request-general/view-request?id=${id}&from=general-requests`;
}

async function enviar(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && !data.error) data.error = `El servidor respondió ${res.status}. Intente de nuevo.`;
  return { ok: res.ok, data };
}

// ── Identificación ampliada (dentro de la tarjeta de encabezado) ────────────

export function IdentificacionAmpliada({ c }: { c: Completa }) {
  const g = c.gobierno;
  const e = c.ejecucion;
  const casoGob = c.casos.find((x) => x.relation === 'gobierno-ia') ?? null;
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing='sm' mt='sm' data-testid='hv-identificacion-ampliada'>
      <Dato
        k='Director del área'
        v={g?.directorName || g?.directorEmail ? `${g?.directorName ?? ''}${g?.directorEmail ? ` · ${g.directorEmail}` : ''}` : 'Sin director registrado'}
        nota='Aval del flujo de Gobierno IA'
      />
      <Dato
        k='Caso de Gobierno IA'
        v={casoGob ? `#${casoGob.idRequest}${casoGob.estado ? ` · ${casoGob.estado}` : ''}` : 'Sin caso vinculado'}
        nota={casoGob?.proceso ?? casoGob?.asunto ?? undefined}
      />
      <Dato
        k='Credencial'
        v={e ? `${MODO_AUTH[e.authMode] ?? e.authMode}${e.tokenFingerprint ? ` · huella ${e.tokenFingerprint}` : ''}` : 'Sin datos del recolector'}
        nota={
          e?.compartidaCon.length
            ? `Compartida con ${e.compartidaCon.join(', ')}`
            : e
              ? 'Solo se guarda la huella, nunca el valor'
              : undefined
        }
      />
      <Dato
        k='En ejecución desde'
        v={e?.processStartedAt ? fechaHora(e.processStartedAt) : '—'}
        nota={
          e?.lastRotationAt
            ? `Última rotación de sesión: ${fechaCorta(e.lastRotationAt)}${e.lastRotationStatus && e.lastRotationStatus !== 'ok' ? ` (${e.lastRotationStatus})` : ''}`
            : 'Sin rotación de sesión registrada'
        }
      />
    </SimpleGrid>
  );
}

// ── Calidad de respuesta (dentro de la tarjeta de Métricas) ─────────────────

export function CalidadRespuesta({ c }: { c: Completa }) {
  const q = c.calidad30;
  return (
    <div data-testid='hv-calidad'>
      <Group gap='xl' wrap='wrap' mb='sm'>
        <Dato k='Tiempo de respuesta (mediana, 30 días)' v={duracion(q.medianaSeg)} nota={`${num(q.respondidas)} de ${num(q.preguntas)} preguntas respondidas`} />
        <Dato k='Tiempo de respuesta (9 de cada 10)' v={duracion(q.p90Seg)} />
        <Dato k='Sin respuesta en la primera hora' v={num(q.sinRespuesta)} nota={q.enEspera ? `${num(q.enEspera)} aún en espera` : undefined} />
        <Dato k='Mensajes recogidos tarde o sin recoger' v={num(q.tardias + q.pendientes)} nota='más de 10 minutos' />
        <Dato
          k='Reporta su consumo'
          v={q.reportaConsumo === null ? 'Sin determinar' : q.reportaConsumo ? 'Sí' : 'No'}
          nota={q.reportaConsumo === false ? 'Sin el reporte, el consumo en tokens sale en cero' : undefined}
        />
      </Group>
      <Text size='xs' c='dimmed' mb={8}>
        Calidad de respuesta en hilos directos, calculada solo con la hora de cada mensaje. Una pregunta es el
        primer mensaje de una persona después de una respuesta del agente.
      </Text>
    </div>
  );
}

// ── Gobierno vigente ─────────────────────────────────────────────────────────

export function GobiernoVigente({
  c,
  code,
  puedeConfigurar,
  onAviso,
  onRecargar,
}: {
  c: Completa;
  code: string;
  puedeConfigurar: boolean;
  onAviso: (a: Aviso) => void;
  onRecargar: () => Promise<void>;
}) {
  const g = c.gobierno;
  const bloques = c.ejecucion?.governance ?? [];
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verBloque, setVerBloque] = useState<number | null>(null);
  const [form, setForm] = useState({ directorName: '', directorEmail: '', privilegeTemplate: '', privilegeAppliedOn: '', notes: '' });

  const abrir = () => {
    setForm({
      directorName: g?.directorName ?? '',
      directorEmail: g?.directorEmail ?? '',
      privilegeTemplate: g?.privilegeTemplate ?? '',
      privilegeAppliedOn: g?.privilegeAppliedOn ?? '',
      notes: g?.notes ?? '',
    });
    setError(null);
    setAbierto(true);
  };
  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const r = await enviar(`/api/chat/auditoria/hoja-de-vida/${encodeURIComponent(code)}/gobierno`, 'PUT', form);
      if (!r.ok) {
        setError(String(r.data.error));
        return;
      }
      setAbierto(false);
      const cambios = (r.data.cambios as string[]) ?? [];
      onAviso(
        cambios.length
          ? { color: 'green', titulo: 'Gobierno actualizado', texto: `${cambios.join(' ')} El cambio quedó en el historial.` }
          : { color: 'yellow', titulo: 'Sin cambios', texto: 'Los datos ya estaban así; no se registró nada nuevo.' }
      );
      await onRecargar();
    } catch {
      setError('No hubo respuesta del servidor. Revise su conexión e intente de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Card withBorder radius='md' padding='md' className='chat-surface' data-testid='hv-gobierno'>
      <Group justify='space-between' mb={6} wrap='wrap' gap='xs'>
        <Text fw={600} size='sm'>
          Gobierno vigente
        </Text>
        {puedeConfigurar && (
          <Button size='xs' variant='light' leftSection={<IconPencil size={14} />} onClick={abrir}>
            Editar gobierno
          </Button>
        )}
      </Group>
      <Stack gap={8}>
        <div>
          <Text size='xs' fw={600} mb={2}>
            Mínimo privilegio
          </Text>
          {g?.privilegeTemplate ? (
            <Group gap={6} wrap='wrap'>
              <Badge size='xs' variant='light' color='teal'>
                {g.privilegeTemplate}
              </Badge>
              {g.privilegeAppliedOn && (
                <Text size='xs' c='dimmed'>
                  aplicada el {fechaCorta(g.privilegeAppliedOn)}
                </Text>
              )}
            </Group>
          ) : (
            <Badge size='xs' variant='light' color='orange'>
              sin plantilla aplicada
            </Badge>
          )}
          {g?.notes && (
            <Text size='xs' c='dimmed' mt={4} style={{ whiteSpace: 'pre-line' }}>
              {g.notes}
            </Text>
          )}
        </div>
        <div>
          <Text size='xs' fw={600} mb={2}>
            Reglas de gobierno en sus instrucciones ({bloques.length})
          </Text>
          {bloques.length === 0 ? (
            <Text size='xs' c='dimmed'>
              {c.ejecucion
                ? 'El recolector no encontró bloques de Gobierno IA en sus instrucciones.'
                : 'Sin datos del recolector todavía.'}
            </Text>
          ) : (
            <Stack gap={4}>
              {bloques.map((b, i) => (
                <div key={`${b.marker}-${i}`}>
                  <Group gap={6} wrap='wrap'>
                    <Badge size='xs' variant='outline' color='indigo'>
                      {b.marker}
                    </Badge>
                    <Text size='xs' c='dimmed'>
                      {[b.caseRef ? `caso #${b.caseRef}` : null, b.addedOn ? `desde ${fechaCorta(b.addedOn)}` : null, b.file]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {b.text && (
                      <Button size='compact-xs' variant='subtle' onClick={() => setVerBloque(verBloque === i ? null : i)}>
                        {verBloque === i ? 'Ocultar texto' : 'Ver texto'}
                      </Button>
                    )}
                  </Group>
                  {verBloque === i && b.text && (
                    <Text size='xs' mt={4} p={8} className='chat-surface' style={{ whiteSpace: 'pre-line', borderRadius: 8, border: '1px solid var(--mantine-color-default-border)' }}>
                      {b.text}
                    </Text>
                  )}
                </div>
              ))}
            </Stack>
          )}
        </div>
        {c.ejecucion?.personaFingerprint && (
          <Text size='xs' c='dimmed'>
            Huella de su personalidad: <span style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{c.ejecucion.personaFingerprint}</span>
            {c.ejecucion.personaFiles.length ? ` (${c.ejecucion.personaFiles.join(', ')})` : ''}. Si cambia, queda en el historial.
          </Text>
        )}
        {g?.updatedAt && (
          <Text size='xs' c='dimmed'>
            Actualizado el {fechaHora(g.updatedAt)}
            {g.updatedBy ? ` por ${g.updatedBy}` : ''}
          </Text>
        )}
      </Stack>

      <Modal opened={abierto} onClose={() => setAbierto(false)} title='Editar gobierno del agente' radius='md' size='lg'>
        <Stack gap='sm'>
          {error && (
            <Alert color='red' radius='md' icon={<IconAlertCircle size={18} />} title='No se guardó'>
              {error}
            </Alert>
          )}
          <TextInput
            label='Director del área'
            description='Quien avala el agente en el flujo de Gobierno IA.'
            maxLength={160}
            value={form.directorName}
            onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, directorName: v })); }}
          />
          <TextInput
            label='Correo del director'
            maxLength={255}
            value={form.directorEmail}
            onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, directorEmail: v })); }}
          />
          <TextInput
            label='Plantilla de mínimo privilegio'
            description='Por ejemplo «Plantilla A — sin SAP».'
            maxLength={120}
            value={form.privilegeTemplate}
            onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, privilegeTemplate: v })); }}
          />
          <TextInput
            label='Aplicada el'
            placeholder='AAAA-MM-DD'
            maxLength={10}
            value={form.privilegeAppliedOn}
            onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, privilegeAppliedOn: v })); }}
          />
          <Textarea
            label='Notas'
            autosize
            minRows={2}
            maxLength={1000}
            value={form.notes}
            onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, notes: v })); }}
          />
          <Group justify='flex-end' gap='xs'>
            <Button size='xs' variant='default' onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button size='xs' loading={guardando} onClick={() => void guardar()}>
              Guardar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

// ── Casos de SynerLink vinculados ────────────────────────────────────────────

export function CasosVinculados({
  c,
  code,
  puedeConfigurar,
  onAviso,
  onRecargar,
}: {
  c: Completa;
  code: string;
  puedeConfigurar: boolean;
  onAviso: (a: Aviso) => void;
  onRecargar: () => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ idRequest: '', relation: 'gobierno-ia' });

  const vincular = async () => {
    setGuardando(true);
    setError(null);
    try {
      const r = await enviar(`/api/chat/auditoria/hoja-de-vida/${encodeURIComponent(code)}/casos`, 'POST', form);
      if (!r.ok) {
        setError(String(r.data.error));
        return;
      }
      setAbierto(false);
      onAviso({ color: 'green', titulo: 'Caso vinculado', texto: `El caso #${form.idRequest.replace(/^#/, '')} quedó en la hoja de vida y en el historial.` });
      await onRecargar();
    } catch {
      setError('No hubo respuesta del servidor. Revise su conexión e intente de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Card withBorder radius='md' padding='md' mb='md' className='chat-surface' data-testid='hv-casos'>
      <Group justify='space-between' mb={6} wrap='wrap' gap='xs'>
        <Text fw={600} size='sm'>
          Casos de SynerLink vinculados ({c.casos.length})
        </Text>
        {puedeConfigurar && (
          <Button
            size='xs'
            variant='light'
            leftSection={<IconLink size={14} />}
            onClick={() => {
              setForm({ idRequest: '', relation: 'gobierno-ia' });
              setError(null);
              setAbierto(true);
            }}
          >
            Vincular caso
          </Button>
        )}
      </Group>
      {c.casos.length === 0 ? (
        <Text size='xs' c='dimmed'>
          Ningún caso vinculado. Aquí van el caso de Gobierno IA del agente y los incidentes o cambios que lo afectaron.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={560}>
          <Table striped highlightOnHover verticalSpacing={4} fz='xs'>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Caso</Table.Th>
                <Table.Th>Relación</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Tareas</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {c.casos.map((x) => (
                <Table.Tr key={x.idRequest}>
                  <Table.Td>
                    {x.enEstaBase ? (
                      <Link href={rutaCaso(x.idRequest)} style={{ fontWeight: 600 }}>
                        #{x.idRequest}
                      </Link>
                    ) : (
                      <Text size='xs' fw={600} span>
                        #{x.idRequest}
                      </Text>
                    )}
                    <Text size='xs'>{x.asunto ?? '—'}</Text>
                    <Text size='xs' c='dimmed'>
                      {[x.proceso, x.empresa, x.creadoEl ? `radicado el ${fechaCorta(x.creadoEl)}` : null].filter(Boolean).join(' · ') ||
                        (x.enEstaBase ? '' : 'Este caso no está en esta base (por ejemplo, un caso de producción visto en pruebas).')}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size='xs' variant='light' color={x.relation === 'gobierno-ia' ? 'indigo' : 'gray'}>
                      {RELACION[x.relation] ?? x.relation}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{x.estado ?? '—'}</Table.Td>
                  <Table.Td>
                    {x.tareas.length === 0 ? (
                      <Text size='xs' c='dimmed'>
                        —
                      </Text>
                    ) : (
                      <Stack gap={2}>
                        {x.tareas.map((t) => (
                          <Text key={t.id} size='xs'>
                            {t.tarea}
                            <Text span size='xs' c='dimmed'>
                              {' '}
                              · {t.estado ?? 'sin estado'}
                              {t.responsable ? ` · ${t.responsable}` : ''}
                              {t.resueltaEl ? ` · ${fechaCorta(t.resueltaEl)}` : ''}
                            </Text>
                          </Text>
                        ))}
                      </Stack>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal opened={abierto} onClose={() => setAbierto(false)} title='Vincular un caso de SynerLink' radius='md'>
        <Stack gap='sm'>
          {error && (
            <Alert color='red' radius='md' icon={<IconAlertCircle size={18} />} title='No se vinculó'>
              {error}
            </Alert>
          )}
          <TextInput
            label='Número del caso'
            placeholder='6212'
            value={form.idRequest}
            onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, idRequest: v })); }}
          />
          <Select
            label='Relación con el agente'
            data={Object.entries(RELACION).map(([value, label]) => ({ value, label }))}
            value={form.relation}
            onChange={(v) => setForm((f) => ({ ...f, relation: v ?? 'gobierno-ia' }))}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          <Group justify='flex-end' gap='xs'>
            <Button size='xs' variant='default' onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button size='xs' loading={guardando} onClick={() => void vincular()}>
              Vincular
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

// ── Hallazgos de Gobierno IA ─────────────────────────────────────────────────

export function HallazgosGobiernoIA({
  c,
  code,
  puedeConfigurar,
  onAviso,
  onRecargar,
}: {
  c: Completa;
  code: string;
  puedeConfigurar: boolean;
  onAviso: (a: Aviso) => void;
  onRecargar: () => Promise<void>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hoy = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
  const vacio = { refCode: '', severity: 'alto', title: '', detail: '', recommendation: '', reportedOn: hoy, idRequest: '' };
  const [form, setForm] = useState(vacio);
  const casoGob = c.casos.find((x) => x.relation === 'gobierno-ia');
  const tareaIvan = casoGob?.tareas.find((t) => /auditor/i.test(t.tarea)) ?? null;

  const registrar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const r = await enviar(`/api/chat/auditoria/hoja-de-vida/${encodeURIComponent(code)}/hallazgos`, 'POST', form);
      if (!r.ok) {
        setError(String(r.data.error));
        return;
      }
      setAbierto(false);
      onAviso({ color: 'green', titulo: 'Hallazgo registrado', texto: `El hallazgo ${form.refCode.toUpperCase()} quedó abierto en la hoja de vida.` });
      await onRecargar();
    } catch {
      setError('No hubo respuesta del servidor. Revise su conexión e intente de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  const cambiar = async (id: number, ref: string, status: string) => {
    const r = await enviar(`/api/chat/auditoria/hoja-de-vida/${encodeURIComponent(code)}/hallazgos/${id}`, 'PATCH', { status }).catch(() => null);
    if (!r || !r.ok) {
      onAviso({ color: 'red', titulo: 'No se cambió el hallazgo', texto: String(r?.data.error ?? 'No hubo respuesta del servidor.') });
      return;
    }
    onAviso({
      color: 'green',
      titulo: 'Hallazgo actualizado',
      texto: `${ref} quedó como «${ESTADO_EXTERNO[status]?.label ?? status}». El cambio quedó en el historial.`,
    });
    await onRecargar();
  };

  return (
    <Card withBorder radius='md' padding='md' className='chat-surface' data-testid='hv-hallazgos-externos'>
      <Group justify='space-between' mb={6} wrap='wrap' gap='xs'>
        <Text fw={600} size='sm'>
          Hallazgos de Gobierno IA ({c.hallazgosExternos.filter((h) => h.status === 'abierto').length} abiertos)
        </Text>
        {puedeConfigurar && (
          <Button
            size='xs'
            variant='light'
            leftSection={<IconPlus size={14} />}
            onClick={() => {
              setForm({ ...vacio, idRequest: casoGob ? String(casoGob.idRequest) : '' });
              setError(null);
              setAbierto(true);
            }}
          >
            Registrar hallazgo
          </Button>
        )}
      </Group>
      {tareaIvan && (
        <Text size='xs' c='dimmed' mb={6}>
          Auditoría de seguridad del caso #{casoGob?.idRequest}: {tareaIvan.estado ?? 'sin estado'}
          {tareaIvan.responsable ? ` (${tareaIvan.responsable})` : ''}.
        </Text>
      )}
      {c.hallazgosExternos.length === 0 ? (
        <Text size='xs' c='dimmed'>
          Gobierno IA todavía no ha reportado hallazgos para este agente. Los automáticos del inventario están en la
          tarjeta de al lado.
        </Text>
      ) : (
        <Stack gap={6}>
          {c.hallazgosExternos.map((h) => (
            <div key={h.id}>
              <Group gap={6} wrap='nowrap' align='flex-start'>
                <Badge size='xs' variant={h.status === 'abierto' ? 'filled' : 'light'} color={COLOR_SEVERIDAD[h.severity] ?? 'gray'}>
                  {NOMBRE_SEVERIDAD[h.severity] ?? h.severity}
                </Badge>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Tooltip label={h.detail ?? h.title} withArrow multiline w={360} disabled={!h.detail}>
                    <Text size='xs' fw={600}>
                      {h.refCode} · {h.title}
                    </Text>
                  </Tooltip>
                  {h.recommendation && (
                    <Text size='xs' c='dimmed'>
                      Recomendación: {h.recommendation}
                    </Text>
                  )}
                  <Text size='xs' c='dimmed'>
                    {h.source} · {fechaCorta(h.reportedOn)}
                    {h.idRequest ? ` · caso #${h.idRequest}` : ''}
                    {h.resolvedOn ? ` · cerrado ${fechaCorta(h.resolvedOn)}` : ''}
                  </Text>
                </div>
                <Badge size='xs' variant='light' color={ESTADO_EXTERNO[h.status]?.color ?? 'gray'} style={{ flexShrink: 0 }}>
                  {ESTADO_EXTERNO[h.status]?.label ?? h.status}
                </Badge>
              </Group>
              {puedeConfigurar && (
                <Group gap={4} mt={2} ml={52}>
                  {h.status === 'abierto' ? (
                    <>
                      <Button size='compact-xs' variant='subtle' onClick={() => void cambiar(h.id, h.refCode, 'resuelto')}>
                        Marcar resuelto
                      </Button>
                      <Button size='compact-xs' variant='subtle' color='gray' onClick={() => void cambiar(h.id, h.refCode, 'aceptado')}>
                        Aceptar riesgo
                      </Button>
                    </>
                  ) : (
                    <Button size='compact-xs' variant='subtle' color='gray' onClick={() => void cambiar(h.id, h.refCode, 'abierto')}>
                      Reabrir
                    </Button>
                  )}
                </Group>
              )}
            </div>
          ))}
        </Stack>
      )}

      <Modal opened={abierto} onClose={() => setAbierto(false)} title='Registrar hallazgo de Gobierno IA' radius='md' size='lg'>
        <Stack gap='sm'>
          {error && (
            <Alert color='red' radius='md' icon={<IconAlertCircle size={18} />} title='No se registró'>
              {error}
            </Alert>
          )}
          <Group grow>
            <TextInput label='Código' placeholder='H-01' maxLength={40} value={form.refCode} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, refCode: v })); }} />
            <Select
              label='Severidad'
              data={Object.entries(NOMBRE_SEVERIDAD).map(([value, label]) => ({ value, label }))}
              value={form.severity}
              onChange={(v) => setForm((f) => ({ ...f, severity: v ?? 'alto' }))}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />
          </Group>
          <TextInput label='Hallazgo' maxLength={300} value={form.title} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, title: v })); }} />
          <Textarea label='Detalle y evidencia' autosize minRows={2} maxLength={2000} value={form.detail} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, detail: v })); }} />
          <Textarea label='Recomendación' autosize minRows={2} maxLength={1000} value={form.recommendation} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, recommendation: v })); }} />
          <Group grow>
            <TextInput label='Fecha del informe' placeholder='AAAA-MM-DD' maxLength={10} value={form.reportedOn} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, reportedOn: v })); }} />
            <TextInput label='Caso (opcional)' placeholder='6212' value={form.idRequest} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, idRequest: v })); }} />
          </Group>
          <Group justify='flex-end' gap='xs'>
            <Button size='xs' variant='default' onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button size='xs' loading={guardando} onClick={() => void registrar()}>
              Registrar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}
