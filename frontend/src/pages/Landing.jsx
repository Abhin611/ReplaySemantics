import { Link } from 'react-router-dom'
import { ArrowRight, Ban, CheckCircle2, GitBranch, History, Network, Play, Scale, Search, Shuffle, ShieldCheck, Upload } from 'lucide-react'
import { useSession } from '../lib/session'

const STEPS = [
  { icon: Search, title: 'Find the events', text: 'Start at the posted invoice and trace back through shared objects to every event that could have caused the loss.' },
  { icon: Shuffle, title: 'Check the order', text: 'Some events have no fixed order in the log. Swap them, keep every recorded value, and see whether the total moves.' },
  { icon: Play, title: 'Replay step by step', text: 'Watch each event apply in turn, with the total and the written-out calculation after every step.' },
  { icon: ShieldCheck, title: 'Give a verdict', text: 'If the order changes the answer and no policy settles it, the system says so instead of inventing a number.' },
]
const VERDICTS = [
  { icon: CheckCircle2, name: 'PASS', color: 'text-emerald-300', ring: 'ring-emerald-400/30', text: 'Every legitimate order gives the same total. The outcome is well-defined.' },
  { icon: Scale, name: 'POLICY-ORDERED', color: 'text-amber-300', ring: 'ring-amber-400/30', text: 'Orders disagree, but a versioned policy rule fixes which one counts.' },
  { icon: Ban, name: 'BLOCKED', color: 'text-rose-300', ring: 'ring-rose-400/30', text: 'Orders disagree and nothing settles it. Attribution is refused, on the record.' },
]
const FEATURES = [
  { icon: Upload, title: 'Bring your own event log', text: 'Paste a link or upload an OCEL 2.0 file. Your logs stay in your profile, ready to reopen.' },
  { icon: Network, title: 'See the whole case', text: 'The log turns into an interactive graph, event by event, with every recorded value on its node.' },
  { icon: History, title: 'Every action remembered', text: 'Each run is saved to your history. Pick any number of actions and get a comparison report.' },
]

// A real result from the benchmark (case RSC-2026-00040): the same two events, in the two possible orders.
function OrderDemo() {
  const rows = [
    { order: ['e3', 'e4'], names: 'discount, then tax', total: '906,570.00', note: 'the order that was posted', tone: 'text-teal-300' },
    { order: ['e4', 'e3'], names: 'tax, then discount', total: '897,504.30', note: '9,065.70 lower', tone: 'text-rose-300' },
  ]
  return (
    <div className="rs-landing-card rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl backdrop-blur">
      <div className="mb-4 flex items-center justify-between gap-3 text-[11px] uppercase tracking-wider text-[#8fa3b5]">
        <span>Same events, same values</span>
        <span className="rounded-full bg-amber-400/10 px-2.5 py-1 font-semibold normal-case tracking-normal text-amber-300">order-sensitive</span>
      </div>
      <div className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <div key={r.names} className="rs-landing-row rounded-xl border border-white/10 bg-navy-950/60 p-4" style={{ animationDelay: `${i * 0.5}s` }}>
            <div className="flex items-center gap-2">
              {r.order.map((n, k) => (
                <span key={n} className="flex items-center gap-2">
                  {k > 0 && <ArrowRight size={14} className="text-[#5f7486]" />}
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-teal-400/70 bg-teal-400/10 text-[12px] font-bold text-teal-200">{n}</span>
                </span>
              ))}
              <ArrowRight size={14} className="text-[#5f7486]" />
              <span className="text-[11.5px] text-[#8fa3b5]">{r.names}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[24px] font-bold tracking-tight text-white">{r.total}</span>
              <span className={`text-[12px] font-semibold ${r.tone}`}>{r.note}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11.5px] leading-relaxed text-[#8fa3b5]">From a synthetic benchmark case. Which total is right? ReplaySemantics checks the policy before it answers.</p>
    </div>
  )
}

