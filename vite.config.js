import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/unit/**/*.test.js'], environment: 'node' },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.svg', 'icons/*.png'],
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2,woff,webmanifest}'], maximumFileSizeToCacheInBytes: 8 * 1024 * 1024, navigateFallback: 'index.html' },
      manifest: {
        id: './', name: 'صدى · محرر الصوت والموسيقى', short_name: 'صدى', description: 'تحرير الأصوات والموسيقى ودمج المسارات بلا إنترنت',
        lang: 'ar', dir: 'rtl', start_url: './', scope: './', display: 'standalone', orientation: 'any', background_color: '#0f1720', theme_color: '#0f1720',
        categories: ['music', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        file_handlers: [{ action: './', accept: { 'audio/*': ['.mp3', '.wav', '.m4a', '.ogg', '.opus', '.flac', '.aac'] } }],
      },
    }),
  ],
});
