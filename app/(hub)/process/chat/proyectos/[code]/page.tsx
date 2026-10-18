import { redirect } from 'next/navigation';

/** Dirección de la F1: los proyectos ya no son de UN asistente; van al módulo «Proyectos». */
export const dynamic = 'force-dynamic';

export default function ProyectosAgenteF1() {
  redirect('/process/proyectos');
}
