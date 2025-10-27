'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface SapToken {
  companyId: number;
  companyName: string;
  token: string;
  expiresAt: number; // timestamp
  endpoint: string;
}

interface SapContextType {
  tokens: SapToken[];
  setTokens: (tokens: SapToken[]) => void;
  getToken: (companyId: number) => SapToken | null;
  addToken: (token: SapToken) => void;
  removeToken: (companyId: number) => void;
  clearExpiredTokens: () => void;
}

const SapContext = createContext<SapContextType | undefined>(undefined);

export const useSapContext = () => {
  const context = useContext(SapContext);
  if (!context) {
    throw new Error('useSapContext must be used within a SapProvider');
  }
  return context;
};

interface SapProviderProps {
  children: ReactNode;
}

export const SapProvider: React.FC<SapProviderProps> = ({ children }) => {
  const [tokens, setTokensState] = useState<SapToken[]>([]);

  useEffect(() => {
    // Load from localStorage on mount
    const stored = localStorage.getItem('sapTokens');
    if (stored) {
      try {
        const parsedTokens: SapToken[] = JSON.parse(stored);
        // Filter out expired tokens
        const validTokens = parsedTokens.filter((token) => token.expiresAt > Date.now());
        setTokensState(validTokens);
      } catch (error) {
        console.error('Error parsing sapTokens from localStorage:', error);
      }
    }
  }, []);

  const setTokens = (newTokens: SapToken[]) => {
    setTokensState(newTokens);
    localStorage.setItem('sapTokens', JSON.stringify(newTokens));
  };

  const getToken = (companyId: number): SapToken | null => {
    const token = tokens.find((t) => t.companyId === companyId);
    if (token && token.expiresAt > Date.now()) {
      return token;
    }
    // Remove expired token
    if (token) {
      removeToken(companyId);
    }
    return null;
  };

  const addToken = (token: SapToken) => {
    const newTokens = tokens.filter((t) => t.companyId !== token.companyId);
    newTokens.push(token);
    setTokens(newTokens);
  };

  const removeToken = (companyId: number) => {
    const newTokens = tokens.filter((t) => t.companyId !== companyId);
    setTokens(newTokens);
  };

  const clearExpiredTokens = () => {
    const validTokens = tokens.filter((token) => token.expiresAt > Date.now());
    if (validTokens.length !== tokens.length) {
      setTokens(validTokens);
    }
  };

  return (
    <SapContext.Provider
      value={{
        tokens,
        setTokens,
        getToken,
        addToken,
        removeToken,
        clearExpiredTokens,
      }}
    >
      {children}
    </SapContext.Provider>
  );
};
