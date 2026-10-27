'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Group, Paper, SimpleGrid, Stack, Switch, Text, Title } from '@mantine/core';
import { IconBuilding, IconDeviceFloppy } from '@tabler/icons-react';
import { departamentosDeEmpresa, leerJsonSeguro, type ContextoFormacion } from './tipos';

/**
 * MÓDULO FORMACIÓN — alcance del curso por empresa y departamento (Nicolás
 * Rivera, 2026-10-26): se activa o desactiva el curso en cada empresa y, dentro
 * de ella, en todos sus departamentos o solo en algunos. Sin alcance, el curso
 * es para todas las empresas y departamentos.
 */
interface EstadoEmpresa {
  activa: boolean;
  todos: boolean;
  deps: Record<number, boolean>;
}

export default function AlcanceCurso({ cursoId, ctx }: { cursoId: number; ctx: ContextoFormacion }) {
  const [paraTodas, setParaTodas] = useState(true);
  const [estado, setEstado] = useState<Record<number, EstadoEmpresa>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/formacion/cursos/${cursoId}/alcance`, { cache: 'no-store' });
      const data = await leerJsonSeguro(res);
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudo cargar el alcance.'));
      const filas = (data.alcances as Array<{ empresaId: number; departamentoId: number | null; activo: boolean }>) ?? [];
      const nuevo: Record<number, EstadoEmpresa> = {};
      for (const e of ctx.empresas) nuevo[e.id] = { activa: false, todos: true, deps: {} };
      for (const f of filas) {
        const e = (nuevo[f.empresaId] ??= { activa: false, todos: true, deps: {} });
        if (f.departamentoId === null) {
          e.activa = f.activo;
          e.todos = true;
        } else {
          e.todos = false;
          e.deps[f.departamentoId] = f.activo;
          if (f.activo) e.activa = true;
        }
      }
      setEstado(nuevo);
      setParaTodas(filas.length === 0);
    } catch (e) {
      setAviso({ tipo: 'error', texto: (e as Error).message });
    } finally {
      setCargando(false);
    }
  }, [cursoId, ctx.empresas]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cambiar = (empresaId: number, cambio: Partial<EstadoEmpresa>) =>
    setEstado((s) => ({ ...s, [empresaId]: { ...(s[empresaId] ?? { activa: false, todos: true, deps: {} }), ...cambio } }));

  const guardar = async () => {
    setGuardando(true);
    setAviso(null);
    const alcances: Array<{ empresaId: number; departamentoId: number | null; activo: boolean }> = [];
    if (!paraTodas) {
      for (const e of ctx.empresas) {
        const st = estado[e.id];
        if (!st) continue;
        if (st.todos) {
          alcances.push({ empresaId: e.id, departamentoId: null, activo: st.activa });
        } else {
          for (const d of departamentosDeEmpresa(ctx, e.id)) {
            alcances.push({ empresaId: e.id, departamentoId: d.id, activo: st.activa && st.deps[d.id] === true });
          }
        }
      }
    }
    try {
      const res = await fetch(`/api/formacion/cursos/${cursoId}/alcance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alcances }),
      });
      const data = await leerJsonSeguro(res);
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudo guardar el alcance.'));
      setAviso({ tipo: 'ok', texto: paraTodas ? 'El curso quedó para todas las empresas y departamentos.' : 'Alcance guardado.' });
      await cargar();
    } catch (e) {
      setAviso({ tipo: 'error', texto: (e as Error).message });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Card withBorder radius='md' shadow='sm' padding='lg' data-testid='alcance-curso'>
      <Stack gap='sm'>
        <Group justify='space-between' wrap='wrap'>
          <Title order={4} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconBuilding size={20} /> Alcance por empresa y departamento
          </Title>
          <Button leftSection={<IconDeviceFloppy size={16} />} onClick={() => void guardar()} loading={guardando} disabled={cargando}>
            Guardar alcance
          </Button>
        </Group>
        {aviso && (
          <Alert color={aviso.tipo === 'ok' ? 'green' : 'red'} role={aviso.tipo === 'ok' ? 'status' : 'alert'}>
            {aviso.texto}
          </Alert>
        )}
        <Switch
          checked={paraTodas}
          onChange={(e) => setParaTodas(e.currentTarget.checked)}
          label='Para todas las empresas y departamentos'
          description='Apáguelo para elegir en qué empresas y departamentos está activo el curso.'
          disabled={cargando || !ctx.esGlobal}
        />
        {!ctx.esGlobal && paraTodas && (
          <Text size='xs' c='dimmed'>
            Solo quien tiene Formación en GSS cambia el alcance de un curso para todas las empresas.
          </Text>
        )}
        {!paraTodas && (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing='sm'>
            {ctx.empresas.map((e) => {
              const st = estado[e.id] ?? { activa: false, todos: true, deps: {} };
              const deps = departamentosDeEmpresa(ctx, e.id);
              const activos = st.todos ? deps.length : deps.filter((d) => st.deps[d.id]).length;
              return (
                <Paper key={e.id} withBorder radius='md' p='md' data-testid={`alcance-empresa-${e.id}`}>
                  <Stack gap='xs'>
                    <Group justify='space-between' wrap='nowrap'>
                      <Switch
                        checked={st.activa}
                        onChange={(ev) => cambiar(e.id, { activa: ev.currentTarget.checked })}
                        label={<Text fw={600}>{e.nombre}</Text>}
                      />
                      <Badge variant='light' color={st.activa ? 'green' : 'gray'}>
                        {st.activa ? (st.todos ? 'Todos los departamentos' : `${activos} departamento(s)`) : 'Inactivo'}
                      </Badge>
                    </Group>
                    {st.activa && (
                      <>
                        <Checkbox
                          checked={st.todos}
                          onChange={(ev) => cambiar(e.id, { todos: ev.currentTarget.checked })}
                          label='Todos los departamentos de la empresa'
                        />
                        {!st.todos && (
                          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={6}>
                            {deps.map((d) => (
                              <Switch
                                key={d.id}
                                size='sm'
                                checked={st.deps[d.id] === true}
                                onChange={(ev) => cambiar(e.id, { deps: { ...st.deps, [d.id]: ev.currentTarget.checked } })}
                                label={d.nombre}
                              />
                            ))}
                          </SimpleGrid>
                        )}
                      </>
                    )}
                  </Stack>
                </Paper>
              );
            })}
          </SimpleGrid>
        )}
      </Stack>
    </Card>
  );
}
