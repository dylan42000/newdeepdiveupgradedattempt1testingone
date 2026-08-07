import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const isElectron = process.env.BUILD_TARGET === 'electron';
  return {
    plugins: [react(), tailwindcss()],
    // Use relative base paths for Electron (file:// protocol)
    base: isElectron ? './' : '/',
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY),
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY),
      'import.meta.env.VITE_GROQ_API_KEY': JSON.stringify(
        env.VITE_GROQ_API_KEY || env.GROQ_API_KEY_1 || env.VITE_GROQ_API_KEY_1
      ),
      'import.meta.env.VITE_GROQ_API_KEY_1': JSON.stringify(
        env.GROQ_API_KEY_1 || env.VITE_GROQ_API_KEY_1 || env.VITE_GROQ_API_KEY
      ),
      'import.meta.env.VITE_GROQ_API_KEY_2': JSON.stringify(
        env.GROQ_API_KEY_2 || env.VITE_GROQ_API_KEY_2
      ),
      'import.meta.env.VITE_OPENROUTER_API_KEY': JSON.stringify(env.VITE_OPENROUTER_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        external: ['@aparajita/capacitor-secure-storage'],
      },
    },
    worker: { format: 'es' },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
