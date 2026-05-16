import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      input: {
        main:     resolve(__dirname, 'index.html'),
        section24: resolve(__dirname, 'section24.html'),
      },
    },
  },
})
