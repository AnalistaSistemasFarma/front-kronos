'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Autocomplete, Badge, Button, Card, Checkbox, Group, Loader, Modal, Stack, Text, Textarea } from '@mantine/core';
import { IconAlertTriangle, IconInfoCircle, IconPlus, IconSpeakerphone, IconX } from '@tabler/icons-react';
import SgcSelect, { sgcTouchComboboxProps } from './SgcSelect';
import { sgcHref } from './useSgcCompany';
import { sgcSend, useSgcFetch } from './useSgcFetch';
import { SGC_BASE_URL } from '../../lib/sgc/constants';
import { SGC_SCOPE_KIND_LABELS, isPersonEmail, personEmailFromInput, type SgcScopeKind } from '../../lib/sgc/dissemination/scope';
import type { SgcRedisseminationPreview } from '../../lib/sgc/db/requests';

/**
 * REDIVULGAR un documento vigente (2026-10-26, Nicolás Rivera): solo
 * Aseguramiento de Calidad. Se arma el alcance (toda la empresa,
 * departamentos, cargos o personas) y el motivo; la vista previa dice cuántas
 * personas recibirán la lectura y, como ALERTA, cuántas ya leyeron y firmaron
 * esta versión y les vuelve a aparecer. Si hay alguna, Calidad debe confirmarlo.
 * La versión no cambia: se divulga la misma versión vigente.
 */

type Entry = { kind: SgcScopeKind; idDepartment?: number; idCargo?: number; email?: string; label: string };

