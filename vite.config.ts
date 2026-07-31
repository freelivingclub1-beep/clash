import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export const alias = {
  '@sim': r('./src/sim'),
  '@cards': r('./src/cards'),
  '@net': r('./src/net'),
  '@game': r('./src/game'),
  '@render': r('./src/render'),
  '@ui': r('./src/ui'),
};

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  resolve: { alias },
});
