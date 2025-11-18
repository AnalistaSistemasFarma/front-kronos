import React from 'react';

interface TextLogoProps {
  size?: 'small' | 'medium' | 'large' | 'custom';
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  withShadow?: boolean;
  withHover?: boolean;
  onClick?: () => void;
}

const TextLogo: React.FC<TextLogoProps> = ({
  size = 'medium',
  width,
  height,
  className = '',
  style = {},
  withShadow = false,
  withHover = false,
  onClick,
}) => {
  // Size presets based on original logo dimensions
  const getSizeStyles = () => {
    switch (size) {
      case 'small': // Header: 120x48px
        return {
          fontSize: '18px',
          fontWeight: '700',
          width: '120px',
          height: '48px',
        };
      case 'medium': // Select Company: 200x100px
        return {
          fontSize: '24px',
          fontWeight: '700',
          width: '200px',
          height: '80px',
        };
      case 'large': // Login: 320x48px
        return {
          fontSize: '28px',
          fontWeight: '700',
          width: '320px',
          height: '48px',
        };
      case 'custom':
        return {
          fontSize: '20px',
          fontWeight: '700',
          width: width ? `${width}px` : 'auto',
          height: height ? `${height}px` : 'auto',
        };
      default:
        return {
          fontSize: '20px',
          fontWeight: '700',
          width: 'auto',
          height: 'auto',
        };
    }
  };

  const baseStyles: React.CSSProperties = {
    fontFamily: 'Arial, sans-serif',
    color: '#333333',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center' as const,
    letterSpacing: '0.5px',
    cursor: onClick ? 'pointer' : 'default',
    transition: withHover ? 'transform 0.3s ease' : 'none',
    ...getSizeStyles(),
    ...style,
  };

  const shadowStyles = withShadow
    ? {
        filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.2))',
      }
    : {};

  const combinedStyles = {
    ...baseStyles,
    ...shadowStyles,
  };

  return (
    <div
      className={`text-logo ${className}`}
      style={combinedStyles}
      onClick={onClick}
      onMouseEnter={
        withHover
          ? (e) => {
              e.currentTarget.style.transform = 'scale(1.05)';
            }
          : undefined
      }
      onMouseLeave={
        withHover
          ? (e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }
          : undefined
      }
    >
      CDS
    </div>
  );
};

export default TextLogo;
