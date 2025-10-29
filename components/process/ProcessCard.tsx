'use client';

import React, { useState } from 'react';
import { Title, Text, Group, Badge, Stack, ActionIcon } from '@mantine/core';
import {
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconBuilding,
  IconArrowRight,
  IconFileText,
  IconSettings,
  IconTicket,
  IconShoppingCart,
  IconUsers,
  IconChartBar,
} from '@tabler/icons-react';
import GlassCard from '../ui/GlassCard';
import StatusBadge from '../ui/StatusBadge';
import GradientButton from '../ui/GradientButton';

// Define the interfaces needed for the component
interface Company {
  id_company: number;
  company: string;
}

interface CompanyUser {
  id_company_user: number;
  company: Company;
}

interface SubprocessUserCompany {
  id_subprocess_user_company: number;
  companyUser: CompanyUser;
}

interface ProcessSubprocess {
  id_subprocess: number;
  subprocess: string;
  subprocess_url?: string;
  subprocessUserCompanies?: SubprocessUserCompany[]; // Optional to match main interface
}

interface Process {
  id_process: number;
  process: string;
  process_url?: string;
  subprocesses: ProcessSubprocess[];
  status?: 'active' | 'inactive' | 'pending';
  lastAccessed?: string;
  company?: string;
  description?: string;
}

interface ProcessCardProps {
  process: Process;
  onProcessClick: (processId: number) => void;
  onSubprocessClick: (subprocess: ProcessSubprocess) => void;
  className?: string;
}

