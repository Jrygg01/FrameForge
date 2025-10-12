/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Poppins"', 'system-ui', 'sans-serif']
      },
      colors: {
        brand: {
          blue: '#6366f1',
          purple: '#a855f7',
          dark: '#111827'
        }
      }
    }
  },
  plugins: []
};
