import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';

export default defineConfig({
  base: './',
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: false,
    reportCompressedSize: false,
  },
  worker: { format: 'es' },
});
