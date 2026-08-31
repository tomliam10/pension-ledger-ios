import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Lets you load the dev server on a real iPhone over your LAN during development:
    // npm run dev -- --host, then open the printed network URL on the device.
    host: true,
  },
});
