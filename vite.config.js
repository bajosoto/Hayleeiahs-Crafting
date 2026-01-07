import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/Hayleeiahs-Guide-to-Crafting/',
  root: './',
  build: {
    outDir: 'dist'
  }
});
