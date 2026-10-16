'use client';

import { Suspense, use } from 'react';
import { Loader } from '@mantine/core';
import SgcDraftEditor from '../../../../../../../components/sgc/draft/SgcDraftEditor';

/** Borrador de una solicitud documental editado en la app (Sprint 3), con control de versiones. */
export default function SgcDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<div className='min-h-screen flex items-center justify-center'><Loader size='lg' /></div>}>
      <SgcDraftEditor idRequest={Number(id)} />
    </Suspense>
  );
}
