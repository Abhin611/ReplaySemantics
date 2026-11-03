import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'

// The Firebase web config comes from frontend/.env.local (see .env.example). These values identify the project;
// they are not secrets. VITE_FIREBASE_AUTH_EMULATOR points sign-in at the local Auth Emulator for testing.
const env = import.meta.env
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Boolean(config.apiKey && config.projectId)

let auth = null
export function firebaseAuth() {
  if (!firebaseConfigured) return null
  if (!auth) {
    auth = getAuth(initializeApp(config))
    if (env.VITE_FIREBASE_AUTH_EMULATOR) connectAuthEmulator(auth, env.VITE_FIREBASE_AUTH_EMULATOR, { disableWarnings: true })
  }
  return auth
}
