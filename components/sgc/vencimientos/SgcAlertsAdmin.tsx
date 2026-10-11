'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, Loader, Modal, NumberInput, Stack, Switch, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import SgcSelect from '../SgcSelect';
import { IconAlertTriangle, IconCheck, IconPlayerPlay, IconPlus } from '@tabler/icons-react';
import { sgcSend, useSgcFetch } from '../useSgcFetch';
import type { SgcCatalogs } from '../../../lib/sgc/db/catalogs';
import type { SgcCompanyAccess } from '../../../lib/sgc/permissions';
import { SGC_DEFAULT_ALERT_OFFSETS } from '../../../lib/sgc/reviewAlerts';
import type { SgcCalendarResponse } from './SgcReviewCalendar';

/**
 * Vista de CALIDAD de los vencimientos: configuración de los avisos
 * anticipados (empresa, por tipo documental y, excepcionalmente, por
 * documento), registro de avisos enviados y omitidos, estado del programador y
 * ejecución manual (idempotente).
 */

interface ConfigRow {
  id: number;
  scope: 'empresa' | 'tipo' | 'documento';
  scopeKey: string;
  idDocumentType: number | null;
  idDocument: number | null;
  offsets: number[];
  overdueEveryDays: number;
  readingReminderDays: number | null;
  emailEnabled: boolean;
  extraEmails: string[];
  isActive: boolean;
  reason: string;
  updatedBy: string;
  updatedAt: string;
}

interface AlertRow {
  id: number;
  idDocument: number;
  code: string;
  versionNumber: number;
  dueDate: string;
  kind: string;
  offsetDays: number;
  status: string;
  scheduledFor: string;
  runDate: string;
  runSource: string;
  recipients: { email: string; roles: string[] }[];
  channels: { email: string; campana: string; correo: string }[];
  sentAt: string | null;
}

type Form = { scope: string; idDocumentType: string | null; idDocument: string | null; offsets: string; overdueEveryDays: number; readingReminderDays: number; emailEnabled: boolean; extraEmails: string; isActive: boolean; reason: string };

const KIND: Record<string, string> = { anticipado: 'Anticipado', vencimiento: 'Día del vencimiento', vencido: 'Vencido (escalado)' };