export default function SgcRedisseminationModal({ opened, onClose, idCompany, idDocument, code, versionNumber }: { opened: boolean; onClose: () => void; idCompany: number; idDocument: number; code: string; versionNumber: number | null }) {
  const router = useRouter();
  const catalogs = useSgcFetch<{ departments: { id: number; name: string }[] }>(opened ? `/api/sgc/catalogs?company=${idCompany}` : null);
  const cargos = useSgcFetch<{ cargos: { id: number; name: string }[] }>(opened ? `/api/sgc/cargo-members?company=${idCompany}` : null);
  const users = useSgcFetch<{ users: { email: string; name: string | null }[] }>(opened ? `/api/sgc/users?company=${idCompany}` : null);
  const userOptions = useMemo(() => (users.data?.users ?? []).map((u) => ({ value: u.email, label: u.name ? `${u.name} (${u.email})` : u.email })), [users.data]);
  const [kind, setKind] = useState<SgcScopeKind>('departamento');
  const [target, setTarget] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState<SgcRedisseminationPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setEntries([]);
    setReason('');
    setConfirm(false);
    setPreview(null);
    setError(null);
  }, [opened]);

  const payloadEntries = entries.map((e) => (e.kind === 'departamento' ? { kind: e.kind, idDepartment: e.idDepartment } : e.kind === 'cargo' ? { kind: e.kind, idCargo: e.idCargo } : e.kind === 'persona' ? { kind: e.kind, email: e.email } : { kind: e.kind }));

  // La vista previa (y la alerta) se recalcula cada vez que cambia el alcance.
  useEffect(() => {
    if (!opened || entries.length === 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setConfirm(false);
    sgcSend<SgcRedisseminationPreview>(`/api/sgc/documents/${idDocument}/redissemination`, 'POST', { company: idCompany, action: 'vista_previa', entries: payloadEntries })
      .then((p) => !cancelled && (setPreview(p), setError(null)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [opened, entries, idDocument, idCompany]);

  const targetOptions =
    kind === 'departamento'
      ? (catalogs.data?.departments ?? []).map((d) => ({ value: String(d.id), label: d.name }))
      : kind === 'cargo'
        ? (cargos.data?.cargos ?? []).map((x) => ({ value: String(x.id), label: x.name }))
        : [];

  const canAdd = kind === 'empresa' || (kind === 'persona' ? isPersonEmail(email, userOptions) : Boolean(target));
  const add = () => {
    let entry: Entry;
    if (kind === 'empresa') entry = { kind, label: SGC_SCOPE_KIND_LABELS.empresa };
    else if (kind === 'persona') {
      const value = personEmailFromInput(email, userOptions);
      entry = { kind, email: value, label: `Persona · ${value}` };
    } else {
      const label = targetOptions.find((o) => o.value === target)?.label ?? target ?? '';
      entry = kind === 'departamento' ? { kind, idDepartment: Number(target), label: `Departamento · ${label}` } : { kind, idCargo: Number(target), label: `Cargo · ${label}` };
    }
    if (!entries.some((e) => e.label === entry.label)) setEntries([...entries, entry]);
    setTarget(null);
    setEmail('');
  };

  const needsConfirm = (preview?.alreadyRead ?? 0) > 0;
  const ready = Boolean(preview) && preview!.readers > 0 && !preview!.openRequest && reason.trim().length >= 10 && (!needsConfirm || confirm) && !loading;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await sgcSend<{ idRequest: number }>(`/api/sgc/documents/${idDocument}/redissemination`, 'POST', { company: idCompany, action: 'crear', entries: payloadEntries, reason, confirmRepeat: needsConfirm ? confirm : undefined });
      onClose();
      router.push(sgcHref(`${SGC_BASE_URL}/solicitudes/${res.idRequest}`, idCompany));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={`Redivulgar ${code}${versionNumber ? ` V${versionNumber}` : ''}`} size='lg' data-testid='sgc-redivulgar'>
      <Stack gap='sm'>
        <Alert color='blue' icon={<IconInfoCircle size={18} />}>
          <Text size='sm'>
            Se vuelve a divulgar la <b>versión vigente</b> (no se crea una versión nueva ni se firma otra vez). Cada persona del alcance recibe su tarea de lectura obligatoria con firma «Leyó», <b>aunque ya la hubiera leído antes</b>.
          </Text>
        </Alert>
        {error && (
          <Alert color='red' icon={<IconAlertTriangle size={18} />} withCloseButton onClose={() => setError(null)} data-testid='sgc-redivulgar-error'>
            {error}
          </Alert>
        )}

        <Card withBorder radius='md' p='md'>
          <Group align='flex-end' wrap='wrap'>
            <SgcSelect
              label='Agregar al alcance'
              data={(Object.keys(SGC_SCOPE_KIND_LABELS) as SgcScopeKind[]).map((k) => ({ value: k, label: SGC_SCOPE_KIND_LABELS[k] }))}
              value={kind}
              onChange={(v) => {
                setKind((v as SgcScopeKind) ?? 'departamento');
                setTarget(null);
              }}
              allowDeselect={false}
              w={180}
              data-testid='sgc-redivulgar-clase'
            />
            {(kind === 'departamento' || kind === 'cargo') && <SgcSelect label={kind === 'departamento' ? 'Departamento' : 'Cargo'} data={targetOptions} value={target} onChange={setTarget} searchable w={260} data-testid='sgc-redivulgar-destino' />}
            {kind === 'persona' && <Autocomplete comboboxProps={sgcTouchComboboxProps()} autoComplete='off' data-1p-ignore='true' data-lpignore='true' label='Correo de la persona' data={userOptions} value={email} onChange={setEmail} w={280} data-testid='sgc-redivulgar-persona' />}
            <Button leftSection={<IconPlus size={14} />} disabled={!canAdd} onClick={add} data-testid='sgc-redivulgar-agregar'>
              Agregar
            </Button>
          </Group>
          {entries.length > 0 && (
            <Group gap='xs' mt='sm'>
              {entries.map((e) => (
                <Badge
                  key={e.label}
                  variant='light'
                  size='lg'
                  radius='sm'
                  rightSection={<IconX size={12} style={{ cursor: 'pointer' }} onClick={() => setEntries(entries.filter((x) => x.label !== e.label))} />}
                  data-testid='sgc-redivulgar-entrada'
                >
                  {e.label}
                </Badge>
              ))}
            </Group>
          )}
        </Card>

        {loading && (
          <Group gap='xs'>
            <Loader size='sm' />
            <Text size='sm' c='dimmed'>
              Calculando quién recibe la lectura…
            </Text>
          </Group>
        )}
        {preview && !loading && (
          <>
            {preview.openRequest && (
              <Alert color='orange' icon={<IconAlertTriangle size={18} />}>
                Este documento ya tiene la redivulgación #{preview.openRequest} en curso: amplíe su alcance desde esa solicitud o ciérrela primero.
              </Alert>
            )}
            <Text size='sm' data-testid='sgc-redivulgar-lectores'>
              <b>{preview.readers}</b> persona(s) recibirán la tarea de lectura de {preview.code} V{preview.versionNumber}.
            </Text>
            {needsConfirm && (
              <Alert color='yellow' icon={<IconAlertTriangle size={18} />} title='A quienes ya la leyeron les vuelve a aparecer' data-testid='sgc-redivulgar-alerta'>
                <Stack gap={6}>
                  <Text size='sm'>
                    <b>{preview.alreadyRead}</b> persona(s) del alcance ya leyeron y firmaron la versión {preview.versionNumber}. A todas les volverá a aparecer la lectura pendiente y recibirán el aviso.
                  </Text>
                  {preview.alreadyReadEmails.length > 0 && (
                    <Text size='xs' c='dimmed'>
                      {preview.alreadyReadEmails.slice(0, 15).join(', ')}
                      {preview.alreadyRead > 15 ? ` y ${preview.alreadyRead - 15} más` : ''}
                    </Text>
                  )}
                  <Checkbox label='Entiendo: a estas personas se les vuelve a pedir la lectura.' checked={confirm} onChange={(e) => setConfirm(e.currentTarget.checked)} data-testid='sgc-redivulgar-confirmar' />
                </Stack>
              </Alert>
            )}
            {preview.withoutAccess.length > 0 && (
              <Text size='xs' c='dimmed'>
                {preview.withoutAccess.length} persona(s) del alcance no tienen acceso al SGC y no recibirán tarea: {preview.withoutAccess.slice(0, 10).join(', ')}
                {preview.withoutAccess.length > 10 ? '…' : ''}
              </Text>
            )}
          </>
        )}

        <Textarea
          autoComplete='off'
          data-1p-ignore='true'
          data-lpignore='true'
          label='Motivo de la redivulgación'
          description='Por ejemplo: personal nuevo, reinducción, hallazgo de auditoría o documento de la carga inicial sin divulgar. Queda en el historial y la auditoría.'
          autosize
          minRows={2}
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          data-testid='sgc-redivulgar-motivo'
        />

        <Group justify='flex-end' mt='sm'>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button leftSection={<IconSpeakerphone size={16} />} disabled={!ready} loading={busy} onClick={() => void create()} data-testid='sgc-redivulgar-crear'>
            Redivulgar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
