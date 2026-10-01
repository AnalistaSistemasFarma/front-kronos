'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Box, Button, Group, Modal, Stack, Text, Textarea, Title } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';

/**
 * Piezas visuales del administrador de flujos del SGC. COPIA CONGELADA
 * (2026-10-01) del marcado de «Flujos de Trabajo» de SynerLink
 * (app/(hub)/process/request-general/workflows y view-workflows): mismas
 * clases, tamaños, colores e íconos. No se importa nada de esas pantallas
 * (aislamiento del sistema validado, SGC-REQ-001/033).
 */

export const SGC_FLOW_CATEGORY_LABELS: Record<string, string> = {
  documental: 'Documental',
  control_cambios: 'Control de cambios',
  desviaciones: 'Desviaciones',
  capa: 'CAPA',
  capacitacion: 'Capacitación',
  auditorias: 'Auditorías',
  otro: 'Otro',
};

export const categoryLabel = (c: string) => SGC_FLOW_CATEGORY_LABELS[c] ?? c;

/** Clases de los campos grandes de los formularios de SynerLink. */
export const LG_FIELD = { label: 'text-sm font-medium mb-2', input: 'min-h-[48px] text-base' };
export const MD_FIELD = { label: 'text-sm font-medium mb-2', input: 'min-h-[44px] text-base' };

export function statusColor(status: string): string {
  return status === 'vigente' ? 'green' : status === 'borrador' ? 'orange' : 'gray';
}

export function statusLabel(status: string): string {
  return status === 'vigente' ? 'Vigente' : status === 'borrador' ? 'Borrador' : status === 'retirada' ? 'Retirada' : status;
}

/** Encabezado de las tarjetas de sección (ícono en caja de color + título order 2). */
export function SectionHeader({ icon, box, title, titleClass, subtitle, right }: { icon: ReactNode; box: string; title: string; titleClass: string; subtitle?: string; right?: ReactNode }) {
  return (
    <Group mb='md' justify='space-between'>
      <Group>
        <Box className={`${box} p-2 rounded-lg`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </Box>
        {subtitle ? (
          <div>
            <Title order={2} className={titleClass}>
              {title}
            </Title>
            <Text size='sm' c='dimmed'>
              {subtitle}
            </Text>
          </div>
        ) : (
          <Title order={2} className={titleClass}>
            {title}
          </Title>
        )}
      </Group>
      {right && <Group>{right}</Group>}
    </Group>
  );
}

/** Caja de dato de una tarea («Asignado a», «Costo»…). */
export function InfoBox({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className='rounded-lg p-3 transition-colors duration-200' style={{ backgroundColor: 'var(--mantine-color-default)' }} data-testid='sgc-flujo-dato'>
      <Group gap='xs' mb='1'>
        {icon}
        <Text size='xs' c='dimmed' fw={500} className='uppercase'>
          {label}
        </Text>
      </Group>
      {children}
    </div>
  );
}

/** Título de modal de SynerLink: ícono en caja de color + título + ayuda. */
export function ModalTitle({ icon, box, title, hint }: { icon: ReactNode; box: string; title: string; hint: string }) {
  return (
    <Group gap='sm'>
      <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${box}`}>{icon}</div>
      <div>
        <Text size='lg' fw={600}>
          {title}
        </Text>
        <Text size='xs' c='dimmed'>
          {hint}
        </Text>
      </div>
    </Group>
  );
}

/**
 * Motivo del control de cambios (guardar, publicar, descartar, nueva
 * versión). Todo cambio de configuración del SGC exige motivo y queda en
 * sgc.config_change_log.
 */
export function SgcReasonModal({
  opened,
  title,
  hint,
  icon,
  box,
  label,
  confirmLabel,
  confirmColor,
  onClose,
  onConfirm,
  children,
}: {
  opened: boolean;
  title: string;
  hint: string;
  icon: ReactNode;
  box: string;
  label: string;
  confirmLabel: string;
  confirmColor?: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!opened) setReason('');
  }, [opened]);
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<ModalTitle icon={icon} box={box} title={title} hint={hint} />}
      size='lg'
      radius='lg'
      overlayProps={{ blur: 4 }}
      centered
      classNames={{ header: 'border-b border-gray-100 pb-4', body: 'pt-4' }}
    >
      <Stack gap='lg'>
        {children}
        <Textarea
          label={label}
          placeholder='Explique qué cambia y por qué (mínimo 5 caracteres)'
          required
          minRows={3}
          autosize
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          classNames={{ label: 'text-sm font-medium mb-2' }}
          data-testid='sgc-modal-motivo'
        />
        <Group justify='flex-end' gap='sm' mt='md'>
          <Button variant='outline' onClick={onClose} className='cursor-pointer transition-colors duration-200'>
            Cancelar
          </Button>
          <Button
            color={confirmColor}
            leftSection={<IconCheck size={16} />}
            disabled={reason.trim().length < 5}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
              } finally {
                setBusy(false);
              }
            }}
            className={confirmColor ? 'cursor-pointer transition-colors duration-200' : 'bg-blue-600 hover:bg-blue-700 cursor-pointer transition-colors duration-200'}
            data-testid='sgc-modal-confirmar'
          >
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
