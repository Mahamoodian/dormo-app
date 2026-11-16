/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        brand: {
          50: '#effaf6', 100: '#d7f2e8', 200: '#b1e4d3', 300: '#7fcfb8', 400: '#4cb39a',
          500: '#2a9880', 600: '#1c7a68', 700: '#186256', 800: '#164f46', 900: '#13413b',
        },
      },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,.05), 0 1px 3px rgba(16,24,40,.06)' },
    },
  },
  plugins: [],
};
