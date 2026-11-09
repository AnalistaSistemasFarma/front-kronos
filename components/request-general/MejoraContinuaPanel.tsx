'use client';

import { useCallback, useEffect, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, Collapse, Group, Loader, Modal, SimpleGrid, Stack, Text, Textarea, ThemeIcon, Tooltip } from '@mantine/core';
import { IconBulb, IconCheck, IconChevronDown, IconChevronUp, IconRefresh, IconTrendingUp, IconX } from '@tabler/icons-react';
import type { Diagnostico, DiagnosticoTarea, Semaforo, Sugerencia } from '../../lib/workflow/mejora-continua-rules';
import { textoDias } from '../../lib/workflow/mejora-continua-rules';

/**
 * Panel «Mejora continua» del editor de Flujos de trabajo (2026-11-09; punto 8 del video
 * para México, pedido de Nicolás Rivera). Muestra cómo funciona el flujo en la realidad
 * (últimos 6 meses), sugiere ajustes concretos con su evidencia y deja que una persona
 * decida: «Aplicar» prepara el cambio en el editor (ella guarda como siempre) y «Descartar»
 * pide el motivo. Diseño: docs/flujos-mejora-continua.md.
 */

export interface InfoSemaforo {
  semaforo: Semaforo;
  medianaDias: number | null;
  participacion: number;
  casos: number;
}

interface DecisionDto {
  clave: string;
  estado: 'aplicada' | 'descartada';
  motivo: string | null;
  decididoPor: string | null;
  fecha: string;
  metricaAntes: { medianaDias: number | null; casos: number } | null;
}

type Respuesta =
  | { habilitado: false; flujo: string }
  | { habilitado: true; flujo: string; calculadoEn: string; diagnostico: Diagnostico; decisiones: DecisionDto[] };

const COLOR: Record<Semaforo, string> = { verde: 'green', ambar: 'yellow', rojo: 'red', sin_datos: 'gray' };
const ETIQUETA: Record<Semaforo, string> = { verde: 'Fluye bien', ambar: 'Se demora', rojo: 'Cuello de botella', sin_datos: 'Pocos datos' };

/** Semáforo de una tarea (va junto al nombre de la tarea en el editor). */
export function BadgeSemaforo({ info }: { info?: InfoSemaforo }) {
  if (!info) return null;
  const detalle =
    info.semaforo === 'sin_datos'
      ? `Menos de 5 casos resueltos en 6 meses (${info.casos}).`
      : `Lo normal: ${textoDias(info.medianaDias)} · ${Math.round(info.participacion * 100)} % del tiempo del flujo · ${info.casos} casos.`;
  return (
    <Tooltip label={detalle} withArrow multiline w={260}>
      <Badge color={COLOR[info.semaforo]} variant='light' size='sm' leftSection='●'>
        {ETIQUETA[info.semaforo]}
      </Badge>
    </Tooltip>
  );
}

