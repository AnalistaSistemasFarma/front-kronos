'use client';

import { Suspense } from 'react';
import AiAssistantChat from './AiAssistantChat';

/** useSearchParams exige Suspense en App Router. */
export default function AiAssistantChatHost() {
  return (
    <Suspense fallback={null}>
      <AiAssistantChat />
    </Suspense>
  );
}
