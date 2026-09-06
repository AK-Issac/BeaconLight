import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import { resolve } from 'path';

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    crx({ manifest: manifest as any }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        // inject.ts needs to be a standalone entry so it's available as web_accessible_resource
        inject: resolve(__dirname, 'src/content/inject.ts'),
      },
      output: {
        // Ensure inject.ts outputs with a predictable filename
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'inject') {
            return 'assets/inject.js';
          }
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
