'use client';

/**
 * Cliente de API en pantalla completa: /process/api-sap/[id] y /process/api-sap/nuevo.
 * El tipo (agente / México / portal / otro) se elige dentro del formulario, en pastillas;
 * no hay pantalla intermedia vacía.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Skeleton, Stack } from '@mantine/core';
import { IconAlertCircle, IconArrowLeft } from '@tabler/icons-react';
import { panelStyles as ps } from '@/components/ui/panel/Panel';
import { API_CLIENT_SELECTABLE_TYPES, type ApiClientType } from '@/lib/api-permissions/constants';
import ApiClientModal from './ApiClientModal';
import { readApiClientsCache, writeApiClientsCache } from './apiClientsCache';
import s from './apiPermissions.module.css';
import type { ApiClientItem, ApiClientsResponse } from './types';

export const API_SAP_LIST_PATH = '/process/api-sap';

export function apiClientPath(clientId: number | 'nuevo', type?: ApiClientType): string {
  if (clientId === 'nuevo') return `${API_SAP_LIST_PATH}/nuevo${type ? `?tipo=${type}` : ''}`;
  return `${API_SAP_LIST_PATH}/${clientId}`;
}

interface Props {
  /** Número del cliente, o 'nuevo'. */
  clientParam: string;
  /** ?tipo= opcional al crear. */
  initialType?: string | null;
}

export default function ApiClientPage({ clientParam, initialType }: Props) {
  const router = useRouter();
  const isNew = clientParam === 'nuevo';
  const clientId = isNew ? null : Number(clientParam);
  const validId = isNew || (Number.isInteger(clientId) && (clientId as number) > 0);
  const type: ApiClientType = (API_CLIENT_SELECTABLE_TYPES as readonly string[]).includes(initialType ?? '')
    ? (initialType as ApiClientType)
    : 'agente';

  // Se pinta al instante con lo que ya cargó la lista; la recarga de abajo lo pone al día.
  const [data, setData] = useState<ApiClientsResponse | null>(() => readApiClientsCache());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/administration/api-clients', { cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as (ApiClientsResponse & { error?: string }) | null;
      if (res.status === 401 || res.status === 403) setData(null); // sin permiso: no se muestra lo guardado
      if (!res.ok || !body) throw new Error(body?.error || 'No se pudo cargar el cliente de API');
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el cliente de API');
    }
  }, []);

  useEffect(() => {
    if (validId) void load();
  }, [load, validId]);

  useEffect(() => {
    writeApiClientsCache(data);
  }, [data]);

  const client = useMemo(
    () => (clientId && data ? data.clients.find((c) => c.id === clientId) ?? null : null),
    [clientId, data]
  );

  /** Pone en memoria el cliente que devolvió el servidor (sin recargar todo). */
  const applyClient = useCallback(
    (updated: ApiClientItem | null | undefined) => {
      if (!updated) {
        void load();
        return;
      }
      setData((prev) => (prev ? { ...prev, clients: [...prev.clients.filter((c) => c.id !== updated.id), updated] } : prev));
    },
    [load]
  );

  const backToList = () => router.push(API_SAP_LIST_PATH);

  const notice = (message: string) => (
    <div className={`${ps.root} ${s.root} ${s.pageShell}`}>
      <div className={s.clientPageHeader} style={{ display: 'block' }}>
        <Stack gap='md' maw={640}>
          <Alert color='red' variant='light' icon={<IconAlertCircle size={18} />} title='No se pudo abrir el cliente'>
            {message}
          </Alert>
          <div>
            <Button variant='default' leftSection={<IconArrowLeft size={16} />} onClick={backToList}>
              Volver a la lista
            </Button>
          </div>
        </Stack>
      </div>
    </div>
  );

  if (!validId) return notice('La dirección no corresponde a un cliente de API.');

  // Si la recarga de fondo falla pero ya hay datos (y no fue por permisos: eso borra los datos), se sigue mostrando el cliente.
  if (error && !data) return notice(error);
  if (!data) {
    return (
      <div className={`${ps.root} ${s.root} ${s.pageShell}`} aria-busy>
        <div className={s.clientPageHeader} style={{ display: 'block' }}>
          <Skeleton height={14} width={180} mb={10} />
          <Skeleton height={30} width={260} mb={8} />
          <Skeleton height={14} width={120} mb={24} />
          <Stack gap='md'>
            <Skeleton height={160} radius={14} />
            <Skeleton height={90} radius={14} />
            <Skeleton height={320} radius={14} />
          </Stack>
        </div>
      </div>
    );
  }
  if (!isNew && !client) return notice('Este cliente de API no existe o ya fue eliminado.');

  return (
    <ApiClientModal
      variant='page'
      opened
      client={client}
      initialType={type}
      permissions={data.permissions}
      companies={data.companies}
      agents={data.agents}
      clients={data.clients}
      onClose={backToList}
      onSaved={(savedId, created, saved) => {
        applyClient(saved);
        // Al crear se pasa a la dirección del cliente nuevo para generar su llave ahí mismo.
        if (created) router.replace(apiClientPath(savedId));
      }}
      onKeysChanged={applyClient}
      onPermissionsCopied={() => void load()}
      onDeleted={backToList}
    />
  );
}
