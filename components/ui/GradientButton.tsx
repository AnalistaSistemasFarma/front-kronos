'use client';

import React from 'react';
import { Button, ButtonProps } from '@mantine/core';

interface GradientButtonProps extends Omit<ButtonProps, 'variant'> {
  variant?: 'primary' | 'outline' | 'ghost';
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onClick?: (e?: React.MouseEvent) => void;
}

const GradientButton: React.FC<GradientButtonProps> = ({
  children,
  variant = 'primary',
  leftIcon,
  rightIcon,
  className = '',
  ...props
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          border: 'none',
          color: 'white',
          position: 'relative' as const,
          overflow: 'hidden' as const,
        };
      case 'outline':
        return {
          background: 'transparent',
          border: '1px solid #667eea',
          color: '#667eea',
        };
      case 'ghost':
        return {
          background: 'transparent',
          border: 'none',
          color: '#667eea',
        };
      default:
        return {};
    }
  };

  return (
    <>
      <Button
        {...props}
        className={`gradient-button gradient-button--${variant} ${className}`}
        style={{
          ...getVariantStyles(),
          transition: 'all 0.3s ease',
          fontWeight: 500,
        }}
        leftSection={leftIcon}
        rightSection={rightIcon}
      >
        {children}
      </Button>

      <style jsx>{`
        .gradient-button::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 0;
          height: 0;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.3);
          transform: translate(-50%, -50%);
          transition: width 0.6s, height 0.6s;
        }

        .gradient-button--primary:hover::before {
          width: 300px;
          height: 300px;
        }

        .gradient-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 25px rgba(102, 126, 234, 0.4);
        }

        .gradient-button--outline:hover {
          background: 'rgba(102, 126, 234, 0.1)';
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(102, 126, 234, 0.3);
        }

        .gradient-button--ghost:hover {
          background: 'rgba(102, 126, 234, 0.1)';
          transform: translateY(-1px);
        }

        .gradient-button:active {
          transform: translateY(0);
        }

        .gradient-button--primary:active {
          box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }
      `}</style>
    </>
  );
};

export default GradientButton;
