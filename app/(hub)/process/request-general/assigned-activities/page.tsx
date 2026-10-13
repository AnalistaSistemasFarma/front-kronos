import { redirect } from 'next/navigation';

// Las tareas asignadas ahora se gestionan en el módulo unificado de Solicitudes Asignadas.
export default function AssignedActivitiesPage() {
  redirect('/process/request-general/assigned-requests?type=tasks');
}
