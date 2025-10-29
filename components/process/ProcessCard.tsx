'use client';

import React, { useState } from 'react';
import { Title, Text, Group, Badge, Stack, ActionIcon } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconClock, IconBuilding } from '@tabler/icons-react';
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
      padding='lg'
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
        <GradientButton
          size='xs'
          variant='outline'
          onClick={(e) => {
            e?.stopPropagation();
            // Handle view details
          }}
        >
          Ver detalles
        </GradientButton>
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
            <Text size='xs' fw={500} c='dimmed'>
              Subprocesos{process.subprocesses.length > 0 && ` (${process.subprocesses.length})`}:
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
                {isExpanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
              </ActionIcon>
            )}
          </div>

          <div className='subprocesses-list'>
            {visibleSubprocesses.map((subprocess) => (
              <Badge
                key={subprocess.id_subprocess}
                className='subprocess-tag'
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onSubprocessClick(subprocess);
                }}
              >
                {subprocess.subprocess}
              </Badge>
            ))}
            {!isExpanded && process.subprocesses.length > 3 && (
              <Badge
                className='subprocess-tag subprocess-tag--more'
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setIsExpanded(true);
                }}
              >
                +{process.subprocesses.length - 3} más
              </Badge>
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
          gap: 24px;
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
          max-width: 400px;
        }

        .subprocesses-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .subprocesses-list {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .subprocess-tag {
          cursor: pointer;
          transition: all 0.2s ease;
          background: rgba(102, 126, 234, 0.1);
          color: #667eea;
          border: 1px solid rgba(102, 126, 234, 0.2);
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 500;
        }

        .subprocess-tag:hover {
          background: rgba(102, 126, 234, 0.2);
          transform: translateY(-1px);
        }

        .subprocess-tag--more {
          background: rgba(102, 126, 234, 0.05);
          border: 1px dashed rgba(102, 126, 234, 0.3);
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
