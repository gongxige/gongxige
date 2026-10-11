import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.API_PORT ?? '8787';
const operatorPort = process.env.OPERATOR_PORT ?? '8788';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 4173),
    strictPort: true,
    // Allow a temporary Cloudflare quick tunnel (https://xxx.trycloudflare.com) to show this site to someone remote.
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      // The game provider owns only its browser game API. Player-facing
      // wallets and game-history APIs belong to the platform service.
      '/api/wallet': `http://127.0.0.1:${operatorPort}`,
      '/api/deposit-requests': `http://127.0.0.1:${operatorPort}`,
      '/api/withdrawal-requests': `http://127.0.0.1:${operatorPort}`,
      '/api/game-records': `http://127.0.0.1:${operatorPort}`,
      '/api/admin': `http://127.0.0.1:${operatorPort}`,
      '/api': `http://127.0.0.1:${apiPort}`,
      '/auth': `http://127.0.0.1:${operatorPort}`,
      '/games': `http://127.0.0.1:${operatorPort}`
    }
  }
});
