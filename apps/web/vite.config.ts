import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // En desarrollo, /api se redirige a la API local: así la web y la API comparten origen, igual
    // que en producción (Express sirve la SPA), y no hace falta CORS.
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
