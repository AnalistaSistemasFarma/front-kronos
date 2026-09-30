'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconLock,
  IconPuzzle,
  IconSearch,
} from '@tabler/icons-react';

/**
 * AUDITORÍA DE AGENTES → SKILLS — qué sabe hacer cada agente de la flota.
 *
 * Un skill es un paquete de instrucciones que un agente carga cuando la tarea
 * lo amerita (un informe, un cargue a SAP, un diseño con la marca). Esta vista
 * resume, en lenguaje llano, cada skill instalado en los equipos de la flota y
 * quién lo tiene.
 *
 * El catálogo se regenera con scripts/agent-skills-catalog.py; la reja está en
 * el endpoint (/api/chat/auditoria/skills), igual que en la auditoría.
 */

type AgenteSkill = { agent: string; host: string };
type Skill = { name: string; summary: string; category: string; agents: AgenteSkill[] };
type Catalogo = { generatedAt: string; skills: Skill[] };

const COLOR_CATEGORIA: Record<string, string> = {
  SAP: 'blue',
  Reportes: 'teal',
  Diseño: 'pink',
  Seguridad: 'red',
  SynerLink: 'indigo',
  Documentos: 'cyan',
  Finanzas: 'green',
  'Recursos Humanos': 'orange',
  'Ventas y Marketing': 'grape',
  'Datos y Analítica': 'violet',
  Desarrollo: 'dark',
  Productividad: 'yellow',
  'Flota/Infra': 'lime',
  Otros: 'gray',
};

/** "horus · Mac de Horus"; los globales dicen de qué equipo son. */
function etiquetaAgente(a: AgenteSkill): string {
  return `${a.agent} · ${a.host}`;
}

export default function AuditoriaSkillsPage() {
  const [datos, setDatos] = useState<Catalogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);
  const [q, setQ] = useState('');
  const [agente, setAgente] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/chat/auditoria/skills');
        if (res.status === 403) {
          setSinPermiso(true);
          return;
        }
        if (!res.ok) {
          setError('No se pudo consultar el catálogo de skills.');
          return;
        }
        setDatos(await res.json());
      } catch {
        setError('No se pudo consultar el catálogo de skills.');
      }
    })();
  }, []);

  const opcionesAgente = useMemo(() => {
    const set = new Set<string>();
    for (const s of datos?.skills ?? []) for (const a of s.agents) set.add(etiquetaAgente(a));
    return [...set].sort((a, b) => a.localeCompare(b, 'es'));
  }, [datos]);

  const opcionesCategoria = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const s of datos?.skills ?? []) cuenta.set(s.category, (cuenta.get(s.category) ?? 0) + 1);
    return [...cuenta.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => ({ value: c, label: `${c} (${n})` }));
  }, [datos]);

  const filtrados = useMemo(() => {
    const texto = q.trim().toLowerCase();
    return (datos?.skills ?? []).filter((s) => {
      if (categoria && s.category !== categoria) return false;
      if (agente && !s.agents.some((a) => etiquetaAgente(a) === agente)) return false;
      if (!texto) return true;
      return (
        s.name.toLowerCase().includes(texto) ||
        s.summary.toLowerCase().includes(texto) ||
        s.agents.some((a) => etiquetaAgente(a).toLowerCase().includes(texto))
      );
    });
  }, [datos, q, agente, categoria]);

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
          <Link href='/process/chat/auditoria' className='chat-text-muted' style={{ fontSize: 13 }}>
            <Group gap={4} wrap='nowrap'>
              <IconArrowLeft size={14} />
              <span>Volver a Auditoría de agentes</span>
            </Group>
          </Link>
        </Group>

        <Group gap='sm' mb={2} wrap='nowrap'>
          <IconPuzzle size={26} className='chat-folder__icon' />
          <Title order={1} className='ios-process-hub__title text-3xl'>
            Skills de la flota
          </Title>
        </Group>
        <Text className='ios-process-hub__subtitle' mb='lg'>
          Qué sabe hacer cada agente: los paquetes de instrucciones (skills) instalados en los
          equipos de la flota, con un resumen en lenguaje llano y los agentes que los tienen.
          {datos && ` Inventario del ${datos.generatedAt}.`}
        </Text>

        <Card withBorder radius='md' padding='md' mb='md' className='chat-surface'>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing='sm'>
            <TextInput
              label='Buscar'
              size='xs'
              placeholder='Nombre, resumen o agente'
              leftSection={<IconSearch size={14} />}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
            <Select
              label='Agente'
              size='xs'
              placeholder='Todos'
              clearable
              searchable
              value={agente}
              onChange={setAgente}
              data={opcionesAgente}
            />
            <Select
              label='Categoría'
              size='xs'
              placeholder='Todas'
              clearable
              value={categoria}
              onChange={setCategoria}
              data={opcionesCategoria}
            />
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
            <Text size='sm' c='dimmed' mb={6}>
              {filtrados.length} de {datos.skills.length} skills
            </Text>
            <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing='sm'>
              {filtrados.map((s) => (
                <Card key={s.name} withBorder radius='md' padding='md' className='chat-surface'>
                  <Group justify='space-between' wrap='nowrap' mb={6} align='flex-start'>
                    <Text
                      fw={700}
                      size='sm'
                      style={{ fontFamily: 'var(--mantine-font-family-monospace)', wordBreak: 'break-word' }}
                    >
                      {s.name}
                    </Text>
                    <Badge size='xs' variant='light' color={COLOR_CATEGORIA[s.category] ?? 'gray'}>
                      {s.category}
                    </Badge>
                  </Group>
                  <Text size='xs' mb='xs'>
                    {s.summary}
                  </Text>
                  <Group gap={4} wrap='wrap'>
                    {s.agents.map((a) => (
                      <Tooltip key={etiquetaAgente(a)} label={a.host} withArrow>
                        <Badge size='xs' variant='outline' color='gray'>
                          {a.agent}
                        </Badge>
                      </Tooltip>
                    ))}
                  </Group>
                </Card>
              ))}
            </SimpleGrid>
            {filtrados.length === 0 && (
              <Text size='sm' c='dimmed' ta='center' py='xl'>
                Ningún skill coincide con esos filtros.
              </Text>
            )}
          </>
        )}
      </div>
    </div>
  );
}
