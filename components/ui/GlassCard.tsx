'use client';

import React from 'react';
import { Paper } from '@mantine/core';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hoverable?: boolean;
  interactive?: boolean;
  onClick?: () => void;
  padding?: 'sm' | 'md' | 'lg' | 'xl';
}

const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className = '',
  hoverable = false,
  interactive = false,
  onClick,
  padding = 'lg',
}) => {
  const paddingMap = {
    sm: '16px',
    md: '20px',
    lg: '24px',
    xl: '32px',
  };

  return (
    <>
      <Paper
        shadow='xl'
        radius='lg'
        withBorder
        className={`glass-card ${hoverable ? 'glass-card--hoverable' : ''} ${
          interactive ? 'glass-card--interactive' : ''
        } ${className}`}
        onClick={onClick}
        style={{
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
          padding: paddingMap[padding],
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          overflow: 'hidden',
          cursor: interactive ? 'pointer' : 'default',
        }}
      >
        {children}
      </Paper>

      <style jsx>{`
        .glass-card--hoverable:hover {
          transform: translateY(-4px);
          box-shadow: 0 12px 40px rgba(102, 126, 234, 0.2);
          background: rgba(255, 255, 255, 1);
        }

        .glass-card--interactive:active {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
        }
      `}</style>
    </>
  );
};

export default GlassCard;