export function SgcAlertConfigPanel({ company, calendar }: { company: SgcCompanyAccess; calendar: SgcCalendarResponse | null }) {
  const configs = useSgcFetch<{ configs: ConfigRow[] }>(`/api/sgc/review-alerts/config?company=${company.idCompany}`);
  const catalogs = useSgcFetch<SgcCatalogs>(`/api/sgc/catalogs?company=${company.idCompany}`);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ color: string; text: string } | null>(null);
  const [run, setRun] = useState<string | null>(null);

  const rows = configs.data?.configs ?? [];
  const types = catalogs.data?.documentTypes ?? [];
  const docs = calendar?.items ?? [];
  const label = (r: ConfigRow) =>
    r.scope === 'empresa' ? 'Empresa (general)' : r.scope === 'tipo' ? `Tipo ${types.find((t) => t.id === r.idDocumentType)?.code ?? r.idDocumentType}` : `Documento ${docs.find((d) => d.idDocument === r.idDocument)?.code ?? `#${r.idDocument}`}`;

  const edit = (r?: ConfigRow, scope = 'tipo') =>
    setForm({
      scope: r?.scope ?? scope,
      idDocumentType: r?.idDocumentType ? String(r.idDocumentType) : null,
      idDocument: r?.idDocument ? String(r.idDocument) : null,
      offsets: (r?.offsets ?? [...SGC_DEFAULT_ALERT_OFFSETS]).join(', '),
      overdueEveryDays: r?.overdueEveryDays ?? 7,
      readingReminderDays: r?.readingReminderDays ?? 7,
      emailEnabled: r?.emailEnabled ?? true,
      extraEmails: (r?.extraEmails ?? []).join(', '),
      isActive: r?.isActive ?? true,
      reason: '',
    });

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setFeedback(null);
    try {
      await sgcSend('/api/sgc/review-alerts/config', 'POST', {
        company: company.idCompany,
        scope: form.scope,
        idDocumentType: form.idDocumentType ? Number(form.idDocumentType) : undefined,
        idDocument: form.idDocument ? Number(form.idDocument) : undefined,
        offsets: form.offsets,
        overdueEveryDays: form.overdueEveryDays,
        readingReminderDays: form.readingReminderDays,
        emailEnabled: form.emailEnabled,
        extraEmails: form.extraEmails,
        isActive: form.isActive,
        reason: form.reason,
      });
      setFeedback({ color: 'green', text: 'Configuración guardada y registrada en la auditoría.' });
      setForm(null);
      configs.reload();
    } catch (e) {
      setFeedback({ color: 'red', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    setRun(null);
    try {
      const r = await sgcSend<{ summary: { sent: number; omitted: number; readingReminders: number; runDate: string } }>('/api/sgc/review-alerts/run', 'POST', { company: company.idCompany });
      setRun(`Avisos del ${r.summary.runDate}: ${r.summary.sent} enviado(s), ${r.summary.omitted} omitido(s), ${r.summary.readingReminders} recordatorio(s) de lectura. Lo que ya salió hoy no se repite.`);
    } catch (e) {
      setRun(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sched = calendar?.scheduler ?? null;
  return (
    <Stack gap='md'>
      {feedback && (
        <Alert color={feedback.color} withCloseButton onClose={() => setFeedback(null)} icon={feedback.color === 'green' ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />} data-testid='sgc-feedback'>
          {feedback.text}
        </Alert>
      )}
      <Card withBorder radius='md' p='md'>
        <Group justify='space-between' wrap='wrap'>
          <div>
            <Title order={5}>Programador de avisos</Title>
            {sched ? (
              <Text size='sm' data-testid='sgc-programador'>
                Job «sgc_review_alerts» {sched.active ? 'activo' : 'INACTIVO'} · cron {sched.cron} · próxima corrida {sched.nextRun?.slice(0, 16).replace('T', ' ') ?? '—'} · última {sched.lastRun?.slice(0, 16).replace('T', ' ') ?? '—'} ({sched.lastStatus ?? 'sin corridas'})
              </Text>
            ) : (
              <Text size='sm' c='red' data-testid='sgc-programador'>
                No está registrado el job del programador: los avisos solo salen con «Ejecutar ahora».
              </Text>
            )}
          </div>
          <Button leftSection={<IconPlayerPlay size={16} />} loading={busy} onClick={runNow} data-testid='sgc-avisos-ejecutar'>
            Ejecutar ahora
          </Button>
        </Group>
        {run && (
          <Text size='sm' mt='xs' data-testid='sgc-avisos-resultado'>
            {run}
          </Text>
        )}
      </Card>
      <Card withBorder radius='md' p='md'>
        <Group justify='space-between' mb='sm'>
          <Title order={5}>Avisos anticipados</Title>
          <Group gap='xs'>
            <Button size='xs' variant='light' leftSection={<IconPlus size={14} />} onClick={() => edit(undefined, 'tipo')}>
              Por tipo documental
            </Button>
            <Button size='xs' variant='light' leftSection={<IconPlus size={14} />} onClick={() => edit(undefined, 'documento')}>
              Por documento (excepción)
            </Button>
          </Group>
        </Group>
        <Text size='xs' c='dimmed' mb='sm'>
          Por defecto se avisa a 60, 30, 15 y 7 días y el día del vencimiento al dueño del proceso, al último elaborador y a Calidad. Gana lo más específico: documento,
          luego tipo documental, luego empresa. Un vencido sigue vigente y se repite el aviso escalado a Calidad.
        </Text>
        {configs.loading && !configs.data ? (
          <Loader size='sm' />
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing='xs' data-testid='sgc-avisos-config'>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Alcance</Table.Th>
                  <Table.Th>Días antes</Table.Th>
                  <Table.Th>Vencido cada</Table.Th>
                  <Table.Th>Correo</Table.Th>
                  <Table.Th>Adicionales</Table.Th>
                  <Table.Th>Último cambio</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={7}>
                      <Text size='sm' c='dimmed'>
                        Sin configuración: se usan los avisos por defecto.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
                {rows.map((r) => (
                  <Table.Tr key={r.id} style={{ opacity: r.isActive ? 1 : 0.5 }}>
                    <Table.Td>
                      <Text size='sm'>{label(r)}</Text>
                      {!r.isActive && <Badge size='xs' color='gray'>Inactiva</Badge>}
                    </Table.Td>
                    <Table.Td>
                      <Text size='sm' ff='monospace'>
                        {r.offsets.join(', ')}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size='sm'>{r.overdueEveryDays} días</Text>
                    </Table.Td>
                    <Table.Td>{r.scope === 'empresa' ? <Badge size='xs' color={r.emailEnabled ? 'green' : 'gray'}>{r.emailEnabled ? 'Encendido' : 'Apagado'}</Badge> : '—'}</Table.Td>
                    <Table.Td>
                      <Text size='xs'>{r.extraEmails.join(', ') || '—'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size='xs'>{r.reason}</Text>
                      <Text size='xs' c='dimmed'>
                        {r.updatedBy} · {r.updatedAt.slice(0, 10)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Button size='xs' variant='subtle' onClick={() => edit(r)}>
                        Editar
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      <Modal opened={!!form} onClose={() => setForm(null)} title='Avisos de vencimiento' centered>
        {form && (
          <Stack>
            {form.scope === 'tipo' && (
              <SgcSelect label='Tipo documental' data={types.map((t) => ({ value: String(t.id), label: `${t.code} · ${t.name}` }))} value={form.idDocumentType} onChange={(v) => setForm({ ...form, idDocumentType: v })} required />
            )}
            {form.scope === 'documento' && (
              <SgcSelect label='Documento' searchable data={docs.map((d) => ({ value: String(d.idDocument), label: `${d.code} · ${d.title}` }))} value={form.idDocument} onChange={(v) => setForm({ ...form, idDocument: v })} required data-testid='sgc-avisos-documento' />
            )}
            <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Días de aviso antes del vencimiento' description='Separados por coma; 0 = el día del vencimiento.' value={form.offsets} onChange={(e) => setForm({ ...form, offsets: e.currentTarget.value })} data-testid='sgc-avisos-dias' />
            <NumberInput label='Repetir el aviso de vencido cada (días)' min={1} max={90} value={form.overdueEveryDays} onChange={(v) => setForm({ ...form, overdueEveryDays: Number(v) || 1 })} />
            {form.scope === 'empresa' && (
              <>
                <NumberInput label='Recordatorio automático de lectura cada (días)' description='0 = apagado.' min={0} max={60} value={form.readingReminderDays} onChange={(v) => setForm({ ...form, readingReminderDays: Number(v) || 0 })} />
                <Switch label='Enviar también por correo' checked={form.emailEnabled} onChange={(e) => setForm({ ...form, emailEnabled: e.currentTarget.checked })} />
              </>
            )}
            <TextInput autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Destinatarios adicionales' description='Correos separados por coma (además del dueño, el elaborador y Calidad).' value={form.extraEmails} onChange={(e) => setForm({ ...form, extraEmails: e.currentTarget.value })} />
            {form.scope !== 'empresa' && <Switch label='Activa' checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.currentTarget.checked })} />}
            <Textarea autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Motivo del cambio' description='Queda en la auditoría (mínimo 10 caracteres).' value={form.reason} onChange={(e) => setForm({ ...form, reason: e.currentTarget.value })} data-testid='sgc-avisos-motivo' />
            <Button loading={busy} onClick={save} data-testid='sgc-avisos-guardar'>
              Guardar
            </Button>
          </Stack>
        )}
      </Modal>
      {rows.every((r) => r.scope !== 'empresa') && (
        <Button variant='subtle' size='xs' onClick={() => edit(undefined, 'empresa')}>
          Configurar los avisos generales de la empresa
        </Button>
      )}
    </Stack>
  );
}

export function SgcAlertLogPanel({ company }: { company: SgcCompanyAccess }) {
  const log = useSgcFetch<{ alerts: AlertRow[] }>(`/api/sgc/review-alerts/log?company=${company.idCompany}`);
  if (log.error) return <Alert color='red'>{log.error}</Alert>;
  if (!log.data) return <Loader size='sm' />;
  return (
    <Card withBorder radius='md' p='md'>
      <Group justify='space-between' mb='sm'>
        <Title order={5}>Registro de avisos</Title>
        <Button size='xs' variant='default' onClick={log.reload}>
          Actualizar
        </Button>
      </Group>
      <Text size='xs' c='dimmed' mb='sm'>
        Cada aviso sale una sola vez. «Omitido» = su día pasó sin que corriera el programador; en su lugar salió el más urgente. El detalle por persona y canal también
        queda en la auditoría.
      </Text>
      <Table.ScrollContainer minWidth={820}>
        <Table verticalSpacing='xs' data-testid='sgc-avisos-registro'>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Corrida</Table.Th>
              <Table.Th>Documento</Table.Th>
              <Table.Th>Vence</Table.Th>
              <Table.Th>Aviso</Table.Th>
              <Table.Th>Estado</Table.Th>
              <Table.Th>Para · canal</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {log.data.alerts.map((a) => (
              <Table.Tr key={a.id} data-testid='sgc-aviso-fila' data-code={a.code} data-kind={a.kind} data-offset={a.offsetDays} data-status={a.status}>
                <Table.Td>
                  <Text size='xs'>{a.runDate}</Text>
                  <Text size='xs' c='dimmed'>
                    {a.runSource}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size='sm' ff='monospace'>
                    {a.code} V{a.versionNumber}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size='sm'>{a.dueDate}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size='sm'>
                    {KIND[a.kind] ?? a.kind} · {a.kind === 'vencido' ? `+${a.offsetDays}` : `−${a.offsetDays}`} d
                  </Text>
                  <Text size='xs' c='dimmed'>
                    tocaba {a.scheduledFor}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge size='xs' color={a.status === 'enviado' ? 'green' : 'gray'}>
                    {a.status}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {a.channels.map((c) => (
                    <Text key={c.email} size='xs'>
                      {c.email} · campana {c.campana} · correo {c.correo}
                    </Text>
                  ))}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}

export function SgcIcalCard({ company }: { company: SgcCompanyAccess }) {
  const status = useSgcFetch<{ active: boolean; createdAt: string | null; lastUsedAt: string | null; useCount: number }>(`/api/sgc/ical?company=${company.idCompany}`);
  const [link, setLink] = useState<{ url: string; webcal: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setLink(await sgcSend<{ url: string; webcal: string }>('/api/sgc/ical', 'POST', { company: company.idCompany }));
      status.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sgc/ical?company=${company.idCompany}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `Error ${res.status}`);
      setLink(null);
      status.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card withBorder radius='md' p='md'>
      <Title order={5}>Suscribir en Outlook (iCal privado)</Title>
      <Text size='sm' c='dimmed' mt={4}>
        Un enlace personal de solo lectura con sus vencimientos (los documentos que usted puede consultar). En Outlook: Agregar calendario → Suscribirse desde la web.
        Trátelo como una contraseña: quien lo tenga ve sus vencimientos. Un documento confidencial aparece solo con su código.
      </Text>
      {error && (
        <Alert color='red' mt='sm'>
          {error}
        </Alert>
      )}
      {link && (
        <Alert color='green' mt='sm' title='Copie el enlace ahora: no se vuelve a mostrar' data-testid='sgc-ical-enlace'>
          <Text size='xs' ff='monospace' style={{ wordBreak: 'break-all' }}>
            {link.url}
          </Text>
        </Alert>
      )}
      <Group mt='sm'>
        <Button size='xs' loading={busy} onClick={create} data-testid='sgc-ical-crear'>
          {status.data?.active ? 'Generar un enlace nuevo (revoca el anterior)' : 'Generar mi enlace'}
        </Button>
        {status.data?.active && (
          <Button size='xs' variant='light' color='red' loading={busy} onClick={revoke} data-testid='sgc-ical-revocar'>
            Revocar
          </Button>
        )}
        {status.data?.active && (
          <Text size='xs' c='dimmed'>
            Activo desde {status.data.createdAt?.slice(0, 10)} · consultado {status.data.useCount} vez/veces
          </Text>
        )}
      </Group>
    </Card>
  );
}

/** Avisos de vencimiento de UN documento (en su ficha, solo Calidad). */
export function SgcDocumentAlertsCard({ idDocument, idCompany }: { idDocument: number; idCompany: number }) {
  const log = useSgcFetch<{ alerts: AlertRow[] }>(`/api/sgc/review-alerts/log?company=${idCompany}&document=${idDocument}`);
  const alerts = log.data?.alerts ?? [];
  return (
    <Card withBorder radius='md' p='lg' shadow='xs' data-testid='sgc-ficha-avisos'>
      <Title order={4} mb='sm'>
        Avisos de vencimiento
      </Title>
      {alerts.length === 0 ? (
        <Text size='sm' c='dimmed'>
          Aún no ha salido ningún aviso para este documento.
        </Text>
      ) : (
        <Stack gap={4}>
          {alerts.map((a) => (
            <Text key={a.id} size='sm'>
              {a.runDate} · V{a.versionNumber} · {KIND[a.kind] ?? a.kind} ({a.kind === 'vencido' ? `+${a.offsetDays}` : `−${a.offsetDays}`} d) ·{' '}
              <Badge size='xs' color={a.status === 'enviado' ? 'green' : 'gray'}>
                {a.status}
              </Badge>{' '}
              {a.recipients.map((r) => r.email).join(', ')}
            </Text>
          ))}
        </Stack>
      )}
    </Card>
  );
}
