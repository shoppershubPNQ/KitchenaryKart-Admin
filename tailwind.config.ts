import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#A01818',
          dark: '#7A1212',
        },
        ink: '#2D2A28',
        sand: '#E8DCC4',
        'sand-light': '#F5EFE0',
        gold: '#D4A574',
      },
    },
  },
  plugins: [],
};

export default config;
