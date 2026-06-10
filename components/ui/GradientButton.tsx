'use client';

import React from 'react';
import { Button, ButtonProps } from '@mantine/core';
import { useTheme } from '../providers';

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
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const getVariantStyles = (): React.CSSProperties => {
    switch (variant) {
      case 'primary':
        return {
          background: 'linear-gradient(135deg, #113562 0%, #3db6e0 100%)',
          border: 'none',
          color: 'white',
          position: 'relative',
          overflow: 'hidden',
        };
      case 'outline':
        return isDark
          ? {
              background: 'rgba(94, 179, 232, 0.08)',
              border: '1px solid rgba(126, 200, 239, 0.45)',
              color: '#9dd4f5',
            }
          : {
              background: 'transparent',
              border: '1px solid #113562',
              color: '#113562',
            };
      case 'ghost':
        return isDark
          ? {
              background: 'transparent',
              border: 'none',
              color: '#9dd4f5',
            }
          : {
              background: 'transparent',
              border: 'none',
              color: '#113562',
            };
      default:
        return {};
    }
  };

  return (
    <>
      <Button
        {...props}
        className={`gradient-button gradient-button--${variant} ${
          isDark ? 'gradient-button--dark' : ''
        } ${className}`}
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
          background: rgba(17, 53, 98, 0.08);
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(17, 53, 98, 0.15);
        }

        .gradient-button--outline.gradient-button--dark:hover {
          background: rgba(94, 179, 232, 0.16);
          border-color: rgba(126, 200, 239, 0.65);
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
        }

        .gradient-button--ghost:hover {
          background: rgba(17, 53, 98, 0.08);
          transform: translateY(-1px);
        }

        .gradient-button--ghost.gradient-button--dark:hover {
          background: rgba(94, 179, 232, 0.12);
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
