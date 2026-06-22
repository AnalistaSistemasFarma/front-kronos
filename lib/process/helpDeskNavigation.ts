export interface HelpDeskNavSubprocess {
  id_subprocess: number;
  subprocess: string;
  subprocess_url: string;
}

const OPERATOR_PANEL: HelpDeskNavSubprocess = {
  id_subprocess: -9101,
  subprocess: 'Tickets',
  subprocess_url: '/process/help-desk/assigned-tickets',
};

const REQUESTER_PANEL: HelpDeskNavSubprocess = {
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

/** Subprocesos legacy reemplazados por navegación según rol de subproceso. */
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

export type HelpDeskNavRole = {
  isOperator: boolean;
  isRequester: boolean;
};

/** Navegación: técnicos → panel general; resto → mis tickets. */
export function getHelpDeskNavSubprocesses(role: HelpDeskNavRole): HelpDeskNavSubprocess[] {
  if (role.isOperator) {
    return [OPERATOR_PANEL];
  }
  return [REQUESTER_PANEL];
}

type HelpDeskProcessShape = {
  process: string;
  subprocesses: Array<{ subprocess: string; subprocess_url?: string | null }>;
};

/** @deprecated Usar resolveHelpDeskRoleFromSubprocesses en subprocessRoles.ts */
export function hasHelpDeskModuleAccess(processes: HelpDeskProcessShape[]): boolean {
  return processes.some((process) => {
    const subprocesses = process.subprocesses ?? [];
    if (subprocesses.length === 0) return false;
    if (isHelpDeskProcess(process.process)) return true;
    return subprocesses.some(
      (sub) =>
        isLegacyTicketsSubprocess(sub) ||
        (sub.subprocess_url ?? '').toLowerCase().includes('help-desk')
    );
  });
}

export function transformHelpDeskProcesses<T extends { process: string; subprocesses: unknown[] }>(
  processes: T[],
  role: HelpDeskNavRole
): T[] {
  return processes.map((process) => {
    if (!isHelpDeskProcess(process.process)) {
      return process;
    }

    const otherSubprocesses = (process.subprocesses as { subprocess: string; subprocess_url?: string | null }[]).filter(
      (sub) => !isLegacyTicketsSubprocess(sub)
    );

    const nav = getHelpDeskNavSubprocesses(role);
    if (nav.length === 0) {
      return { ...process, subprocesses: otherSubprocesses };
    }

    return {
      ...process,
      subprocesses: [...otherSubprocesses, ...nav],
    };
  });
}
