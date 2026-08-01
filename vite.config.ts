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
  build: {
    /*
     * Inline the character atlases as data URIs.
     *
     * The game ships as one self-contained HTML file, and a published artifact
     * cannot fetch anything from another host, so an external .png reference
     * would simply be a missing image. The default 4KB threshold leaves them
     * as separate files; this raises it past the largest atlas.
     */
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 40_000,
  },
});
