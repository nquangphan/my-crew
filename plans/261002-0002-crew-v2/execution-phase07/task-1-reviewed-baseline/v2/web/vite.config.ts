import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  const apiOrigin = process.env.CREW_V2_WEB_API_ORIGIN;
  if (command === 'serve' && !apiOrigin) {
    throw new Error('CREW_V2_WEB_API_ORIGIN_REQUIRED');
  }
  return {
    base: '/crew-v2/',
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      ...(apiOrigin && {
        proxy: {
          '/v2': {
            target: apiOrigin,
            changeOrigin: false,
          },
        },
      }),
    },
  };
});
