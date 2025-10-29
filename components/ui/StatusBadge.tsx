'use client';

import React from 'react';
import { Badge, BadgeProps } from '@mantine/core';

interface StatusBadgeProps extends Omit<BadgeProps, 'color'> {
  status: 'active' | 'inactive' | 'pending' | 'error' | 'success' | 'warning';
  pulse?: boolean;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  pulse = false,
  children,
  className = '',
  ...props
}) => {
  const getStatusColor = () => {
    switch (status) {
      case 'active':
        return '#667eea';
      case 'inactive':
        return '#999';
      case 'pending':
        return '#f59e0b';
      case 'error':
        return '#ef4444';
      case 'success':
        return '#10b981';
      case 'warning':
        return '#f59e0b';
      default:
        return '#999';
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case 'active':
        return 'Active';
      case 'inactive':
        return 'Inactive';
      case 'pending':
        return 'Pending';
      case 'error':
        return 'Error';
      case 'success':
        return 'Success';
      case 'warning':
        return 'Warning';
      default:
        return 'Unknown';
    }
  };

  return (
    <>
      <Badge
        {...props}
        className={`status-badge status-badge--${status} ${
          pulse ? 'status-badge--pulse' : ''
        } ${className}`}
        style={{
          backgroundColor: `${getStatusColor()}20`,
          color: getStatusColor(),
          border: `1px solid ${getStatusColor()}40`,
          fontWeight: 500,
          fontSize: '12px',
          padding: '4px 8px',
          borderRadius: '12px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          transition: 'all 0.2s ease',
        }}
      >
        {children || getStatusLabel()}
      </Badge>

      <style jsx>{`
        .status-badge:hover {
          transform: scale(1.05);
          z-index: 10;
        }

        .status-badge--pulse {
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.05);
          }
        }
      `}</style>
    </>
  );
};

export default StatusBadge;
