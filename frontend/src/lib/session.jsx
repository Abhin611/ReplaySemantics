import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth'
import { firebaseAuth } from './firebase'
import { clearApiCache, getMe, setTokenProvider } from './api'

const SessionContext = createContext(null)

// Who is signed in, and which event log they are working on. A password account counts as signed in only after its
// email is verified; the server refuses it until then as well.
export function SessionProvider({ children }) {
  const auth = firebaseAuth()
  const [firebaseUser, setFirebaseUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [activeLog, setActiveLog] = useState(null)
  const [loading, setLoading] = useState(Boolean(auth))
  const [error, setError] = useState(null)

  const loadProfile = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const me = await getMe()
      setProfile(me.user)
      setActiveLog(me.active_log)
    } catch (err) {
      setProfile(null)
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!auth) return undefined
    setTokenProvider(() => auth.currentUser?.getIdToken() ?? null)
    return onAuthStateChanged(auth, (user) => {
      clearApiCache()
      setFirebaseUser(user)
      if (user?.emailVerified) {
        loadProfile()
      } else {
        setProfile(null)
        setActiveLog(null)
        setLoading(false)
      }
    })
  }, [auth, loadProfile])

  const value = useMemo(() => ({
    firebaseUser,
    profile,
    activeLog,
    loading,
    error,
    retry: loadProfile,
    setProfile,
    // switching logs drops every cached response and (through the key in App.jsx) every page's remembered state
    activateLog: (log) => { clearApiCache(); setActiveLog(log) },
    // after the user clicks the link in the verification email
    recheckVerification: async () => {
      await auth.currentUser.reload()
      await auth.currentUser.getIdToken(true)
      setFirebaseUser(auth.currentUser)
      if (auth.currentUser.emailVerified) await loadProfile()
      return auth.currentUser.emailVerified
    },
    signOut: () => firebaseSignOut(auth),
  }), [firebaseUser, profile, activeLog, loading, error, loadProfile, auth])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
