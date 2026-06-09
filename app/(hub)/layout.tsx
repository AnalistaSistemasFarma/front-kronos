import HubLayoutClient from '../../components/layout/HubLayoutClient';

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return <HubLayoutClient>{children}</HubLayoutClient>;
}
