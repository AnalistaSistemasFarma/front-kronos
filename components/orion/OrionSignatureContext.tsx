'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { OrionUiPermissions } from '../../lib/orion/permissions';
import type { OrionSignatureState } from '../../lib/orion/types';

export type OrionFileMeta = {
  fileId: string;
  fileName: string;
  pdfUrl: string;
};

export type OrionFileView = {
  state: OrionSignatureState;
  permissions: OrionUiPermissions;
  currentUserCompleted: boolean;
};

export type OrionSignatureActions = {
  openConfigureSignature: () => void;
  openSignFlow: (file: OrionFileMeta) => void;
  openViewDocument: (file: OrionFileMeta) => void;
  /** initialStep: 0 documento, 1 firmantes, 2 ubicar firmas */
  openDocumentEditor: (
    file: OrionFileMeta,
    options?: { initialStep?: 0 | 1 | 2 }
  ) => void;
  openSignedDocument: (fileId: string) => void;
};

export type OrionSignatureApi = {
  enabled: boolean;
  documents: Record<string, OrionSignatureState>;
  /** fileId → true si el usuario actual tiene auth FIRMA pendiente */
  pendingAuthorizationByFile: Record<string, boolean>;
  canManage: boolean;
  /** Permiso subproceso “Firmar documento” (obligatorio para firmar). */
  canSignPermission: boolean;
  /** true cuando ya respondió el primer ensure-document (canManage fiable). */
  permissionsReady: boolean;
  isAdmin: boolean;
  /** Solo creador del flujo (solicitante) o admin: ver/descargar historial de versiones. */
  canViewVersions: boolean;
  hasSignature: boolean;
  acceptLoading: boolean;
  resolveForFile: (fileId: string) => OrionFileView;
  actions: OrionSignatureActions;
};

type OrionSignatureContextValue = {
  api: OrionSignatureApi | null;
  register: (api: OrionSignatureApi | null) => void;
};

const OrionSignatureContext = createContext<OrionSignatureContextValue | null>(null);

export function OrionSignatureProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<OrionSignatureApi | null>(null);

  return (
    <OrionSignatureContext.Provider value={{ api, register: setApi }}>
      {children}
    </OrionSignatureContext.Provider>
  );
}

export function useOrionSignatureApi(): OrionSignatureApi | null {
  return useContext(OrionSignatureContext)?.api ?? null;
}

export function useOrionSignatureRegister(): ((api: OrionSignatureApi | null) => void) | null {
  return useContext(OrionSignatureContext)?.register ?? null;
}
