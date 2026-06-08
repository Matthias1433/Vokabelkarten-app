import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1', // localhost = secure context -> File System Access API funktioniert
    port: 5173,
    open: true,
  },
});
