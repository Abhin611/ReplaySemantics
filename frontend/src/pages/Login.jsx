import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import {
  GoogleAuthProvider, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signInWithPopup, updateProfile,
} from 'firebase/auth'
import { ArrowLeft, Eye, EyeOff, GitBranch, Loader2, MailCheck } from 'lucide-react'
import { firebaseAuth, firebaseConfigured } from '../lib/firebase'
import { useSession } from '../lib/session'

const ERRORS = {
  'auth/invalid-credential': 'That email and password do not match.',
  'auth/wrong-password': 'That email and password do not match.',
  'auth/user-not-found': 'That email and password do not match.',
  'auth/email-already-in-use': 'An account with this email already exists. Log in instead.',
  'auth/weak-password': 'Please choose a password of at least 6 characters.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection.',
  'auth/account-exists-with-different-credential': 'This email already signs in another way. Use your password.',
}
const friendly = (err) => ERRORS[err.code] || err.message || 'Something went wrong. Please try again.'
const field = 'mt-1.5 w-full rounded-xl border border-[#d5dbe1] bg-[#eef2f5] px-3.5 py-3 text-[13.5px] text-[#101828] outline-none transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-[#6b7a88] hover:border-[#b9c2cb] focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/15'
const primary = 'mt-1 flex items-center justify-center gap-2 rounded-xl bg-navy-900 py-3 text-[13.5px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_10px_20px_-10px_rgba(13,27,41,0.7)] hover:bg-navy-800 disabled:opacity-60'
const VERDICT_LINES = [
  ['PASS', 'text-emerald-300', 'bg-emerald-400', 'Every order gives one total.'],
  ['POLICY-ORDERED', 'text-amber-300', 'bg-amber-400', 'A policy rule picks the order.'],
  ['BLOCKED', 'text-rose-300', 'bg-rose-400', 'No rule decides, so no number.'],
]

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l8 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-8-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l8-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.7 2.2-8.7 2.2-6.2 0-11.5-4.1-13.4-9.9l-8 6.2C6.5 42.6 14.6 48 24 48z" />
    </svg>
  )
}

