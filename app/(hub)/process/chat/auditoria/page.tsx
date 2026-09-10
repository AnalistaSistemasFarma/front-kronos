'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Group,
  Loader,
  Pagination,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconLock,
  IconShieldSearch,
} from '@tabler/icons-react';

/**
 * AUDITORÍA DE AGENTES — quién le escribió a cada asistente, desde dónde, qué
 * le dijo, qué respondió y cuánto costó.
 *
 * Pedido de Nicolás (2026-09-10): "necesito que el conector de synerlink
 * registre las conversaciones, esto por auditoría de permisos… también el
 * consumo en tokens y la respuesta que dió el agente… la ip de dónde enviaron
 * el mensaje y la hora". Y después: "quiero que sea un módulo asignable en
 * synerlink solo para administración".
 *
 * LA REJA ESTÁ EN EL ENDPOINT (/api/chat/auditoria). Aquí solo se pinta el
 * mensaje de "sin acceso": una pantalla escondida no es un permiso.
 *
 * EL TEXTO VIENE RECORTADO EN LA TABLA y se abre a pedido. Una auditoría se
 * lee de arriba hacia abajo buscando algo raro; con los mensajes completos
 * desplegados no se alcanza a ver ni diez filas.
 */

type MensajeAuditoria = {
  id: number;
  idConversation: number;
  role: string;
  body: string;
  createdAt: string;
  clientIp: string | null;
  userAgent: string | null;
  autor: string;
  autorEmail: string | null;
  adjuntos: string[];
  conversacion: {
    id: number;
    kind: string;
    title: string | null;
    agente: { idAgent: number; code: string; displayName: string };
    usuario: { name: string | null; email: string };
    empresa: string | null;
  };
};

type ConsumoConversacion = {
  idConversation: number;
  turnos: number;
  totalTokens: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  thinkingTokens: number;
};

type Respuesta = {
  page: number;
  porPagina: number;
  total: number;
  totalPaginas: number;
  agentes: { idAgent: number; code: string; displayName: string }[];
  mensajes: MensajeAuditoria[];
  consumo: ConsumoConversacion[];
};

