'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertCircle, IconArrowLeft, IconBrandGithub, IconCircleCheck, IconPencil, IconPlus } from '@tabler/icons-react';
import { MAX_MOTIVO, MIN_MOTIVO } from '../../../lib/proyectos/permisos-agentes-rules';
import type { RepoCatalogoDto } from '../../../lib/proyectos/permisos-agentes-tipos';
import { apiGet, apiSend } from '../api';
import { CONSULTA_ESCRITORIO, EsqueletoFilas } from '../ui';
import css from '../proyectos.module.css';

/**
 * CATÁLOGO de repositorios (2026-10-20). SOLO la administración de SynerLink.
 * Lista, agregar, editar y activar/desactivar (nunca borrar), cada cambio con
 * su motivo en el registro. Un repo desactivado deja de ofrecerse y el puente
 * deja de dárselo a los agentes desde su próximo turno.
 */
type Vista = { tipo: 'lista' } | { tipo: 'form'; repo: RepoCatalogoDto | null } | { tipo: 'activo'; repo: RepoCatalogoDto };

const VACIO = { slug: '', name: '', github: '', branchTesting: 'testing', branchProduction: 'main', description: '' };

export default function CatalogoReposModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const escritorio = useMediaQuery(CONSULTA_ESCRITORIO) ?? true;
  const [repos, setRepos] = useState<RepoCatalogoDto[] | null>(null);
  const [vista, setVista] = useState<Vista>({ tipo: 'lista' });
  const [form, setForm] = useState(VACIO);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const r = await apiGet<{ repos: RepoCatalogoDto[] }>('/api/proyectos/repositorios', 'No se pudo cargar el catálogo.');
    if (r.ok) setRepos(r.data.repos);
    else if (r.error) setError(r.error);
  }, []);

  useEffect(() => {
    if (!opened) return;
    setVista({ tipo: 'lista' });
    setError(null);
    setOk(null);
    void cargar();
  }, [opened, cargar]);

  const abrirForm = (repo: RepoCatalogoDto | null) => {
    setForm(
      repo
        ? { slug: repo.slug, name: repo.name, github: repo.github, branchTesting: repo.branchTesting, branchProduction: repo.branchProduction, description: repo.description ?? '' }
        : VACIO
    );
    setMotivo('');
    setError(null);
    setOk(null);
    setVista({ tipo: 'form', repo });
  };

  const guardar = async () => {
    if (vista.tipo === 'lista') return;
    setEnviando(true);
    setError(null);
    const r =
      vista.tipo === 'activo'
        ? await apiSend('PATCH', `/api/proyectos/repositorios/${vista.repo.idRepo}`, { active: !vista.repo.active, reason: motivo }, 'No se pudo cambiar el repositorio.')
        : vista.repo
          ? await apiSend('PATCH', `/api/proyectos/repositorios/${vista.repo.idRepo}`, { ...form, reason: motivo }, 'No se pudo guardar el repositorio.')
          : await apiSend('POST', '/api/proyectos/repositorios', { ...form, reason: motivo }, 'No se pudo agregar el repositorio.');
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setOk(
      vista.tipo === 'activo'
        ? vista.repo.active
          ? `«${vista.repo.name}» quedó desactivado.`
          : `«${vista.repo.name}» quedó activo.`
        : vista.repo
          ? 'Repositorio actualizado.'
          : 'Repositorio agregado al catálogo.'
    );
    setVista({ tipo: 'lista' });
    void cargar();
  };

  const campo = (k: keyof typeof VACIO) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.currentTarget.value })),
  });

  const motivoOk = motivo.trim().length >= MIN_MOTIVO;
  const formOk = form.name.trim() && form.github.includes('/') && form.branchTesting.trim() && form.branchProduction.trim() && (vista.tipo !== 'form' || vista.repo || form.slug.trim());

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen={!escritorio}
      size='lg'
      radius='md'
      centered
      classNames={{ content: css.modalTactil }}
      closeButtonProps={{ size: escritorio ? 'md' : 'xl', 'aria-label': 'Cerrar' }}
      title={
        <Group gap={8}>
          <IconBrandGithub size={20} />
          <Text fw={700}>Repositorios permitidos</Text>
        </Group>
      }
      data-testid='catalogo-modal'
    >
      <Stack gap='md'>
        {error && (
          <Alert color='red' radius='md' icon={<IconAlertCircle size={18} />} withCloseButton onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {ok && (
          <Alert color='green' radius='md' icon={<IconCircleCheck size={18} />} withCloseButton onClose={() => setOk(null)} data-testid='catalogo-ok'>
            {ok}
          </Alert>
        )}

        {vista.tipo === 'lista' && (
          <>
            <Group justify='space-between' wrap='wrap' gap='sm'>
              <Text size='sm' c='dimmed' style={{ flex: 1, minWidth: 220 }}>
                Los repositorios que se pueden vincular a un proyecto. Solo la administración de SynerLink los agrega, edita o desactiva.
              </Text>
              <Button size='sm' leftSection={<IconPlus size={16} />} onClick={() => abrirForm(null)} data-testid='catalogo-agregar'>
                Agregar
              </Button>
            </Group>
            {!repos ? (
              <EsqueletoFilas n={3} />
            ) : repos.length === 0 ? (
              <Text size='sm' c='dimmed'>
                El catálogo está vacío.
              </Text>
            ) : (
              <Stack gap={6}>
                {repos.map((r) => (
                  <Group key={r.idRepo} gap='sm' wrap='nowrap' className={css.opcion} data-testid={`catalogo-repo-${r.slug}`} style={{ cursor: 'default' }}>
                    <IconBrandGithub size={20} style={{ flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Group gap={6} wrap='nowrap'>
                        <Text size='sm' fw={600} className={css.truncar}>
                          {r.name}
                        </Text>
                        {!r.active && (
                          <Badge size='xs' color='yellow' variant='light'>
                            Desactivado
                          </Badge>
                        )}
                      </Group>
                      <Text size='xs' c='dimmed' className={css.truncar}>
                        {r.slug} · {r.github} · {r.branchTesting} → {r.branchProduction}
                        {r.projectCount !== undefined ? ` · ${r.projectCount === 1 ? '1 proyecto' : `${r.projectCount} proyectos`}` : ''}
                      </Text>
                    </div>
                    <Switch
                      checked={r.active}
                      onChange={() => {
                        setMotivo('');
                        setError(null);
                        setOk(null);
                        setVista({ tipo: 'activo', repo: r });
                      }}
                      aria-label={r.active ? `Desactivar ${r.name}` : `Activar ${r.name}`}
                      data-testid={`catalogo-activo-${r.slug}`}
                    />
                    <Button variant='subtle' size='compact-sm' onClick={() => abrirForm(r)} aria-label={`Editar ${r.name}`} leftSection={<IconPencil size={14} />}>
                      {escritorio ? 'Editar' : ''}
                    </Button>
                  </Group>
                ))}
              </Stack>
            )}
          </>
        )}

        {vista.tipo !== 'lista' && (
          <Stack gap='sm'>
            <Button variant='subtle' size='compact-sm' leftSection={<IconArrowLeft size={14} />} onClick={() => setVista({ tipo: 'lista' })} style={{ alignSelf: 'flex-start' }}>
              Volver al catálogo
            </Button>
            {vista.tipo === 'activo' ? (
              <Text size='sm'>
                {vista.repo.active
                  ? `Al desactivar «${vista.repo.name}», deja de ofrecerse y los agentes de los proyectos que lo tienen pierden el acceso desde su próximo turno.`
                  : `Al activar «${vista.repo.name}», vuelve a ofrecerse y los proyectos que lo tenían vinculado lo recuperan.`}
              </Text>
            ) : (
              <>
                <TextInput
                  label='Clave'
                  description='Minúsculas, números y guiones. No cambia después: los proyectos y el puente la usan.'
                  placeholder='sapsend'
                  {...campo('slug')}
                  disabled={vista.repo !== null}
                  required
                  data-testid='catalogo-slug'
                />
                <TextInput label='Nombre' placeholder='SAPSEND' {...campo('name')} required data-testid='catalogo-nombre' />
                <TextInput label='Repositorio en GitHub' placeholder='dueño/repositorio' {...campo('github')} required data-testid='catalogo-github' />
                <Group grow gap='sm' wrap='wrap'>
                  <TextInput label='Rama de pruebas' {...campo('branchTesting')} required />
                  <TextInput label='Rama de producción' {...campo('branchProduction')} required />
                </Group>
                <Textarea label='Descripción' {...campo('description')} autosize minRows={2} maxRows={4} maxLength={500} />
              </>
            )}
            <Textarea
              label='Motivo del cambio'
              description='Queda en el registro con su nombre y la fecha.'
              value={motivo}
              onChange={(e) => setMotivo(e.currentTarget.value)}
              maxLength={MAX_MOTIVO}
              autosize
              minRows={2}
              maxRows={4}
              required
              data-testid='catalogo-motivo'
            />
            <Group justify='flex-end' gap='sm' className={escritorio ? undefined : css.pieModal}>
              <Button variant='default' onClick={() => setVista({ tipo: 'lista' })}>
                Cancelar
              </Button>
              <Button
                onClick={() => void guardar()}
                loading={enviando}
                disabled={!motivoOk || (vista.tipo === 'form' && !formOk)}
                color={vista.tipo === 'activo' && vista.repo.active ? 'red' : undefined}
                data-testid='catalogo-guardar'
              >
                {vista.tipo === 'activo' ? (vista.repo.active ? 'Desactivar' : 'Activar') : 'Guardar'}
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
