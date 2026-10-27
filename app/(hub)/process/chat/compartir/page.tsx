import { Suspense } from 'react';
import CompartirEnSynerLink from '../../../../../components/chat/CompartirEnSynerLink';

/**
 * «Compartir en SynerLink» — /process/chat/compartir.
 *
 * Aquí aterriza el menú Compartir de Android (share_target del manifiesto,
 * ver lib/chat/compartir-share-target.ts). Exige sesión (middleware de /process/*): si no
 * la hay, el login devuelve a esta misma URL y el lote sigue guardado en el
 * celular. El segmento estático gana sobre /process/chat/[code].
 */
export const dynamic = 'force-dynamic';

export default function CompartirPage() {
  return (
    <Suspense fallback={null}>
      <CompartirEnSynerLink />
    </Suspense>
  );
}
