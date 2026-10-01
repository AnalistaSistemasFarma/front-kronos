'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, Loader } from '@mantine/core';
import DraftBoard from '../../../../../components/orion/draftBoard/DraftBoard';

function DraftBoardPageContent() {
  const params = useSearchParams();
  const requestId = Number(params.get('requestId'));
  const fileId = String(params.get('fileId') || '').trim();
  if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
    return (
      <Alert color='red' m='md' title='Falta información'>
        Abra el tablero desde la fila del Word en la solicitud.
      </Alert>
    );
  }
  return <DraftBoard requestId={requestId} fileId={fileId} />;
}

/** Tablero del documento Word: /process/request-general/draft-board?requestId=&fileId= */
export default function DraftBoardPage() {
  return (
    <Suspense fallback={<Loader size='sm' m='md' />}>
      <DraftBoardPageContent />
    </Suspense>
  );
}
