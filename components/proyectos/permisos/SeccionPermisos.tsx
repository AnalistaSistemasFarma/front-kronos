'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Stack, Text, ThemeIcon, Timeline } from '@mantine/core';
import { IconBrandGithub, IconHistory, IconInfoCircle, IconPencil, IconShieldLock, IconUserCheck } from '@tabler/icons-react';
import { NIVEL_INFO } from '../../../lib/proyectos/permisos-agentes-rules';
import { mensajeSoloDesarrollo } from '../../../lib/proyectos/agentes-desarrollo-rules';
import type { PermisosProyectoDto } from '../../../lib/proyectos/permisos-agentes-tipos';
import type { ProyectoDetalleDto } from '../../../lib/proyectos/tipos';
import { apiGet, fechaCorta } from '../api';
import { EsqueletoFilas, type Aviso } from '../ui';
import EditarPermisosModal from './EditarPermisosModal';
import { BadgeNivel } from './FormPermisosAgentes';
import css from '../proyectos.module.css';

/**
 * Sección «Permisos» de un proyecto (2026-10-20): qué pueden hacer sus agentes
 * con el código (nivel, repos y quién autoriza pases) y el registro de cambios.
 * La ven todos los miembros; la cambian SOLO la administración o quien tenga el
 * permiso «Permisos de agentes en Proyectos» en la empresa del proyecto.
 */
const ACCION: Record<string, string> = { crear: 'Definió los permisos', cambiar: 'Cambió los permisos', activar: 'Activó', desactivar: 'Desactivó' };

