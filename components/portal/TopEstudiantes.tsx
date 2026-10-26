'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { IconTrophy } from '@tabler/icons-react';
import { medallaDelPuesto, type FilaTop, type VistaRanking } from '../../lib/portal/ranking-formacion';

/**
 * FORMACIÓN — TOP 10 DE ESTUDIANTES (Cristian Baldión, 2026-10-16): una tabla con los mejores estudiantes (más cursos completados y,
 * a igual número, mejor nota promedio). SOLO SE MUESTRA EL NOMBRE (pedido de Cristian, 2026-10-16): ni cursos ni nota. Oro, plata y bronce para los tres primeros. A la derecha de la lista de cursos en pantallas
 * anchas y debajo en las angostas. Sin sesión (401) no se muestra nada. Los fallos se avisan arriba, con color.
 */

const NOMBRE_MEDALLA = { oro: 'Medalla de oro', plata: 'Medalla de plata', bronce: 'Medalla de bronce' } as const;
const COLORES = {
  oro: { borde: '#b8860b', centro: '#ffd54a', anillo: '#f5b800', cinta: '#c62828' },
  plata: { borde: '#78909c', centro: '#eceff1', anillo: '#b0bec5', cinta: '#1565c0' },
  bronce: { borde: '#8d4a1b', centro: '#e0a26b', anillo: '#cd7f32', cinta: '#2e7d32' },
} as const;

/** Medalla dibujada en SVG (no depende de emojis ni de fuentes): cinta, disco con borde y el número del puesto. */
export function Medalla({ tipo, puesto }: { tipo: 'oro' | 'plata' | 'bronce'; puesto: number }) {
  const c = COLORES[tipo];
  return (
    <svg viewBox='0 0 32 40' width='28' height='35' role='img' aria-label={NOMBRE_MEDALLA[tipo]} data-testid={`medalla-${tipo}`}>
      <path d='M8 0h6l4 14h-7z' fill={c.cinta} />
      <path d='M24 0h-6l-4 14h7z' fill={c.cinta} opacity='.82' />
      <circle cx='16' cy='26' r='12.5' fill={c.anillo} stroke={c.borde} strokeWidth='1.6' />
      <circle cx='16' cy='26' r='9' fill={c.centro} stroke={c.borde} strokeWidth='.9' />
      <text x='16' y='30.2' textAnchor='middle' fontSize='11.5' fontWeight='700' fill={c.borde} fontFamily='Arial, sans-serif'>
        {puesto}
      </text>
    </svg>
  );
}

function Puesto({ fila }: { fila: FilaTop }) {
  const medalla = medallaDelPuesto(fila.puesto);
  return medalla ? (
    <Medalla tipo={medalla} puesto={fila.puesto} />
  ) : (
    <Text component='span' fw={700} c='dimmed' data-testid='top-numero' style={{ display: 'inline-block', width: 28, textAlign: 'center' }}>
      {fila.puesto}
    </Text>
  );
}

export default function TopEstudiantes() {
  const [datos, setDatos] = useState<VistaRanking | null>(null);
  const [oculto, setOculto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/portal/ranking-formacion', { cache: 'no-store' });
      if (res.status === 401) {
        setOculto(true); // sin sesión no hay nada que mostrar (la página ya avisa)
        return;
      }
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = {};
      }
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudo cargar el top de estudiantes.'));
      setDatos(data as unknown as VistaRanking);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (oculto) return null;

  return (
    <Card withBorder radius='md' shadow='sm' padding='md' component='aside' aria-labelledby='formacion-top-titulo' data-testid='top-estudiantes'>
      <Stack gap='sm'>
        <Title order={4} id='formacion-top-titulo' style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconTrophy size={20} aria-hidden /> Top 10 de estudiantes
        </Title>
        <Text size='xs' c='dimmed'>
          Más cursos completados y, a igual número, mejor nota promedio.
        </Text>

        {/* Avisos ARRIBA y con color. */}
        {error && (
          <Alert color='red' role='alert' data-testid='top-error'>
            <Group justify='space-between' gap='xs'>
              <Text size='sm'>{error}</Text>
              <Button size='xs' variant='default' onClick={() => void cargar()}>
                Reintentar
              </Button>
            </Group>
          </Alert>
        )}
        {cargando && <Loader size='sm' />}

        {datos && datos.top.length === 0 && (
          <Text size='sm' c='dimmed' data-testid='top-vacio'>
            Todavía nadie ha completado un curso. ¡Sea la primera persona del top!
          </Text>
        )}

        {datos && datos.top.length > 0 && (
          <>
            <Table striped highlightOnHover>
              <Table.Caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Los {datos.top.length} mejores estudiantes de Formación
              </Table.Caption>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th scope='col'>Puesto</Table.Th>
                  <Table.Th scope='col'>Estudiante</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {datos.top.map((f) => (
                  <Table.Tr
                    key={f.puesto}
                    data-testid='top-fila'
                    data-puesto={f.puesto}
                    data-usted={f.esUsted ? 'true' : undefined}
                    bg={f.esUsted ? 'var(--mantine-color-blue-light)' : undefined}
                  >
                    <Table.Td>
                      <Puesto fila={f} />
                    </Table.Td>
                    <Table.Th scope='row' fw={f.esUsted ? 700 : 500}>
                      {f.nombre}
                      {f.esUsted && (
                        <Text component='span' size='sm' c='dimmed'>
                          {' '}
                          (usted)
                        </Text>
                      )}
                    </Table.Th>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {datos.usted && (
              <Text size='sm' data-testid='top-usted'>
                Su puesto: <strong>#{datos.usted.puesto}</strong> de {datos.total}
              </Text>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
