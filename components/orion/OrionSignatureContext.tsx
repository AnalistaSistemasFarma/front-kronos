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
  openDocumentEditor: (file: OrionFileMeta) => void;
  openSignedDocument: (fileId: string) => void;
};

export type OrionSignatureApi = {
  enabled: boolean;
  documents: Record<string, OrionSignatureState>;
  /** fileId → true si el usuario actual tiene auth FIRMA pendiente */
  pendingAuthorizationByFile: Record<string, boolean>;
  canManage: boolean;
  isAdmin: boolean;
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
