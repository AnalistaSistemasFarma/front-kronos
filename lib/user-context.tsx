'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface Company {
  id: number;
  name: string;
}

interface UserContextType {
  selectedCompany: Company | null;
  setSelectedCompany: (company: Company | null) => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const useUserContext = () => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUserContext must be used within a UserProvider');
  }
  return context;
};

interface UserProviderProps {
  children: ReactNode;
}

export const UserProvider: React.FC<UserProviderProps> = ({ children }) => {
  const [selectedCompany, setSelectedCompanyState] = useState<Company | null>(null);

  useEffect(() => {
    // Load from localStorage on mount
    const stored = localStorage.getItem('selectedCompany');
    if (stored) {
      try {
        setSelectedCompanyState(JSON.parse(stored));
      } catch (error) {
        console.error('Error parsing selectedCompany from localStorage:', error);
      }
    }
  }, []);

  const setSelectedCompany = (company: Company | null) => {
    setSelectedCompanyState(company);
    if (company) {
      localStorage.setItem('selectedCompany', JSON.stringify(company));
    } else {
      localStorage.removeItem('selectedCompany');
    }
  };

  return (
    <UserContext.Provider value={{ selectedCompany, setSelectedCompany }}>
      {children}
    </UserContext.Provider>
  );
};
