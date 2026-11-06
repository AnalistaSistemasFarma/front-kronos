import { redirect } from 'next/navigation';

/**
 * Formación dejó de ser una sección del Portal de Talento Humano: desde el
 * 2026-10-26 es un módulo propio de /process (Nicolás Rivera). Los enlaces
 * viejos llegan al módulo nuevo.
 */
export default function FormacionMovida() {
  redirect('/process/formacion');
}
