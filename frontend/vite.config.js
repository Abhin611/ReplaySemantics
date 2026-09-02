import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ReplaySemantics frontend — talks to the FastAPI backend
// (src/api/app.py) running at http://localhost:8000 by default.
// Override with VITE_API_BASE_URL in a .env file if needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
})
