'use client';

import Header from '../../components/Header';
import { useTheme } from '../../components/providers';

export default function ProcesosLayout({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <Header />
      <main>{children}</main>
    </div>
  );
}
