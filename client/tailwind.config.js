/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Source Serif 4"', '"Source Serif Pro"', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        parchment: {
          50: '#fbf7ee',
          100: '#f4ecd6',
          200: '#e8dab1',
        },
        ink: {
          900: '#1a1612',
          800: '#2a241d',
          700: '#3a3128',
        },
        accent: {
          500: '#8b5e3c',
          600: '#7a4f30',
        },
      },
    },
  },
  plugins: [],
};
