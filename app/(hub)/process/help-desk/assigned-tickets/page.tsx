import { redirect } from 'next/navigation';

/** Ruta legacy en BD → mis tickets del usuario */
export default function AssignedTicketsRedirectPage() {
  redirect('/process/help-desk/my-tickets');
}