/** Cifras en formato latino: 1.000.000, no 1,000,000. */
function miles(n: number): string {
  return n.toLocaleString('es-CO');
}

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Hoy y hace 7 días, en YYYY-MM-DD, para el rango por defecto. */
function rangoPorDefecto(): { desde: string; hasta: string } {
  const hoy = new Date();
  const antes = new Date(hoy.getTime() - 7 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { desde: iso(antes), hasta: iso(hoy) };
}

/** Una fila de la tabla, con su texto plegable. */
function FilaMensaje({ m }: { m: MensajeAuditoria }) {
  const [abierto, setAbierto] = useState(false);
  const largo = m.body.length > 180;
  const texto = abierto || !largo ? m.body : `${m.body.slice(0, 180)}…`;

  return (
    <Table.Tr>
      <Table.Td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
        <Text size='xs'>{fechaHora(m.createdAt)}</Text>
        <Text size='xs' c='dimmed'>
          #{m.idConversation}
        </Text>
      </Table.Td>
      <Table.Td style={{ verticalAlign: 'top' }}>
        <Badge
          size='xs'
          variant='light'
          color={m.role === 'agent' ? 'blue' : m.role === 'system' ? 'gray' : 'teal'}
        >
          {m.role === 'agent' ? 'asistente' : m.role === 'system' ? 'sistema' : 'persona'}
        </Badge>
        <Text size='xs' fw={600} mt={4} lineClamp={2}>
          {m.autor}
        </Text>
        {m.autorEmail && (
          <Text size='xs' c='dimmed' lineClamp={1}>
            {m.autorEmail}
          </Text>
        )}
      </Table.Td>
      <Table.Td style={{ verticalAlign: 'top' }}>
        <Text size='xs' fw={600}>
          {m.conversacion.agente.displayName}
        </Text>
        {m.conversacion.empresa && (
          <Text size='xs' c='dimmed'>
            {m.conversacion.empresa}
          </Text>
        )}
        {m.conversacion.kind === 'group' && (
          <Badge size='xs' variant='light' color='grape' mt={4}>
            grupo
          </Badge>
        )}
      </Table.Td>
      <Table.Td style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
        {m.clientIp ? (
          <Tooltip label={m.userAgent ?? 'sin navegador declarado'} withArrow multiline w={320}>
            <Text size='xs' style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>
              {m.clientIp}
            </Text>
          </Tooltip>
        ) : (
          <Text size='xs' c='dimmed'>
            —
          </Text>
        )}
      </Table.Td>
      <Table.Td style={{ verticalAlign: 'top', minWidth: 320 }}>
        <Text size='xs' style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {texto}
        </Text>
        {m.adjuntos.length > 0 && (
          <Text size='xs' c='dimmed' mt={4}>
            📎 {m.adjuntos.join(', ')}
          </Text>
        )}
        {largo && (
          <ActionIcon
            variant='subtle'
            size='sm'
            mt={2}
            onClick={() => setAbierto((v) => !v)}
            aria-label={abierto ? 'Recoger' : 'Ver completo'}
          >
            {abierto ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          </ActionIcon>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

export default function AuditoriaAgentesPage() {
  const inicial = useMemo(rangoPorDefecto, []);
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [agente, setAgente] = useState<string | null>(null);
  const [usuario, setUsuario] = useState('');
  const [conversacion, setConversacion] = useState('');
  const [q, setQ] = useState('');
  const [conIp, setConIp] = useState(false);
  const [page, setPage] = useState(1);

  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);

  const consultar = useCallback(
    async (pagina: number) => {
      setCargando(true);
      setError(null);
      const sp = new URLSearchParams();
      if (desde) sp.set('desde', desde);
      if (hasta) sp.set('hasta', hasta);
      if (agente) sp.set('agente', agente);
      if (usuario.trim()) sp.set('usuario', usuario.trim());
      if (conversacion.trim()) sp.set('conversacion', conversacion.trim());
      if (q.trim()) sp.set('q', q.trim());
      if (conIp) sp.set('conIp', '1');
      sp.set('page', String(pagina));
      try {
        const res = await fetch(`/api/chat/auditoria?${sp.toString()}`);
        if (res.status === 403) {
          setSinPermiso(true);
          return;
        }
        if (!res.ok) {
          setError('No se pudo consultar la auditoría.');
          return;
        }
        setDatos(await res.json());
      } catch {
        setError('No se pudo consultar la auditoría.');
      } finally {
        setCargando(false);
      }
    },
    [desde, hasta, agente, usuario, conversacion, q, conIp]
  );

  useEffect(() => {
    // Solo al abrir: después se consulta con el botón o al cambiar de página.
    void consultar(1);
  }, []);

  const totales = useMemo(() => {
    const c = datos?.consumo ?? [];
    return {
      turnos: c.reduce((a, x) => a + x.turnos, 0),
      total: c.reduce((a, x) => a + x.totalTokens, 0),
      entrada: c.reduce((a, x) => a + x.inputTokens, 0),
      cacheCreacion: c.reduce((a, x) => a + x.cacheCreationTokens, 0),
      cacheLectura: c.reduce((a, x) => a + x.cacheReadTokens, 0),
      salida: c.reduce((a, x) => a + x.outputTokens, 0),
      razonamiento: c.reduce((a, x) => a + x.thinkingTokens, 0),
    };
  }, [datos]);

  /**
   * Exportar lo que está a la vista. Se arma en el navegador y no en el
   * servidor a propósito: es la página que quien audita está mirando, sin otra
   * consulta ni un endpoint más que proteger.
   *
   * Separador `;` y BOM: es lo que hace que Excel en español abra el archivo
   * en columnas sin pasar por el asistente de importación.
   */
  const exportar = () => {
    if (!datos || datos.mensajes.length === 0) return;
    const encabezado = [
      'Fecha y hora',
      'Conversación',
      'Tipo',
      'Autor',
      'Correo',
      'Asistente',
      'Empresa',
      'IP',
      'Navegador',
      'Mensaje',
      'Adjuntos',
    ];
    const escapar = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = datos.mensajes.map((m) =>
      [
        fechaHora(m.createdAt),
        `#${m.idConversation}`,
        m.role === 'agent' ? 'asistente' : m.role === 'system' ? 'sistema' : 'persona',
        m.autor,
        m.autorEmail ?? '',
        m.conversacion.agente.displayName,
        m.conversacion.empresa ?? '',
        m.clientIp ?? '',
        m.userAgent ?? '',
        m.body,
        m.adjuntos.join(' | '),
      ]
        .map(escapar)
        .join(';')
    );
    const csv = `﻿${[encabezado.map(escapar).join(';'), ...filas].join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `auditoria-agentes-${desde || 'inicio'}-a-${hasta || 'hoy'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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

  return (
    <div className='app-page-shell app-page-shell--fill ios-process-hub min-h-screen'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <Group gap='xs' mb={4}>
          <Link href='/process/chat' className='chat-text-muted' style={{ fontSize: 13 }}>
            <Group gap={4} wrap='nowrap'>
              <IconArrowLeft size={14} />
              <span>Volver a Chat</span>
            </Group>
          </Link>
        </Group>

        <Group gap='sm' mb={2} wrap='nowrap'>
          <IconShieldSearch size={26} className='chat-folder__icon' />
          <Title order={1} className='ios-process-hub__title text-3xl'>
            Auditoría de agentes
          </Title>
        </Group>
        <Text className='ios-process-hub__subtitle' mb='lg'>
          Quién le escribió a cada asistente, desde qué dirección, a qué hora, qué le dijo, qué
          respondió y cuánto consumió. La dirección queda registrada desde el momento en que se
          habilitó la auditoría; los mensajes anteriores aparecen sin ella.
        </Text>

        <Card withBorder radius='md' padding='md' mb='md' className='chat-surface'>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing='sm'>
            <TextInput
              label='Desde'
              type='date'
              size='xs'
              value={desde}
              onChange={(e) => setDesde(e.currentTarget.value)}
            />
            <TextInput
              label='Hasta'
              type='date'
              size='xs'
              value={hasta}
              onChange={(e) => setHasta(e.currentTarget.value)}
            />
            <Select
              label='Asistente'
              size='xs'
              placeholder='Todos'
              clearable
              value={agente}
              onChange={setAgente}
              data={(datos?.agentes ?? []).map((a) => ({
                value: String(a.idAgent),
                label: a.displayName,
              }))}
            />
            <TextInput
              label='Persona (nombre o correo)'
              size='xs'
              placeholder='Parte del nombre o del correo'
              value={usuario}
              onChange={(e) => setUsuario(e.currentTarget.value)}
            />
            <TextInput
              label='Conversación'
              size='xs'
              placeholder='Número'
              value={conversacion}
              onChange={(e) => setConversacion(e.currentTarget.value)}
            />
            <TextInput
              label='Contiene el texto'
              size='xs'
              placeholder='Palabra o frase'
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
            <Checkbox
              label='Solo con dirección registrada'
              size='xs'
              mt={22}
              checked={conIp}
              onChange={(e) => setConIp(e.currentTarget.checked)}
            />
            <Group mt={20} gap='xs'>
              <Button
                size='xs'
                loading={cargando}
                onClick={() => {
                  setPage(1);
                  void consultar(1);
                }}
              >
                Consultar
              </Button>
              <Button
                size='xs'
                variant='light'
                leftSection={<IconDownload size={14} />}
                onClick={exportar}
                disabled={!datos || datos.mensajes.length === 0}
              >
                Exportar
              </Button>
            </Group>
          </SimpleGrid>
        </Card>

        {error && (
          <Alert color='red' radius='md' icon={<IconAlertCircle size={18} />} mb='md'>
            {error}
          </Alert>
        )}

        {datos && (
          <Card withBorder radius='md' padding='md' mb='md' className='chat-surface'>
            <Text fw={600} size='sm' mb={6}>
              Consumo del período consultado
            </Text>
            <Group gap='xl' wrap='wrap'>
              <div>
                <Text size='xs' c='dimmed'>
                  Turnos reportados
                </Text>
                <Text fw={700}>{miles(totales.turnos)}</Text>
              </div>
              <div>
                <Text size='xs' c='dimmed'>
                  Tokens en total
                </Text>
                <Text fw={700}>{miles(totales.total)}</Text>
              </div>
              <div>
                <Text size='xs' c='dimmed'>
                  Entrada
                </Text>
                <Text>{miles(totales.entrada)}</Text>
              </div>
              <div>
                <Text size='xs' c='dimmed'>
                  Creación de caché
                </Text>
                <Text>{miles(totales.cacheCreacion)}</Text>
              </div>
              <div>
                <Text size='xs' c='dimmed'>
                  Lectura de caché
                </Text>
                <Text>{miles(totales.cacheLectura)}</Text>
              </div>
              <div>
                <Text size='xs' c='dimmed'>
                  Salida
                </Text>
                <Text>{miles(totales.salida)}</Text>
              </div>
              <div>
                <Text size='xs' c='dimmed'>
                  De la salida, razonamiento
                </Text>
                <Text>{miles(totales.razonamiento)}</Text>
              </div>
            </Group>
            <Text size='xs' c='dimmed' mt={8}>
              El consumo lo reporta cada asistente al cerrar su turno. Los renglones no cuestan lo
              mismo: la lectura de caché es una fracción del precio de la entrada normal. Un turno
              que atendió a dos personas a la vez se reporta completo en cada conversación, así que
              sumar por conversación puede contarlo dos veces.
            </Text>
          </Card>
        )}

        {cargando && !datos && (
          <Center py='xl'>
            <Loader size='sm' />
          </Center>
        )}

        {datos && (
          <>
            <Group justify='space-between' mb={6}>
              <Text size='sm' c='dimmed'>
                {miles(datos.total)} {datos.total === 1 ? 'mensaje' : 'mensajes'}
                {datos.total > datos.porPagina &&
                  ` · página ${datos.page} de ${datos.totalPaginas}`}
              </Text>
            </Group>

            <Card withBorder radius='md' padding={0} className='chat-surface' style={{ overflowX: 'auto' }}>
              <Table striped highlightOnHover verticalSpacing='xs' horizontalSpacing='sm'>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Fecha y hora</Table.Th>
                    <Table.Th>Quién</Table.Th>
                    <Table.Th>Asistente</Table.Th>
                    <Table.Th>Dirección</Table.Th>
                    <Table.Th>Mensaje</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {datos.mensajes.map((m) => (
                    <FilaMensaje key={m.id} m={m} />
                  ))}
                </Table.Tbody>
              </Table>
              {datos.mensajes.length === 0 && (
                <Text size='sm' c='dimmed' ta='center' py='xl'>
                  No hay mensajes en ese rango con esos filtros.
                </Text>
              )}
            </Card>

            {datos.totalPaginas > 1 && (
              <Group justify='center' mt='md'>
                <Pagination
                  size='sm'
                  value={page}
                  total={datos.totalPaginas}
                  onChange={(p) => {
                    setPage(p);
                    void consultar(p);
                  }}
                />
              </Group>
            )}
          </>
        )}
      </div>
    </div>
  );
}
