import Header from '../../components/Header';

export default function ProcesosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='min-h-screen bg-gray-50'>
      <Header />
      <main>{children}</main>
    </div>
  );
}
