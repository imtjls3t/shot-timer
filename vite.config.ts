import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const phoneHttps = mode === 'phone' ? {
    key: readFileSync(resolve('.local-certs/shot-timer-server-key.pem')),
    cert: readFileSync(resolve('.local-certs/shot-timer-server.crt')),
  } : undefined;

  return {
    base: process.env.BASE_PATH || '/',
    server: { https: phoneHttps },
    preview: { https: phoneHttps },
    plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
    manifest: {
      id: './', name: 'Shot Timer', short_name: 'Shot Timer',
      description: 'Your practice. Measured.', lang: 'en',
      start_url: './', scope: './', display: 'standalone',
      theme_color: '#111713', background_color: '#f5f5ef',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: { globPatterns: ['**/*.{js,css,html,svg,png,wav,woff2}'], navigateFallback: 'index.html' },
    })],
    worker: { format: 'es' },
    test: { include: ['src/**/*.test.ts'], environment: 'node' },
  };
});