const ProcessCard: React.FC<ProcessCardProps> = ({
  process,
  onProcessClick,
  onSubprocessClick,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getProcessIcon = (processName: string) => {
    // Simple icon mapping based on process name
    if (
      processName.toLowerCase().includes('help') ||
      processName.toLowerCase().includes('soporte')
    ) {
      return '🎫';
    }
    if (
      processName.toLowerCase().includes('purchase') ||
      processName.toLowerCase().includes('compra')
    ) {
      return '🛒';
    }
    if (
      processName.toLowerCase().includes('admin') ||
      processName.toLowerCase().includes('administración')
    ) {
      return '⚙️';
    }
    return '📊';
  };

  const getSubprocessIcon = (subprocessName: string) => {
    const name = subprocessName.toLowerCase();

    if (name.includes('ticket') || name.includes('help') || name.includes('soporte')) {
      return <IconTicket size={18} />;
    }
    if (name.includes('compra') || name.includes('purchase') || name.includes('pedido')) {
      return <IconShoppingCart size={18} />;
    }
    if (name.includes('usuario') || name.includes('user') || name.includes('persona')) {
      return <IconUsers size={18} />;
    }
    if (name.includes('reporte') || name.includes('report') || name.includes('estadística')) {
      return <IconChartBar size={18} />;
    }
    if (name.includes('config') || name.includes('setting') || name.includes('ajuste')) {
      return <IconSettings size={18} />;
    }
    if (name.includes('documento') || name.includes('document') || name.includes('archivo')) {
      return <IconFileText size={18} />;
    }

    return <IconFileText size={18} />;
  };

  const formatRelativeTime = (dateString?: string) => {
    if (!dateString) return 'Nunca';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `hace ${diffMins} minutos`;
    if (diffHours < 24) return `hace ${diffHours} horas`;
    if (diffDays < 7) return `hace ${diffDays} días`;
    return date.toLocaleDateString();
  };

  const visibleSubprocesses = isExpanded ? process.subprocesses : process.subprocesses.slice(0, 3);

  return (
    <GlassCard
      className={`process-card ${className}`}
      hoverable
      interactive
      onClick={() => onProcessClick(process.id_process)}
      padding='xl'
    >
      {/* Header */}
      <div className='process-card-header'>
        <div className='process-icon'>{getProcessIcon(process.process)}</div>
        <div className='process-title-section'>
          <Title order={3} className='process-title'>
            {process.process}
          </Title>
          <StatusBadge status={process.status || 'active'} size='sm' />
        </div>
      </div>

      {/* Description */}
      {process.description && (
        <Text className='process-description' size='sm' c='dimmed'>
          {process.description}
        </Text>
      )}

      {/* Quick Actions */}
      <Group gap='xs' className='process-actions'>
        {process.process_url && (
          <GradientButton
            size='xs'
            variant='ghost'
            onClick={(e) => {
              e?.stopPropagation();
              window.open(process.process_url, '_blank');
            }}
          >
            Documentación
          </GradientButton>
        )}
      </Group>

      {/* Subprocesses */}
      {process.subprocesses.length > 0 && (
        <div className='process-subprocesses'>
          <div className='subprocesses-header'>
            <Text size='sm' fw={600} c='dimmed'>
              Subprocesos{process.subprocesses.length > 0 && ` (${process.subprocesses.length})`}
            </Text>
            {process.subprocesses.length > 3 && (
              <ActionIcon
                size='sm'
                variant='transparent'
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setIsExpanded(!isExpanded);
                }}
                c='blue'
              >
                {isExpanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
              </ActionIcon>
            )}
          </div>

          <div className='subprocesses-grid'>
            {visibleSubprocesses.map((subprocess) => (
              <div
                key={subprocess.id_subprocess}
                className='subprocess-card'
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onSubprocessClick(subprocess);
                }}
              >
                <div className='subprocess-icon'>{getSubprocessIcon(subprocess.subprocess)}</div>
                <Text size='sm' fw={500} className='subprocess-name'>
                  {subprocess.subprocess}
                </Text>
                <IconArrowRight size={14} className='subprocess-arrow' />
              </div>
            ))}
            {!isExpanded && process.subprocesses.length > 3 && (
              <div
                className='subprocess-card subprocess-card--more'
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setIsExpanded(true);
                }}
              >
                <div className='subprocess-icon'>
                  <IconChevronDown size={16} />
                </div>
                <Text size='sm' fw={500} className='subprocess-name'>
                  +{process.subprocesses.length - 3} más
                </Text>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className='process-metadata'>
        <Group gap='md' className='metadata-items'>
          <Group gap='xs' className='metadata-item'>
            <IconClock size={14} color='gray' />
            <Text size='xs' c='dimmed'>
              {formatRelativeTime(process.lastAccessed)}
            </Text>
          </Group>
          {process.company && (
            <Group gap='xs' className='metadata-item'>
              <IconBuilding size={14} color='gray' />
              <Text size='xs' c='dimmed'>
                {process.company}
              </Text>
            </Group>
          )}
        </Group>
      </div>

      <style jsx>{`
        .process-card {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 32px;
        }

        .process-card.list-view-card {
          flex-direction: row;
          align-items: center;
          gap: 24px;
        }

        .process-card-header {
          display: flex;
          align-items: flex-start;
          gap: 16px;
        }

        .list-view-card .process-card-header {
          flex-direction: column;
          align-items: center;
          text-align: center;
          min-width: 120px;
        }

        .process-icon {
          font-size: 32px;
          line-height: 1;
          flex-shrink: 0;
        }

        .process-title-section {
          flex: 1;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .list-view-card .process-title-section {
          flex-direction: column;
          align-items: flex-start;
        }

        .process-title {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          line-height: 1.4;
          color: #333;
          flex: 1;
        }

        .process-description {
          margin: 0;
          line-height: 1.5;
          color: #666;
          flex: 1;
          margin-bottom: 8px;
        }

        .list-view-card .process-description {
          margin-bottom: 0;
          max-width: 300px;
        }

        .process-actions {
          flex-wrap: wrap;
          gap: 12px;
        }

        .list-view-card .process-actions {
          flex-direction: column;
          align-items: flex-start;
          gap: 8px;
        }

        .process-subprocesses {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .list-view-card .process-subprocesses {
          flex: 0 0 auto;
          max-width: 500px;
        }

        .list-view-card .subprocesses-grid {
          grid-template-columns: 1fr;
        }

        .subprocesses-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .subprocesses-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }

        .subprocess-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          background: rgba(102, 126, 234, 0.05);
          border: 1px solid rgba(102, 126, 234, 0.1);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }

        .subprocess-card:hover {
          background: rgba(102, 126, 234, 0.1);
          border-color: rgba(102, 126, 234, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(102, 126, 234, 0.15);
        }

        .subprocess-card:active {
          transform: translateY(-1px);
          box-shadow: 0 3px 8px rgba(102, 126, 234, 0.2);
        }

        .subprocess-card--more {
          background: rgba(102, 126, 234, 0.02);
          border: 1px dashed rgba(102, 126, 234, 0.2);
          justify-content: center;
        }

        .subprocess-card--more:hover {
          background: rgba(102, 126, 234, 0.05);
          border-color: rgba(102, 126, 234, 0.3);
        }

        .subprocess-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          background: rgba(102, 126, 234, 0.1);
          border-radius: 8px;
          color: #667eea;
          flex-shrink: 0;
        }

        .subprocess-card--more .subprocess-icon {
          background: rgba(102, 126, 234, 0.05);
        }

        .subprocess-name {
          flex: 1;
          color: #333;
          font-size: 14px;
          line-height: 1.4;
        }

        .subprocess-arrow {
          color: #667eea;
          opacity: 0.7;
          transition: all 0.2s ease;
        }

        .subprocess-card:hover .subprocess-arrow {
          opacity: 1;
          transform: translateX(2px);
        }

        .process-metadata {
          margin-top: auto;
          padding-top: 16px;
          border-top: 1px solid rgba(0, 0, 0, 0.05);
        }

        .list-view-card .process-metadata {
          margin-top: 0;
          padding-top: 0;
          border-top: none;
          min-width: 150px;
        }

        .metadata-items {
          flex-wrap: wrap;
          gap: 16px;
        }

        .list-view-card .metadata-items {
          flex-direction: column;
          gap: 8px;
        }

        .metadata-item {
          flex-shrink: 0;
        }

        @media (max-width: 768px) {
          .process-card {
            gap: 16px;
            padding: 20px;
          }

          .process-card.list-view-card {
            flex-direction: column;
            align-items: flex-start;
            gap: 16px;
          }

          .list-view-card .process-card-header {
            flex-direction: row;
            align-items: flex-start;
            text-align: left;
            min-width: auto;
          }

          .list-view-card .process-title-section {
            flex-direction: row;
            align-items: flex-start;
            justify-content: space-between;
          }

          .list-view-card .process-description {
            max-width: none;
          }

          .list-view-card .process-actions {
            flex-direction: row;
            align-items: center;
          }

          .list-view-card .process-subprocesses {
            max-width: none;
          }

          .subprocess-card {
            padding: 12px 14px;
          }

          .subprocess-icon {
            width: 32px;
            height: 32px;
          }

          .subprocess-name {
            font-size: 13px;
          }

          .list-view-card .process-metadata {
            min-width: auto;
          }

          .list-view-card .metadata-items {
            flex-direction: row;
          }

          .process-title {
            font-size: 16px;
          }

          .process-icon {
            font-size: 28px;
          }
        }
      `}</style>
    </GlassCard>
  );
};

export default ProcessCard;