export default function Landing() {
  const { profile } = useSession()
  const cta = profile ? { to: '/dashboard', label: 'Open your dashboard' } : { to: '/login', label: 'Get started' }
  return (
    <div className="h-screen overflow-y-auto bg-navy-950 text-white">
      <header className="sticky top-0 z-20 border-b border-white/5 bg-navy-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-teal-400 to-teal-500"><GitBranch size={17} strokeWidth={2.5} /></span>
            <span className="text-[15px] font-bold tracking-tight">ReplaySemantics</span>
          </Link>
          <Link to={cta.to} className="rounded-lg bg-white px-3.5 py-2 text-[12.5px] font-semibold text-navy-950 transition-colors hover:bg-teal-300">
            {profile ? 'Dashboard' : 'Log in'}
          </Link>
        </div>
      </header>

      <section className="rs-landing-hero relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:py-24">
          <div>
            <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-teal-300">Counterfactual replay for ERP losses</p>
            <h1 className="text-[34px] font-extrabold leading-[1.1] tracking-tight sm:text-[50px]">
              When events cause a loss, the order can change the answer.
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[#b4c3d0]">
              ReplaySemantics replays the events behind a realized financial loss in object-centric ERP data, tests whether their order changes the
              outcome, and refuses to attribute a number it cannot defend.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to={cta.to} className="inline-flex items-center gap-2 rounded-lg bg-teal-400 px-5 py-3 text-[13.5px] font-bold text-navy-950 transition-colors hover:bg-teal-300">
                {cta.label} <ArrowRight size={16} />
              </Link>
              <a href="#how" className="rounded-lg border border-white/15 px-5 py-3 text-[13.5px] font-semibold text-white transition-colors hover:bg-white/10">How it works</a>
            </div>
          </div>
          <OrderDemo />
        </div>
      </section>

      <section id="how" className="border-t border-white/5 bg-navy-900 py-14 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-[26px] font-bold tracking-tight sm:text-[32px]">How it works</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[#9fb0bf]">Four steps, from a posted invoice to a verdict you can stand behind.</p>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => {
              const Icon = s.icon
              return (
                <li key={s.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-400/10 text-teal-300"><Icon size={19} /></span>
                    <span className="text-[12px] font-bold text-[#5f7486]">0{i + 1}</span>
                  </div>
                  <h3 className="mt-4 text-[14.5px] font-bold">{s.title}</h3>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#9fb0bf]">{s.text}</p>
                </li>
              )
            })}
          </ol>
        </div>
      </section>

      <section className="border-t border-white/5 py-14 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-[26px] font-bold tracking-tight sm:text-[32px]">Three possible verdicts. Never a guess.</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {VERDICTS.map((v) => {
              const Icon = v.icon
              return (
                <div key={v.name} className={`rounded-2xl bg-white/[0.03] p-6 ring-1 ${v.ring}`}>
                  <Icon size={22} className={v.color} />
                  <div className={`mt-3 text-[14px] font-bold tracking-wide ${v.color}`}>{v.name}</div>
                  <p className="mt-2 text-[13px] leading-relaxed text-[#b4c3d0]">{v.text}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-white/5 bg-navy-900 py-14 sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 md:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <div key={f.title}>
                <Icon size={20} className="text-teal-300" />
                <h3 className="mt-3 text-[15px] font-bold">{f.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#9fb0bf]">{f.text}</p>
              </div>
            )
          })}
        </div>
      </section>

      <section className="border-t border-white/5 py-16 text-center">
        <div className="mx-auto max-w-2xl px-4">
          <h2 className="text-[26px] font-bold tracking-tight sm:text-[32px]">Replay your first case</h2>
          <p className="mt-3 text-[14px] text-[#9fb0bf]">Sign in, load an event log, and see what the order of events really does.</p>
          <Link to={cta.to} className="mt-7 inline-flex items-center gap-2 rounded-lg bg-teal-400 px-5 py-3 text-[13.5px] font-bold text-navy-950 transition-colors hover:bg-teal-300">
            {cta.label} <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/5 px-4 py-6 text-center text-[11.5px] leading-relaxed text-[#6f8496]">
        ReplaySemantics: a policy-conditioned framework for multi-event counterfactual replay in object-centric ERP systems.
      </footer>
    </div>
  )
}
