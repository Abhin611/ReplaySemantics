import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, ArrowLeftRight, Ban, CheckCircle2, GitBranch, History, Network, Play, Scale, Search, Shuffle, ShieldCheck, Upload } from 'lucide-react'
import { useSession } from '../lib/session'
import { Reveal, useReveal } from '../lib/useReveal'
import SwapDemo from '../components/SwapDemo'

const STEPS = [
  { icon: Search, title: 'Find the events', text: 'Start at the posted invoice and trace back through shared objects to every event that could have caused the loss.' },
  { icon: Shuffle, title: 'Check the order', text: 'Some events have no fixed order in the log. Swap them, keep every recorded value, and see whether the total moves.' },
  { icon: Play, title: 'Replay step by step', text: 'Watch each event apply in turn, with the total and the written-out calculation after every step.' },
  { icon: ShieldCheck, title: 'Give a verdict', text: 'If the order changes the answer and no policy settles it, the system says so instead of inventing a number.' },
]
// The same pair of orders, three ways it can end.
const VERDICTS = [
  { icon: CheckCircle2, name: 'PASS', tone: 'text-emerald-300', bar: 'bg-emerald-400', text: 'Every legitimate order gives the same total. The outcome is well-defined.',
    rows: [['e3 → e4', '906,570.00', 'keep'], ['e4 → e3', '906,570.00', 'keep']], foot: 'One total. Attribution allowed.' },
  { icon: Scale, name: 'POLICY-ORDERED', tone: 'text-amber-300', bar: 'bg-amber-400', text: 'Orders disagree, but a versioned policy rule fixes which one counts.',
    rows: [['e3 → e4', '906,570.00', 'keep'], ['e4 → e3', '897,504.30', 'drop']], foot: 'The policy picks the order. Attribution allowed.' },
  { icon: Ban, name: 'BLOCKED', tone: 'text-rose-300', bar: 'bg-rose-400', text: 'Orders disagree and nothing settles it. Attribution is refused, on the record.',
    rows: [['e3 → e4', '906,570.00', 'open'], ['e4 → e3', '897,504.30', 'open']], foot: 'No rule decides. No number is issued.' },
]
const FEATURES = [
  { icon: Upload, title: 'Bring your own event log', text: 'Paste a link or upload an OCEL 2.0 file. Your logs stay in your profile, ready to reopen.' },
  { icon: Network, title: 'See the whole case', text: 'The log turns into an interactive graph, event by event, with every recorded value on its node.' },
  { icon: History, title: 'Every action remembered', text: 'Each run is saved to your history. Pick any number of actions and get a comparison report.' },
]
// docs/benchmark_results.json: 60 synthetic cases, graded against the sealed truth.
const BENCH = [
  { name: 'ReplaySemantics', accuracy: 1.0, falseAttr: 0.0, own: true },
  { name: 'Naive sequential', accuracy: 0.2667, falseAttr: 0.1833 },
  { name: 'Naive split', accuracy: 0.2667, falseAttr: 0.2333 },
]
const pct = (x) => `${Math.round(x * 100)}%`

function Brand() {
  return (
    <Link to="/" className="group flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-teal-400 to-teal-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_10px_-4px_rgba(42,157,143,0.8)] transition-transform duration-500 ease-spring group-hover:rotate-[-8deg] group-hover:scale-105">
        <GitBranch size={17} strokeWidth={2.5} />
      </span>
      <span className="text-[15px] font-bold tracking-tight">ReplaySemantics</span>
    </Link>
  )
}

