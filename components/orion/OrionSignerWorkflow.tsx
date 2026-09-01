'use client';

import { Alert, Button, Group, Stack, Stepper, Text } from '@mantine/core';
import { IconCheck, IconEye, IconSignature } from '@tabler/icons-react';
import type { OrionUiPermissions } from '../../lib/orion/permissions';
import PdfInlineViewer from './PdfInlineViewer';

type Props = {
  permissions: OrionUiPermissions;
  hasSignature: boolean;
  signatureLoading: boolean;
  documentPreviewUrl: string | null;
  documentFileName?: string | null;
  pendingSignerName?: string | null;
  onViewDocument: () => void;
  onDrawSignature: () => void;
  onAcceptSign: () => void;
  acceptLoading?: boolean;
};

export default function OrionSignerWorkflow({
  permissions,
  hasSignature,
  signatureLoading,
  documentPreviewUrl,
  documentFileName,
  pendingSignerName,
  onViewDocument,
  onDrawSignature,
  onAcceptSign,
  acceptLoading = false,
}: Props) {
  if (permissions.userRole === 'waiting') {
    return (
      <Alert color='blue' variant='light' mb='md'>
        Es firmante de este documento. Cuando sea su turno podrá ver el documento, dibujar su firma y
        aceptar.
        {pendingSignerName ? ` Turno actual: ${pendingSignerName}.` : ''}
      </Alert>
    );
  }

  if (permissions.userRole !== 'signer') return null;

  const activeStep = !hasSignature ? 1 : permissions.canAcceptSign ? 2 : 1;

  return (
    <Stack gap='md' mb='md'>
      <Stepper active={activeStep} size='xs'>
        <Stepper.Step label='Ver documento' description='Revise el contenido' />
        <Stepper.Step label='Mi firma' description={hasSignature ? 'Lista' : 'Pendiente'} />
        <Stepper.Step label='Aceptar' description='Confirmar firma' />
      </Stepper>

      {documentPreviewUrl && (
        <PdfInlineViewer
          src={documentPreviewUrl}
          fileName={documentFileName ?? 'Documento.pdf'}
          minHeight={220}
        />
      )}

      <Group gap='xs' wrap='wrap'>
        <Button
          size='compact-sm'
          variant='light'
          leftSection={<IconEye size={15} />}
          onClick={onViewDocument}
          disabled={!permissions.canViewDocument}
        >
          1. Ver documento
        </Button>
        <Button
          size='compact-sm'
          variant={hasSignature ? 'light' : 'filled'}
          leftSection={<IconSignature size={15} />}
          onClick={onDrawSignature}
          loading={signatureLoading}
          disabled={!permissions.canDrawSignature}
        >
          {hasSignature ? 'Editar mi firma' : '2. Dibujar mi firma'}
        </Button>
        <Button
          size='compact-sm'
          color='green'
          leftSection={<IconCheck size={15} />}
          onClick={onAcceptSign}
          loading={acceptLoading}
          disabled={!permissions.canAcceptSign}
        >
          3. Aceptar y firmar
        </Button>
      </Group>

      {!hasSignature && (
        <Text size='xs' c='dimmed'>
          Dibuje su firma antes de aceptar. Al confirmar, el flujo continuará con el siguiente firmante.
        </Text>
      )}
    </Stack>
  );
}
