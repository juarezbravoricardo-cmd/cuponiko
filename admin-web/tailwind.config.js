/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tokens fieles a la guía de diseño Cuponiko.
        primary: { DEFAULT: '#F97316', dark: '#C2410C' },
        secondary: '#7C3AED',
        ink: { DEFAULT: '#1F1F1F', muted: '#6B7280' },
        success: '#16A34A',
        warning: '#D97706',
        danger: '#DC2626',
        bg: { DEFAULT: '#FFFFFF', muted: '#F5F5F5', border: '#E5E7EB' },
      },
      fontFamily: {
        // Inter para body, Nunito ExtraBold para headings (declarado en index.css).
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Nunito"', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