function VerifyEmail({ user }) {
  const { recheckVerification, signOut } = useSession()
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const check = async () => {
    setBusy(true)
    setMsg(null)
    try {
      if (!(await recheckVerification())) setMsg('Not verified yet. Open the link in the email, then press this again.')
    } catch (err) { setMsg(friendly(err)) } finally { setBusy(false) }
  }
  const resend = async () => {
    setMsg(null)
    try {
      await sendEmailVerification(user)
      setMsg('Sent. Check your inbox and spam folder.')
    } catch (err) { setMsg(friendly(err)) }
  }
  return (
    <div data-testid="verify-email">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-600"><MailCheck size={21} /></span>
      <h1 className="mt-4 text-[22px] font-bold tracking-tight text-[#101828]">Verify your email</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[#5c6b7a]">We sent a verification link to <b className="text-[#101828]">{user.email}</b>. Open it, then come back here.</p>
      <button onClick={check} disabled={busy} className={`${primary} mt-5 w-full`}>
        {busy && <Loader2 size={15} className="animate-spin" />} I have verified my email
      </button>
      <div className="mt-3 flex items-center justify-between text-[12.5px]">
        <button onClick={resend} className="font-semibold text-teal-600 hover:underline">Send the email again</button>
        <button onClick={signOut} className="font-semibold text-[#5c6b7a] hover:underline">Use another account</button>
      </div>
      {msg && <p className="mt-3 rounded-lg bg-[#e6ebf0] px-3 py-2 text-[12.5px] text-[#344054]">{msg}</p>}
    </div>
  )
}

function SignInForm() {
  const [mode, setMode] = useState('login') // login | signup | reset
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const auth = firebaseAuth()

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try { await fn() } catch (err) { if (err.code !== 'auth/popup-closed-by-user') setError(friendly(err)) } finally { setBusy(false) }
  }
  const submit = (e) => {
    e.preventDefault()
    run(async () => {
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email)
        setNotice('If that address has an account, a reset link is on its way.')
      } else if (mode === 'signup') {
        const { user } = await createUserWithEmailAndPassword(auth, email, password)
        if (name.trim()) await updateProfile(user, { displayName: name.trim() })
        await sendEmailVerification(user)
      } else {
        await signInWithEmailAndPassword(auth, email, password)
      }
    })
  }
  const go = (m) => { setMode(m); setError(null); setNotice(null) }
  const title = { login: 'Welcome back', signup: 'Create your account', reset: 'Reset your password' }[mode]

  return (
    <div key={mode} className="rs-stagger">
      <div>
        <h1 className="text-[25px] font-extrabold tracking-[-0.03em] text-[#101828]">{title}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[#5c6b7a]">
          {mode === 'reset' ? 'We will email you a link to choose a new password.' : 'Your event logs and history stay with your account.'}
        </p>
      </div>

      {mode !== 'reset' && (
        <div>
          <button onClick={() => run(() => signInWithPopup(auth, new GoogleAuthProvider()))} disabled={busy} data-testid="google-login"
            className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-xl border border-[#d5dbe1] bg-white py-3 text-[13.5px] font-semibold text-[#101828] shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:border-[#b9c2cb] hover:bg-[#edf1f5] disabled:opacity-60">
            <GoogleMark /> Continue with Google
          </button>
          <div className="my-5 flex items-center gap-3 text-[11.5px] text-[#6b7a88]"><span className="h-px flex-1 bg-[#e2e6ea]" /> or with email <span className="h-px flex-1 bg-[#e2e6ea]" /></div>
        </div>
      )}

      <form onSubmit={submit} className={`flex flex-col gap-4 ${mode === 'reset' ? 'mt-6' : ''}`}>
        {mode === 'signup' && (
          <label className="text-[12px] font-semibold text-[#344054]">Name
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
          </label>
        )}
        <label className="text-[12px] font-semibold text-[#344054]">Email
          <input className={field} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        {mode !== 'reset' && (
          <label className="text-[12px] font-semibold text-[#344054]">Password
            <span className="relative block">
              <input className={`${field} pr-11`} type={showPassword ? 'text' : 'password'} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
              <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}
                className="absolute right-1.5 top-1/2 mt-[3px] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#6b7a88] hover:bg-[#eef1f4] hover:text-[#101828] active:!-translate-y-1/2">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>
        )}
        {error && <p className="rs-fade rounded-xl bg-status-blockedBg px-3.5 py-2.5 text-[12.5px] text-status-blocked" role="alert">{error}</p>}
        {notice && <p className="rs-fade rounded-xl bg-status-passBg px-3.5 py-2.5 text-[12.5px] text-status-pass">{notice}</p>}
        <button type="submit" disabled={busy} className={primary}>
          {busy && <Loader2 size={15} className="animate-spin" />}
          {{ login: 'Log in', signup: 'Create account', reset: 'Send reset link' }[mode]}
        </button>
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-[#5c6b7a]">
        {mode === 'login' && <button onClick={() => go('reset')} className="hover:underline">Forgot password?</button>}
        {mode === 'login' ? (
          <span>New here? <button onClick={() => go('signup')} className="font-semibold text-teal-600 hover:underline">Create an account</button></span>
        ) : (
          <button onClick={() => go('login')} className="font-semibold text-teal-600 hover:underline">Back to log in</button>
        )}
      </div>
    </div>
  )
}

export default function Login() {
  const { firebaseUser, profile, loading, error, retry, signOut } = useSession()
  const location = useLocation()
  if (profile) return <Navigate replace to={location.state?.from || '/dashboard'} />

  let body
  if (!firebaseConfigured) {
    body = (
      <div data-testid="firebase-missing">
        <h1 className="text-[22px] font-bold tracking-tight text-[#101828]">Sign-in is not set up yet</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[#5c6b7a]">
          Add your Firebase project's values to <code className="rounded bg-[#eef1f4] px-1">frontend/.env.local</code> (see <code className="rounded bg-[#eef1f4] px-1">frontend/.env.example</code>), then restart the frontend. The README has the steps.
        </p>
      </div>
    )
  } else if (loading) {
    body = <div className="flex items-center gap-2 text-[13px] text-[#5c6b7a]"><Loader2 size={15} className="animate-spin" /> Signing you in…</div>
  } else if (firebaseUser && !firebaseUser.emailVerified) {
    body = <VerifyEmail user={firebaseUser} />
  } else if (firebaseUser && error) {
    body = (
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-[#101828]">Could not load your profile</h1>
        <p className="mt-2 rounded-lg bg-status-blockedBg px-3 py-2 text-[12.5px] text-status-blocked">{error.message}</p>
        <div className="mt-4 flex gap-3 text-[13px] font-semibold">
          <button onClick={retry} className="text-teal-600 hover:underline">Try again</button>
          <button onClick={signOut} className="text-[#5c6b7a] hover:underline">Sign out</button>
        </div>
      </div>
    )
  } else {
    body = <SignInForm />
  }

  return (
    <div className="grid h-screen overflow-y-auto bg-navy-950 lg:grid-cols-[1.05fr_1fr]">
      <aside className="rs-hero relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex">
        <div aria-hidden="true" className="rs-hero-grid pointer-events-none absolute inset-0" />
        <Link to="/" className="group relative flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-teal-400 to-teal-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_10px_-4px_rgba(42,157,143,0.8)] transition-transform duration-500 ease-spring group-hover:rotate-[-8deg] group-hover:scale-105"><GitBranch size={17} strokeWidth={2.5} /></span>
          <span className="text-[15px] font-bold tracking-tight">ReplaySemantics</span>
        </Link>
        <div className="rs-hero-copy relative">
          <p className="max-w-md text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em]">A number you can defend, or a clear refusal to give one.</p>
          <p className="mt-5 max-w-md text-[13.5px] leading-relaxed text-[#b4c3d0]">Load an event log, replay its cases, swap the order of events and keep a full history of what you found.</p>
          <ul className="mt-8 flex flex-col gap-2.5 text-[12.5px]">
            {VERDICT_LINES.map(([name, tone, dot, text]) => (
              <li key={name} className="rs-glass-dark flex items-center gap-3 rounded-2xl px-4 py-3">
                <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                <span className={`w-[124px] shrink-0 font-bold tracking-wide ${tone}`}>{name}</span>
                <span className="text-[#b4c3d0]">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <span className="relative text-[11.5px] text-[#8fa3b5]">Team 20 · Dept. of CSE</span>
      </aside>
      <main className="flex min-h-full flex-col justify-center bg-[#f1f4f7] px-5 py-10 sm:px-10 lg:rounded-l-[32px]">
        <div className="mx-auto w-full max-w-[400px]">
          <Link to="/" className="group mb-6 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#5c6b7a] transition-colors hover:text-[#101828]"><ArrowLeft size={14} className="transition-transform duration-300 ease-out group-hover:-translate-x-0.5" /> Home</Link>
          <div className="rs-login-card rounded-[28px] border border-[#e3e7ec] bg-white p-7 shadow-float sm:p-8">
            {body}
          </div>
        </div>
      </main>
    </div>
  )
}
