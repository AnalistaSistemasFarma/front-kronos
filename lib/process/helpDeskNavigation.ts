export interface HelpDeskNavSubprocess {
  id_subprocess: number;
  subprocess: string;
  subprocess_url: string;
}

const PANEL_SUBPROCESS: HelpDeskNavSubprocess = {
  id_subprocess: -9101,
  subprocess: 'Tickets',
  subprocess_url: '/process/help-desk/create-ticket',
};

const MY_TICKETS_SUBPROCESS: HelpDeskNavSubprocess = {
  id_subprocess: -9102,
  subprocess: 'Mis tickets',
  subprocess_url: '/process/help-desk/my-tickets',
};

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

/** Subprocesos legacy de tickets que se reemplazan por la navegación por rol */
export function isLegacyTicketsSubprocess(subprocess: {
  subprocess: string;
  subprocess_url?: string | null;
}) {
  const name = subprocess.subprocess.toLowerCase().trim();
  const url = (subprocess.subprocess_url ?? '').toLowerCase();
  return (
    name === 'tickets' ||
    name === 'ticket' ||
    name === 'mis tickets' ||
    name === 'mis ticket' ||
    name.includes('ticket asignado') ||
    name.includes('assigned ticket') ||
    name.includes('panel de caso') ||
    name.includes('casos por') ||
    url.includes('help-desk') ||
    url.includes('/process/tickets') ||
    url.includes('assigned-ticket') ||
    url.includes('my-ticket') ||
    url.includes('cases-by-email')
  );
}

export function getHelpDeskNavSubprocesses(isAdmin: boolean): HelpDeskNavSubprocess[] {
  if (isAdmin) {
    return [PANEL_SUBPROCESS];
  }
  return [MY_TICKETS_SUBPROCESS];
}

export function transformHelpDeskProcesses<T extends { process: string; subprocesses: unknown[] }>(
  processes: T[],
  isAdmin: boolean
): T[] {
  return processes.map((process) => {
    if (!isHelpDeskProcess(process.process)) {
      return process;
    }

    const otherSubprocesses = (process.subprocesses as { subprocess: string; subprocess_url?: string | null }[]).filter(
      (sub) => !isLegacyTicketsSubprocess(sub)
    );

    return {
      ...process,
      subprocesses: [...otherSubprocesses, ...getHelpDeskNavSubprocesses(isAdmin)],
    };
  });
}
