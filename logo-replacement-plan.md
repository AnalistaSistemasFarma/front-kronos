# Logo Replacement Plan

## Overview

Replace all logo instances in the application with the text "Centro de Servicios" using Arial font, #333333 color, and professional styling.

## Current Logo Implementations

### 1. Header Component (`components/Header.tsx`)

- **Current**: Uses `/logo.svg` with dimensions 120x48px
- **Class**: `h-12 w-auto` for responsive sizing
- **Position**: Left side of the header
- **Link**: Links to `/dashboard`

### 2. Login Page (`app/login/page.tsx`)

- **Current**: Uses `/logo.svg` with dimensions 320x48px
- **Effects**: Drop shadow `filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.2))'`
- **Animations**: Hover animation and responsive sizing
- **Position**: Centered above the login form

### 3. Select Company Page (`app/select-company/page.tsx`)

- **Current**: Uses `/grupo-pisa-logo.svg` with dimensions 200x100px
- **Margin**: `marginBottom: '2rem'`
- **Position**: Centered above the company selection form

## Implementation Plan

### Step 1: Create TextLogo Component

Create a reusable component `components/TextLogo.tsx` with the following features:

- Text: "Centro de Servicios" on one line
- Font: Arial (sans-serif)
- Color: #333333
- Weight: Bold
- Customizable size and additional styling
- Support for hover effects and animations
- Responsive design

### Step 2: Replace Logo in Header Component

- Replace the Image component with TextLogo component
- Maintain the same dimensions (120x48px equivalent)
- Keep the link to `/dashboard`
- Ensure proper alignment with the navigation

### Step 3: Replace Logo in Login Page

- Replace the Image component with TextLogo component
- Maintain the same dimensions (320x48px equivalent)
- Keep the drop shadow effect
- Preserve hover animations
- Ensure responsive sizing for mobile devices

### Step 4: Replace Logo in Select Company Page

- Replace the Image component with TextLogo component
- Adjust dimensions to be proportional to the original (200x100px)
- Maintain the margin bottom of 2rem
- Ensure proper centering

## TextLogo Component Design

```tsx
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

// Size presets:
// small: 120x48px (Header)
// medium: 200x80px (Select Company)
// large: 320x48px (Login)
```

## Styling Considerations

### Base Styles

- Font family: Arial, sans-serif
- Font weight: 700 (bold)
- Color: #333333
- Text alignment: center
- Letter spacing: 0.5px (for better readability)

### Responsive Design

- For small screens: Adjust font size to maintain readability
- Ensure text doesn't break into multiple lines
- Maintain aspect ratio across different screen sizes

### Hover Effects

- Scale effect: `transform: scale(1.05)`
- Smooth transition: `transition: transform 0.3s ease`
- Optional color change on hover

### Shadow Effects

- Drop shadow: `filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2))`
- Can be toggled with `withShadow` prop

## Implementation Files to Modify

1. **Create**: `components/TextLogo.tsx`
2. **Modify**: `components/Header.tsx`
3. **Modify**: `app/login/page.tsx`
4. **Modify**: `app/select-company/page.tsx`

## Testing Checklist

- [ ] Verify text displays correctly in all three locations
- [ ] Check responsive behavior on mobile devices
- [ ] Test hover effects and animations
- [ ] Ensure proper alignment and spacing
- [ ] Verify accessibility (alt text, screen reader compatibility)
- [ ] Test 在不同浏览器中的兼容性

## Notes

- The text "Centro de Servicios" should remain in Spanish as specified
- Arial font is a web-safe font that doesn't require additional imports
- The #333333 color provides good contrast and readability
- All existing functionality (links, hover effects, etc.) should be preserved