export default function MejoraContinuaPanel({
  idProcessCategory,
  onSemaforos,
  onAplicar,
}: {
  idProcessCategory: number;
  onSemaforos: (m: Map<number, InfoSemaforo>) => void;
  /** Prepara el cambio en el editor. Devuelve false si no se pudo. */
  onAplicar: (s: Sugerencia) => boolean;
}) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState(true);
  const [verDescartadas, setVerDescartadas] = useState(false);
  const [descartar, setDescartar] = useState<Sugerencia | null>(null);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(
    async (refrescar = false) => {
      setCargando(true);
      setError(null);
      try {
        const res = await fetch(`/api/requests-general/mejora-continua?id_process_category=${idProcessCategory}${refrescar ? '&refrescar=1' : ''}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const json = (await res.json().catch(() => null)) as (Respuesta & { error?: string }) | null;
        if (res.status === 403) {
          setDatos(null);
          setError('forbidden');
          return;
        }
        if (!res.ok || !json) throw new Error(json?.error || 'No se pudo calcular la mejora continua.');
        setDatos(json);
        if (json.habilitado) {
          onSemaforos(
            new Map(
              json.diagnostico.tareas.map((t: DiagnosticoTarea) => [
                t.idTarea,
                { semaforo: t.semaforo, medianaDias: t.medianaDias, participacion: t.participacion, casos: t.casos },
              ])
            )
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo calcular la mejora continua.');
      } finally {
        setCargando(false);
      }
    },
    [idProcessCategory, onSemaforos]
  );

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const registrar = async (s: Sugerencia, estado: 'aplicada' | 'descartada', motivoTxt?: string) => {
    if (!datos?.habilitado) return false;
    const t = s.idTarea !== null ? datos.diagnostico.tareas.find((x) => x.idTarea === s.idTarea) : null;
    const res = await fetch('/api/requests-general/mejora-continua', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_process_category: idProcessCategory,
        clave: s.clave,
        estado,
        motivo: motivoTxt,
        titulo: s.titulo,
        metricaAntes: t ? { medianaDias: t.medianaDias, casos: t.casos } : null,
      }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      setError(json?.error || 'No se pudo guardar la decisión.');
      return false;
    }
    await cargar();
    return true;
  };

  // Sin permiso o sin la función en esta empresa: el panel no se muestra.
  if (error === 'forbidden' || (datos && !datos.habilitado)) return null;

  const d = datos?.habilitado ? datos.diagnostico : null;
  const decisiones = new Map((datos?.habilitado ? datos.decisiones : []).map((x) => [x.clave, x]));
  const pendientes = d?.sugerencias.filter((s) => !decisiones.has(s.clave)) ?? [];
  const aplicadas = d?.sugerencias.filter((s) => decisiones.get(s.clave)?.estado === 'aplicada') ?? [];
  const descartadas = d?.sugerencias.filter((s) => decisiones.get(s.clave)?.estado === 'descartada') ?? [];

  return (
    <Card withBorder radius='lg' p='md' mb='md' style={{ borderColor: 'var(--mantine-color-teal-4)' }} data-testid='mejora-continua'>
      <Group justify='space-between' wrap='nowrap'>
        <Group gap='sm' wrap='nowrap'>
          <ThemeIcon color='teal' variant='light' size='lg' radius='md'>
            <IconTrendingUp size={20} />
          </ThemeIcon>
          <div>
            <Text fw={700}>Mejora continua</Text>
            <Text size='xs' c='dimmed'>
              Cómo funciona este flujo en la realidad (últimos 6 meses) y qué se puede mejorar.
            </Text>
          </div>
        </Group>
        <Group gap={6} wrap='nowrap'>
          {pendientes.length > 0 && (
            <Badge color='teal' variant='filled'>
              {pendientes.length} {pendientes.length === 1 ? 'sugerencia' : 'sugerencias'}
            </Badge>
          )}
          <Tooltip label='Volver a calcular'>
            <ActionIcon variant='subtle' onClick={() => void cargar(true)} loading={cargando} aria-label='Volver a calcular'>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon variant='subtle' onClick={() => setAbierto((a) => !a)} aria-label={abierto ? 'Ocultar' : 'Mostrar'}>
            {abierto ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          </ActionIcon>
        </Group>
      </Group>

      <Collapse in={abierto}>
        <Stack gap='sm' mt='sm'>
          {aviso && (
            <Alert color='teal' variant='light' withCloseButton onClose={() => setAviso(null)}>
              {aviso}
            </Alert>
          )}
          {error && error !== 'forbidden' && (
            <Alert color='red' variant='light' withCloseButton onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {!d ? (
            <Group justify='center' py='md'>
              <Loader size='sm' />
              <Text size='sm' c='dimmed'>
                Revisando las solicitudes de los últimos 6 meses…
              </Text>
            </Group>
          ) : d.solicitudes === 0 ? (
            <Text size='sm' c='dimmed'>
              Este flujo no tuvo solicitudes desde el {d.desde}: todavía no hay con qué medirlo.
            </Text>
          ) : (
            <>
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing='xs'>
                <Cifra titulo='Solicitudes' valor={d.solicitudes.toLocaleString('es-CO')} nota={`desde el ${d.desde}`} />
                <Cifra titulo='Duración normal' valor={textoDias(d.cicloMedianaDias)} nota={`las más lentas, más de ${textoDias(d.cicloP90Dias)}`} />
                <Cifra titulo='Abiertas hoy' valor={d.abiertas.toLocaleString('es-CO')} nota={d.devueltas > 0 ? `${d.devueltas} devueltas` : ' '} />
                <Cifra
                  titulo='Con re-trabajo'
                  valor={d.conRetrabajo.toLocaleString('es-CO')}
                  nota='notas de devolución o corrección'
                />
              </SimpleGrid>
              <Text size='xs' c='dimmed'>
                Cada tarea del flujo muestra su semáforo: en verde fluye bien, en amarillo se demora y en rojo es un cuello de botella.
              </Text>

              {pendientes.length === 0 ? (
                <Alert color='green' variant='light' icon={<IconCheck size={16} />}>
                  No hay sugerencias nuevas para este flujo.
                </Alert>
              ) : (
                pendientes.map((s) => (
                  <Card key={s.clave} withBorder radius='md' p='sm'>
                    <Group gap='xs' wrap='nowrap' align='flex-start'>
                      <ThemeIcon color='yellow' variant='light' radius='xl' size='md'>
                        <IconBulb size={16} />
                      </ThemeIcon>
                      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                        <Text fw={600} size='sm'>
                          {s.titulo}
                        </Text>
                        <Text size='sm'>{s.explicacion}</Text>
                        <Text size='xs' c='dimmed'>
                          <b>Por qué lo sugerimos:</b> {s.evidencia}
                        </Text>
                        {s.impacto && (
                          <Text size='xs' c='teal' fw={600}>
                            {s.impacto}
                          </Text>
                        )}
                        <Group gap={6} mt={4}>
                          <Button
                            size='xs'
                            color='teal'
                            leftSection={<IconCheck size={14} />}
                            onClick={async () => {
                              if (!onAplicar(s)) return;
                              const ok = await registrar(s, 'aplicada');
                              if (ok) {
                                setAviso(
                                  s.accion.tipo === 'quitar_secuencial'
                                    ? 'Listo: el cambio quedó preparado en el editor (resaltado). Revíselo y pulse «Guardar cambios».'
                                    : `Listo: abrimos la edición y resaltamos «${s.accion.campo}». Haga el ajuste y pulse «Guardar cambios».`
                                );
                              }
                            }}
                          >
                            Aplicar
                          </Button>
                          <Button
                            size='xs'
                            variant='subtle'
                            color='gray'
                            leftSection={<IconX size={14} />}
                            onClick={() => {
                              setMotivo('');
                              setDescartar(s);
                            }}
                          >
                            Descartar
                          </Button>
                        </Group>
                      </Stack>
                    </Group>
                  </Card>
                ))
              )}

              {aplicadas.length > 0 && (
                <Stack gap={4}>
                  <Text size='xs' fw={600} c='dimmed'>
                    Aplicadas
                  </Text>
                  {aplicadas.map((s) => {
                    const dec = decisiones.get(s.clave)!;
                    const t = s.idTarea !== null ? d.tareas.find((x) => x.idTarea === s.idTarea) : null;
                    const antes = dec.metricaAntes?.medianaDias ?? null;
                    return (
                      <Text key={s.clave} size='xs'>
                        ✓ {s.titulo} — {new Date(dec.fecha).toLocaleDateString('es-CO')}
                        {dec.decididoPor ? `, ${dec.decididoPor}` : ''}
                        {antes !== null && t?.medianaDias !== null && t?.medianaDias !== undefined
                          ? `. Antes: ${textoDias(antes)} · ahora: ${textoDias(t.medianaDias)}.`
                          : ''}
                      </Text>
                    );
                  })}
                </Stack>
              )}
              {descartadas.length > 0 && (
                <Button size='xs' variant='subtle' color='gray' onClick={() => setVerDescartadas((v) => !v)} w='fit-content'>
                  {verDescartadas ? 'Ocultar' : 'Ver'} descartadas ({descartadas.length})
                </Button>
              )}
              {verDescartadas &&
                descartadas.map((s) => {
                  const dec = decisiones.get(s.clave)!;
                  return (
                    <Text key={s.clave} size='xs' c='dimmed'>
                      ✗ {s.titulo} — {dec.motivo}
                      {dec.decididoPor ? ` (${dec.decididoPor})` : ''}
                    </Text>
                  );
                })}
            </>
          )}
        </Stack>
      </Collapse>

      <Modal opened={!!descartar} onClose={() => setDescartar(null)} title='Descartar sugerencia' size='md'>
        <Stack gap='sm'>
          <Text size='sm'>{descartar?.titulo}</Text>
          <Textarea
            label='¿Por qué no aplica?'
            description='Queda registrado y la sugerencia no vuelve a aparecer.'
            autosize
            minRows={2}
            maxLength={1000}
            value={motivo}
            onChange={(e) => setMotivo(e.currentTarget.value)}
          />
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => setDescartar(null)}>
              Cancelar
            </Button>
            <Button
              color='gray'
              loading={guardando}
              disabled={!motivo.trim()}
              onClick={async () => {
                if (!descartar) return;
                setGuardando(true);
                const ok = await registrar(descartar, 'descartada', motivo.trim());
                setGuardando(false);
                if (ok) setDescartar(null);
              }}
            >
              Descartar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

function Cifra({ titulo, valor, nota }: { titulo: string; valor: string; nota: string }) {
  return (
    <Card withBorder radius='md' p='xs'>
      <Text size='xs' c='dimmed'>
        {titulo}
      </Text>
      <Text fw={700} size='lg'>
        {valor}
      </Text>
      <Text size='xs' c='dimmed' lineClamp={1}>
        {nota}
      </Text>
    </Card>
  );
}