// The four steps sit on one line that draws itself across when the section scrolls into view.
function Pipeline() {
  const [ref, shown] = useReveal({ threshold: 0.35 })
  return (
    <ol ref={ref} className={`rs-pipeline relative mt-12 grid gap-10 md:grid-cols-4 md:gap-6 ${shown ? 'is-in' : ''}`}>
      <span aria-hidden="true" className="rs-pipeline-line absolute left-[21px] top-0 h-full w-px bg-gradient-to-b from-teal-400/70 to-teal-400/10 md:left-0 md:top-[21px] md:h-px md:w-full md:bg-gradient-to-r" />
      {STEPS.map((s, i) => {
        const Icon = s.icon
        return (
          <li key={s.title} className="rs-pipeline-step relative flex gap-4 md:block" style={{ transitionDelay: `${250 + i * 180}ms` }}>
            <span className="relative z-10 flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border border-teal-400/40 bg-navy-900 text-teal-300 shadow-[0_0_0_6px_#0d1b29]">
              <Icon size={18} />
            </span>
            <div className="md:mt-5">
              <h3 className="text-[15px] font-bold">{s.title}</h3>
              <p className="mt-1.5 max-w-[34ch] text-[13px] leading-relaxed text-[#a9b8c5]">{s.text}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function BenchBars({ metric, label, note }) {
  const [ref, shown] = useReveal({ threshold: 0.4 })
  return (
    <div ref={ref}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-bold">{label}</h3>
        <span className="text-[11.5px] text-[#8fa3b5]">{note}</span>
      </div>
      <ul className="mt-4 flex flex-col gap-3.5">
        {BENCH.map((b, i) => (
          <li key={b.name}>
            <div className="flex items-baseline justify-between text-[12.5px]">
              <span className={b.own ? 'font-bold text-white' : 'text-[#a9b8c5]'}>{b.name}</span>
              <span className={`font-bold ${b.own ? 'text-teal-300' : 'text-[#a9b8c5]'}`}>{pct(b[metric])}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.07]">
              <div className={`h-full origin-left rounded-full transition-transform duration-[1100ms] ease-out ${b.own ? 'bg-teal-400' : 'bg-[#5f7486]'}`}
                style={{ width: `${Math.max(b[metric] * 100, 1.2)}%`, transform: shown ? 'scaleX(1)' : 'scaleX(0)', transitionDelay: `${i * 140}ms` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Landing() {
  const { profile } = useSession()
  const cta = profile ? { to: '/dashboard', label: 'Open your dashboard' } : { to: '/login', label: 'Get started' }
  const [swapped, setSwapped] = useState(false)
  const touched = useRef(false)
  const scroller = useRef(null)
  const hero = useRef(null)
  const [scrolled, setScrolled] = useState(false)

  // Show the idea once without being asked: a moment after the page opens, the two events trade places.
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined
    const t = setTimeout(() => { if (!touched.current) setSwapped(true) }, 2600)
    return () => clearTimeout(t)
  }, [])
  const swap = (next) => { touched.current = true; setSwapped((s) => (typeof next === 'boolean' ? next : !s)) }
  const swapFromButton = () => {
    swap()
    document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
  // The hero's light follows the pointer.
  const onMove = (e) => {
    const el = hero.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }

  return (
    <div ref={scroller} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 24)}
      className="h-screen overflow-y-auto scroll-smooth bg-navy-950 text-white [scroll-padding-top:92px]">
      <header className="pointer-events-none sticky top-0 z-30 px-3 pt-3 sm:px-5">
        <div className={`rs-nav-in pointer-events-auto mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-[20px] px-3.5 py-2.5 transition-[background-color,box-shadow,border-color] duration-500 ${
          scrolled ? 'rs-glass-dark' : 'border border-transparent'}`}>
          <Brand />
          <nav aria-label="Sections" className="hidden items-center gap-1 text-[13px] text-[#b4c3d0] md:flex">
            {[['#how', 'How it works'], ['#verdicts', 'Verdicts'], ['#benchmark', 'Benchmark']].map(([href, label]) => (
              <a key={href} href={href} className="rounded-xl px-3 py-2 transition-colors hover:bg-white/[0.07] hover:text-white">{label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {!profile && <Link to="/login" className="hidden rounded-xl px-3 py-2 text-[13px] font-semibold text-[#b4c3d0] transition-colors hover:bg-white/[0.07] hover:text-white sm:block">Log in</Link>}
            <Link to={cta.to} className="rs-press rounded-xl bg-white px-3.5 py-2 text-[12.5px] font-bold text-navy-950 transition-colors hover:bg-teal-300">
              {profile ? 'Dashboard' : 'Get started'}
            </Link>
          </div>
        </div>
      </header>

      <section ref={hero} onPointerMove={onMove} className="rs-hero relative -mt-[68px] overflow-hidden pt-[68px]">
        <div aria-hidden="true" className="rs-hero-grid pointer-events-none absolute inset-0" />
        <div aria-hidden="true" className="rs-hero-light pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pb-28 lg:pt-24">
          <div className="rs-hero-copy">
            <h1 className="text-[36px] font-extrabold leading-[1.06] tracking-[-0.035em] sm:text-[54px]">
              When events cause a loss, the order can change the answer.
            </h1>
            <p className="mt-6 max-w-[54ch] text-[15px] leading-relaxed text-[#b4c3d0]">
              ReplaySemantics replays the events behind a realized financial loss in object-centric ERP data, tests whether their order changes the
              outcome, and refuses to attribute a number it cannot defend.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link to={cta.to} className="rs-press group inline-flex items-center gap-2 rounded-2xl bg-teal-400 px-5 py-3.5 text-[13.5px] font-bold text-navy-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_14px_30px_-12px_rgba(69,179,165,0.7)] transition-colors hover:bg-teal-300">
                {cta.label} <ArrowRight size={16} className="transition-transform duration-300 ease-out group-hover:translate-x-1" />
              </Link>
              <button type="button" onClick={swapFromButton} data-testid="hero-swap"
                className="group inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.05] px-5 py-3.5 text-[13.5px] font-semibold text-white backdrop-blur transition-colors hover:bg-white/[0.12]">
                <ArrowLeftRight size={16} className="text-teal-300 transition-transform duration-500 ease-spring group-hover:rotate-180" />
                {swapped ? 'Put the order back' : 'Swap the order'}
              </button>
              <a href="#how" className="group inline-flex items-center gap-1.5 rounded-2xl px-3 py-3.5 text-[13.5px] font-semibold text-[#b4c3d0] transition-colors hover:text-white">
                How it works <ArrowDown size={15} className="transition-transform duration-300 ease-out group-hover:translate-y-0.5" />
              </a>
            </div>
          </div>
          <div id="demo" className="rs-hero-demo"><SwapDemo swapped={swapped} onChange={swap} /></div>
        </div>
      </section>

      <section id="how" className="border-t border-white/[0.06] bg-navy-900 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <h2 className="text-[28px] font-extrabold tracking-[-0.03em] sm:text-[38px]">From a posted invoice to a verdict you can stand behind.</h2>
            <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-[#a9b8c5]">Four steps, run in the same order on every case.</p>
          </Reveal>
          <Pipeline />
        </div>
      </section>

      <section id="verdicts" className="border-t border-white/[0.06] py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <h2 className="text-[28px] font-extrabold tracking-[-0.03em] sm:text-[38px]">Three possible verdicts. Never a guess.</h2>
            <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-[#a9b8c5]">The same two orders of the same two events can end three ways.</p>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {VERDICTS.map((v, i) => {
              const Icon = v.icon
              return (
                <Reveal key={v.name} delay={i * 110} className="rs-verdict group flex flex-col rounded-3xl border border-white/[0.08] bg-white/[0.03] p-6 transition-[border-color,background-color,transform] duration-500 ease-out hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.05]">
                  <div className={`flex items-center gap-2.5 text-[14px] font-bold tracking-wide ${v.tone}`}><Icon size={20} /> {v.name}</div>
                  <p className="mt-3 text-[13px] leading-relaxed text-[#b4c3d0]">{v.text}</p>
                  <div className="mt-5 flex flex-col gap-2 rounded-2xl bg-navy-950/60 p-3.5 text-[12.5px]">
                    {v.rows.map(([order, total, state]) => (
                      <div key={order} className="flex items-center justify-between gap-3">
                        <span className="text-[#8fa3b5]">{order}</span>
                        <span className={`flex items-center gap-2 font-bold ${state === 'drop' ? 'text-[#6f8496] line-through decoration-[#6f8496]' : 'text-white'}`}>
                          {total}
                          <span className={`h-1.5 w-1.5 rounded-full ${state === 'keep' ? v.bar : state === 'drop' ? 'bg-[#5f7486]' : `${v.bar} rs-live-dot`}`} aria-hidden="true" />
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className={`mt-4 text-[12.5px] font-semibold ${v.tone}`}>{v.foot}</p>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      <section id="benchmark" className="border-t border-white/[0.06] bg-navy-900 py-20 sm:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <Reveal>
            <h2 className="text-[28px] font-extrabold tracking-[-0.03em] sm:text-[38px]">Checked against 60 sealed cases.</h2>
            <p className="mt-4 max-w-[52ch] text-[14.5px] leading-relaxed text-[#a9b8c5]">
              The benchmark hides its answers from the system. ReplaySemantics matched every one, and the two naive baselines, which replay in a single
              order and never test another, got about a quarter right and put a number on cases that should have been refused.
            </p>
            <p className="mt-4 max-w-[52ch] text-[12.5px] leading-relaxed text-[#8fa3b5]">Graded by the team's own oracle on synthetic cases, so 100% means agreement with that model.</p>
          </Reveal>
          <div className="grid gap-9 rounded-3xl border border-white/[0.08] bg-white/[0.03] p-6 sm:p-8">
            <BenchBars metric="accuracy" label="Verdicts classified correctly" note="higher is better" />
            <BenchBars metric="falseAttr" label="Numbers issued that cannot be defended" note="lower is better" />
          </div>
        </div>
      </section>

      <section className="border-t border-white/[0.06] py-20 sm:py-24">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 md:grid-cols-3">
          {FEATURES.map((f, i) => {
            const Icon = f.icon
            return (
              <Reveal key={f.title} delay={i * 110}>
                <Icon size={22} className="text-teal-300" />
                <h3 className="mt-4 text-[16px] font-bold">{f.title}</h3>
                <p className="mt-2 max-w-[40ch] text-[13.5px] leading-relaxed text-[#a9b8c5]">{f.text}</p>
              </Reveal>
            )
          })}
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-white/[0.06] py-24 text-center sm:py-32">
        <div aria-hidden="true" className="rs-cta-glow pointer-events-none absolute inset-0" />
        <Reveal className="relative mx-auto max-w-2xl px-4">
          <h2 className="text-[30px] font-extrabold tracking-[-0.035em] sm:text-[44px]">Replay your first case.</h2>
          <p className="mx-auto mt-4 max-w-[46ch] text-[14.5px] leading-relaxed text-[#b4c3d0]">Sign in, load an event log, and see what the order of events really does.</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link to={cta.to} className="rs-press group inline-flex items-center gap-2 rounded-2xl bg-teal-400 px-6 py-3.5 text-[14px] font-bold text-navy-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_14px_30px_-12px_rgba(69,179,165,0.7)] transition-colors hover:bg-teal-300">
              {cta.label} <ArrowRight size={16} className="transition-transform duration-300 ease-out group-hover:translate-x-1" />
            </Link>
            <a href="#demo" className="rounded-2xl border border-white/15 px-6 py-3.5 text-[14px] font-semibold text-white transition-colors hover:bg-white/[0.08]">See the swap again</a>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-white/[0.06] px-4 py-8 text-[12px] leading-relaxed text-[#8fa3b5]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 sm:px-2">
          <span>ReplaySemantics: a policy-conditioned framework for multi-event counterfactual replay in object-centric ERP systems.</span>
          <span>Team 20 · Dept. of CSE</span>
        </div>
      </footer>
    </div>
  )
}
