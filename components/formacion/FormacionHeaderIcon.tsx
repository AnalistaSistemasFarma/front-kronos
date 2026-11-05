'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ActionIcon, Box, Indicator, Popover, ScrollArea, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconSchool } from '@tabler/icons-react';
import { ariaPendientes, etiquetaPendientes } from '../../lib/formacion/reglas';

/**
 * Ícono de FORMACIÓN en la cabecera (Nicolás Rivera, 2026-10-26): cursos o
 * videos nuevos pendientes por ver, que nacen de una divulgación. Mismo aspecto
 * que el Correo y Proyectos: ActionIcon «subtle» gris, ícono Tabler de 18 px,
 * tooltip y contador rojo. Solo aparece si hay pendientes. La consulta es
 * diferida, se repite cada 3 min con la pestaña visible y nunca muestra errores.
 */
interface Pendiente {
  id: number;
  courseId: number;
  materialId: number | null;
  titulo: string;
  material: string | null;
  mensaje: string | null;
  divulgadoAt: string;
}

const RETRASO_MS = 2500;
const TTL_MS = 3 * 60_000;

export const urlPendiente = (p: Pick<Pendiente, 'courseId'>) => `/process/formacion?vista=estudiante&curso=${p.courseId}`;

export default function FormacionHeaderIcon() {
  const { status } = useSession();
  const pathname = usePathname();
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<Pendiente[]>([]);
  const [abierto, setAbierto] = useState(false);
  const ultima = useRef(0);

  const consultar = useCallback(async () => {
    try {
      const res = await fetch('/api/formacion/pendientes', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { total?: number; items?: Pendiente[] };
      ultima.current = Date.now();
      setTotal(Number(data.total ?? 0));
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      // Silencioso: el ícono no debe molestar si falla la red.
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') {
      setTotal(0);
      setItems([]);
      return;
    }
    const t = setTimeout(() => void consultar(), RETRASO_MS);
    const refrescar = () => {
      if (document.visibilityState === 'visible' && Date.now() - ultima.current >= TTL_MS) void consultar();
    };
    document.addEventListener('visibilitychange', refrescar);
    const intervalo = setInterval(refrescar, TTL_MS);
    return () => {
      clearTimeout(t);
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', refrescar);
    };
  }, [status, consultar]);

  // Al volver de Formación, el pendiente que se abrió ya no debe contar.
  useEffect(() => {
    if (status === 'authenticated' && ultima.current && !pathname?.startsWith('/process/formacion')) void consultar();
  }, [pathname, status, consultar]);

  if (status !== 'authenticated' || total <= 0) return null;
  const etiqueta = etiquetaPendientes(total);

  return (
    <Popover opened={abierto} onChange={setAbierto} width={340} position='bottom-end' shadow='md' withArrow>
      <Popover.Target>
        <Indicator label={etiqueta ?? undefined} size={16} disabled={!etiqueta} color='red' offset={4}>
          <Tooltip label='Formación: pendientes por ver' withArrow disabled={abierto}>
            <ActionIcon
              variant='subtle'
              color='gray'
              aria-label={ariaPendientes(total)}
              onClick={() => setAbierto((v) => !v)}
              data-testid='header-formacion'
            >
              <IconSchool size={18} />
            </ActionIcon>
          </Tooltip>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Box px='md' py='sm' style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Text fw={700} size='sm'>
            Formación · pendientes por ver
          </Text>
          <Text size='xs' c='dimmed'>
            Cursos y videos nuevos que le divulgaron.
          </Text>
        </Box>
        <ScrollArea.Autosize mah={360}>
          <Stack gap={0}>
            {items.map((p) => (
              <UnstyledButton
                key={p.id}
                component={Link}
                href={urlPendiente(p)}
                prefetch={false}
                onClick={() => setAbierto(false)}
                px='md'
                py='sm'
                style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
                data-testid='pendiente-formacion'
              >
                <Text size='sm' fw={600} lineClamp={1}>
                  {p.material ? `Nuevo: ${p.material}` : `Nuevo curso: ${p.titulo}`}
                </Text>
                {p.material && (
                  <Text size='xs' c='dimmed' lineClamp={1}>
                    {p.titulo}
                  </Text>
                )}
                {p.mensaje && (
                  <Text size='xs' c='dimmed' lineClamp={2}>
                    {p.mensaje}
                  </Text>
                )}
                <Text size='xs' c='dimmed'>
                  {new Date(p.divulgadoAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                </Text>
              </UnstyledButton>
            ))}
          </Stack>
        </ScrollArea.Autosize>
        {total > items.length && (
          <Text size='xs' c='dimmed' ta='center' py='xs'>
            Y {total - items.length} más en Formación.
          </Text>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
