import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./client/src/test-setup.js'],
    include: ['client/**/*.test.{js,jsx}']
  }
});
