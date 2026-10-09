'use client';

import { useState } from 'react';
import { Badge, Button, Card, Group, Text, TextInput, Title } from '@mantine/core';
import { IconSchool } from '@tabler/icons-react';
import type { SgcRequestDetail } from '../../../lib/sgc/db/requests';
import { formatDateCO } from './format';

/**
 * «¿Requiere capacitación?» de la solicitud (Sprint 10, socialización con
 * Calidad OLP del 2026-10-07): el solicitante la sugiere al crearla y la
 * confirma quien crea el documento o Calidad, antes de la preparación del
 * material y la divulgación. Sin confirmar manda la sugerencia; sin
 * sugerencia, el tipo documental.
 */
export default function SgcTrainingFlagCard({ flag, onSet }: { flag: SgcRequestDetail['request']['trainingFlag']; onSet: (requiresTraining: boolean, reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState('');
  return (
    <Card shadow='sm' p='xl' radius='md' withBorder mt='6' data-testid='sgc-capacitacion-bandera'>
      <Group justify='space-between' mb='xs' wrap='wrap'>
        <Title order={4} className='flex items-center gap-2'>
          <IconSchool size={18} className='text-blue-6' />
          ¿Requiere capacitación?
        </Title>
        <Badge color={flag.effective ? 'blue' : 'gray'} variant='light' size='lg' radius='sm' data-testid='sgc-capacitacion-bandera-valor'>
          {flag.effective ? 'Sí' : 'No'} · {flag.sourceLabel}
        </Badge>
      </Group>
      <Text size='sm' c='dimmed'>
        {flag.effective
          ? 'Antes de la divulgación, Calidad registra el material (video o sesión y la evaluación en Microsoft Forms o Google Forms); la lectura los muestra debajo del documento.'
          : 'El documento pasa de la divulgación a vigente, sin capacitación.'}
        {typeof flag.suggested === 'boolean' ? ` El solicitante sugirió: ${flag.suggested ? 'sí' : 'no'}.` : ''} Tipo documental: {flag.typeDefault ? 'con capacitación' : 'sin capacitación'}.
        {flag.confirmedBy ? ` Confirmó ${flag.confirmedBy} el ${formatDateCO(flag.confirmedAt)}.` : ''}
      </Text>
      {flag.canChange && (
        <Group mt='sm' align='flex-end' wrap='wrap'>
          <TextInput label='Motivo (opcional)' value={reason} onChange={(e) => setReason(e.currentTarget.value)} autoComplete='off' style={{ flex: 1, minWidth: 240 }} />
          <Button variant={flag.confirmed === true ? 'filled' : 'light'} onClick={() => void onSet(true, reason).then((ok) => ok && setReason(''))} data-testid='sgc-capacitacion-bandera-si'>
            Sí requiere
          </Button>
          <Button variant={flag.confirmed === false ? 'filled' : 'light'} color='gray' onClick={() => void onSet(false, reason).then((ok) => ok && setReason(''))} data-testid='sgc-capacitacion-bandera-no'>
            No requiere
          </Button>
        </Group>
      )}
    </Card>
  );
}
