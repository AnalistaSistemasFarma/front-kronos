/** URLs del módulo de mesa de ayuda (alineadas con scripts/sync-help-desk-subprocess-urls.cjs). */

export function getOperatorPanelUrl(): string {
  return '/process/help-desk/create-ticket';
}

export function getRequesterPanelUrl(): string {
  return '/process/help-desk/assigned-tickets';
}
