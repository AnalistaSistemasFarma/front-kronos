import { redirect } from 'next/navigation';
import { DASHBOARD_SOLICITADO_URL } from '../../../../../../lib/request-general/dashboardRoutes';

/** «Mis actividades» ahora vive en «Mi trabajo»; se conserva la ruta por enlaces guardados. */
export default function SolicitadoActividadesPage() {
  redirect(DASHBOARD_SOLICITADO_URL);
}
