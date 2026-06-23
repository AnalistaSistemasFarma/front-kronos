export function isHelpDeskProcess(processName: string) {
  const name = processName.toLowerCase();
  return (
    (name.includes('help') && name.includes('desk')) ||
    (name.includes('mesa') && name.includes('ayuda')) ||
    name.includes('mesa de ayuda') ||
    name.includes('help desk') ||
    (name.includes('soporte') && !name.includes('compra')) ||
    name === 'tickets' ||
    name === 'ticket'
  );
}

/** Subprocesos legacy sustituidos por URLs registradas en BD (Mis tickets, create-ticket). */
export function isLegacyTicketsSubprocess(subprocess: {
  subprocess: string;
  subprocess_url?: string | null;
}) {
  const name = subprocess.subprocess.toLowerCase().trim();
  const url = (subprocess.subprocess_url ?? '').toLowerCase();
  return (
    name.includes('ticket asignado') ||
    name.includes('assigned ticket') ||
    name.includes('panel de caso') ||
    name.includes('casos por') ||
    url.includes('cases-by-email') ||
    url.includes('/process/tickets')
  );
}
