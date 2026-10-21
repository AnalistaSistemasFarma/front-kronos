'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconAlertCircle, IconShieldLock } from '@tabler/icons-react';
import { MAX_MOTIVO, MIN_MOTIVO } from '../../../lib/proyectos/permisos-agentes-rules';
import type { PermisosProyectoDto } from '../../../lib/proyectos/permisos-agentes-tipos';
import { apiSend } from '../api';
import { CONSULTA_ESCRITORIO } from '../ui';
import FormPermisosAgentes, { permisosListos, valorDesdePolitica, type ValorPermisos } from './FormPermisosAgentes';
import css from '../proyectos.module.css';

/**
 * «Cambiar permisos de los agentes» (2026-10-20). Exige el MOTIVO del cambio:
 * queda en el registro con quién, cuándo, el antes y el después.
 */
export default function EditarPermisosModal({
  opened,
  idProject,
  datos,
  onClose,
  onGuardado,
}: {
  opened: boolean;
  idProject: number;
  datos: PermisosProyectoDto;
  onClose: () => void;
  onGuardado: (cambio: boolean) => void;
}) {
  const escritorio = useMediaQuery(CONSULTA_ESCRITORIO) ?? true;
  const [valor, setValor] = useState<ValorPermisos>(() => valorDesdePolitica(datos.policy, datos.catalog));
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setValor(valorDesdePolitica(datos.policy, datos.catalog));
    setMotivo('');
    setError(null);
  }, [opened, datos]);

  const listo = permisosListos(valor) && motivo.trim().length >= MIN_MOTIVO;

  const guardar = async () => {
    if (!listo) return;
    setEnviando(true);
    setError(null);
    const r = await apiSend<{ updated: boolean }>('PATCH', `/api/proyectos/${idProject}/permisos`, { ...valor, reason: motivo }, 'No se pudieron guardar los permisos.');
    setEnviando(false);
    if (r.ok) onGuardado(r.data.updated);
    else setError(r.error);
  };

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
          <IconShieldLock size={20} />
          <Text fw={700}>Permisos de los agentes</Text>
        </Group>
      }
      data-testid='permisos-modal'
    >
      <Stack gap='md'>
        {error && (
          <Alert color='red' radius='md' icon={<IconAlertCircle size={18} />} withCloseButton onClose={() => setError(null)} data-testid='permisos-modal-error'>
            {error}
          </Alert>
        )}
        <FormPermisosAgentes valor={valor} onChange={setValor} catalogo={datos.catalog} operadores={datos.operators} />
        <Textarea
          label='Motivo del cambio'
          description='Queda en el registro con su nombre, la fecha, y los permisos de antes y de después.'
          placeholder='Ej.: Nicolás aprobó que Orus abra PR en SAPSEND para el ajuste de tesorería.'
          value={motivo}
          onChange={(e) => setMotivo(e.currentTarget.value)}
          maxLength={MAX_MOTIVO}
          autosize
          minRows={2}
          maxRows={5}
          required
          data-testid='permisos-motivo'
        />
        <Group justify='flex-end' gap='sm' className={escritorio ? undefined : css.pieModal}>
          <Button variant='default' onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} loading={enviando} disabled={!listo} data-testid='permisos-guardar'>
            Guardar permisos
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