export default function SeccionPermisos({ proyecto, version, avisar }: { proyecto: ProyectoDetalleDto; version: number; avisar: (a: Aviso) => void }) {
  const [datos, setDatos] = useState<PermisosProyectoDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);

  const cargar = useCallback(async () => {
    const r = await apiGet<PermisosProyectoDto>(`/api/proyectos/${proyecto.idProject}/permisos`, 'No se pudieron cargar los permisos de los agentes.');
    if (r.ok) {
      setDatos(r.data);
      setError(null);
    } else if (r.error) setError(r.error);
  }, [proyecto.idProject]);

  useEffect(() => {
    void cargar();
  }, [cargar, version]);

  if (error && !datos) {
    return (
      <Alert color='red' radius='md' m='sm'>
        {error}
      </Alert>
    );
  }
  if (!datos) return <EsqueletoFilas n={4} />;

  const p = datos.policy;
  return (
    <Stack gap='md' p='sm' data-testid='permisos-seccion'>
      <Card withBorder radius='md' p='md'>
        <Stack gap='sm'>
          <Group justify='space-between' wrap='wrap' gap='sm'>
            <Group gap='sm' wrap='nowrap' style={{ minWidth: 0 }}>
              <ThemeIcon size={36} radius='xl' variant='light'>
                <IconShieldLock size={20} />
              </ThemeIcon>
              <div style={{ minWidth: 0 }}>
                <Text fw={600} size='sm'>
                  Acceso a código de los agentes
                </Text>
                <Text size='xs' c='dimmed'>
                  {p.configurada
                    ? `Último cambio: ${p.updatedBy ?? '—'} · ${fechaCorta(p.updatedAt)}`
                    : 'Sin definir: vale el valor seguro por defecto.'}
                </Text>
              </div>
            </Group>
            {datos.canEdit && (
              <Button size='sm' variant='light' leftSection={<IconPencil size={16} />} onClick={() => setEditando(true)} data-testid='permisos-editar'>
                Cambiar permisos
              </Button>
            )}
          </Group>

          <Group gap='sm' wrap='nowrap' align='flex-start'>
            <BadgeNivel nivel={p.codeLevel} size='md' />
            <Text size='sm' c='dimmed' style={{ minWidth: 0 }}>
              {NIVEL_INFO[p.codeLevel].description}
            </Text>
          </Group>

          {p.repos.length > 0 && (
            <Stack gap={4}>
              <Text size='xs' fw={600} c='dimmed' tt='uppercase'>
                Repositorios vinculados
              </Text>
              {p.repos.map((r) => (
                <Group key={r.slug} gap={8} wrap='nowrap' className={css.fila} data-testid={`permisos-repo-vinculado-${r.slug}`}>
                  <IconBrandGithub size={18} style={{ flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Text size='sm' fw={500} className={css.truncar}>
                      {r.name}
                    </Text>
                    <Text size='xs' c='dimmed' className={css.truncar}>
                      {r.github} · pruebas: {r.branchTesting} · producción: {r.branchProduction}
                    </Text>
                  </div>
                  {!r.active && (
                    <Badge size='xs' color='yellow' variant='light'>
                      Desactivado
                    </Badge>
                  )}
                </Group>
              ))}
            </Stack>
          )}

          {p.codeLevel === 'desarrollo_pases' && (
            <Stack gap={4}>
              <Text size='xs' fw={600} c='dimmed' tt='uppercase'>
                Autorizan los pases
              </Text>
              <Group gap={6} wrap='wrap'>
                {p.deployApprovers.map((o) => (
                  <Badge key={o.email} variant='light' color='orange' leftSection={<IconUserCheck size={13} />} style={{ textTransform: 'none' }}>
                    {o.name}
                  </Badge>
                ))}
              </Group>
            </Stack>
          )}

          {datos.codeAllowed === false && (
            <Alert
              color={p.codeLevel !== 'ninguno' || p.repos.length > 0 ? 'yellow' : 'gray'}
              radius='md'
              icon={<IconInfoCircle size={18} />}
              py={8}
              data-testid='permisos-solo-desarrollo-aviso'
            >
              {mensajeSoloDesarrollo(datos.nonDevAgents ?? [])}
              {(p.codeLevel !== 'ninguno' || p.repos.length > 0) && ' Este proyecto todavía tiene acceso a código de antes de la regla: cámbielo a «Ninguno».'}
            </Alert>
          )}

          {!datos.canEdit && (
            <Alert color='gray' radius='md' icon={<IconInfoCircle size={18} />} py={8} data-testid='permisos-solo-lectura'>
              Los cambia la administración de SynerLink o quien tenga el permiso «Permisos de agentes en Proyectos» en {proyecto.company.companyName}.
            </Alert>
          )}
        </Stack>
      </Card>

      <Card withBorder radius='md' p='md'>
        <Group gap={8} mb='sm'>
          <IconHistory size={18} />
          <Text fw={600} size='sm'>
            Registro de cambios
          </Text>
        </Group>
        {datos.log.length === 0 ? (
          <Text size='sm' c='dimmed'>
            Todavía no hay cambios.
          </Text>
        ) : (
          <Timeline bulletSize={14} lineWidth={2} data-testid='permisos-registro'>
            {datos.log.map((c) => (
              <Timeline.Item key={c.id} title={<Text size='sm' fw={600}>{`${ACCION[c.action] ?? c.action} · ${c.changedBy ?? '—'}`}</Text>}>
                <Text size='xs' c='dimmed'>
                  {fechaCorta(c.changedAt)}
                </Text>
                {c.antes && (
                  <Text size='xs' className={css.resumen}>
                    Antes: {c.antes}
                  </Text>
                )}
                <Text size='xs' className={css.resumen}>
                  {c.antes ? 'Después: ' : ''}
                  {c.despues}
                </Text>
                <Text size='xs' c='dimmed' fs='italic' className={css.resumen}>
                  Motivo: {c.reason}
                </Text>
              </Timeline.Item>
            ))}
          </Timeline>
        )}
      </Card>

      <EditarPermisosModal
        opened={editando}
        idProject={proyecto.idProject}
        datos={datos}
        onClose={() => setEditando(false)}
        onGuardado={(cambio) => {
          setEditando(false);
          avisar(cambio ? { tipo: 'ok', texto: 'Permisos guardados. Los agentes los aplican desde su próxima respuesta.' } : { tipo: 'advertencia', texto: 'No había nada que cambiar.' });
          void cargar();
        }}
      />
    </Stack>
  );
}
