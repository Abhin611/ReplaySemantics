import { Search, Shuffle, Play, ShieldCheck } from 'lucide-react'

// Empty-state explainer for the Replay Console: the whole method in four steps, readable at a glance.
// Shown where the graph will appear, until a case has been run.
const STEPS = [
  {
    icon: Search,
    title: 'Find the events',
    text: 'Trace back from the posted invoice to the handful of events (3 to 8) that could have caused the loss.',
  },
  {
    icon: Shuffle,
    title: 'Check the order',
    text: 'Some events have no fixed order in the log. Swap them and see whether the total changes.',
  },
  {
    icon: Play,
    title: 'Replay the corrections',
    text: 'Correct each event to what policy allows and recalculate the total, one step at a time.',
  },
  {
    icon: ShieldCheck,
    title: 'Verdict, then attribution',
    text: 'PASS, POLICY-ORDERED or BLOCKED. Only a valid replay is allowed to split the loss between events.',
  },
]

export default function HowItWorks() {
  return (
    <div className="flex h-full flex-col justify-center px-6 py-5">
      <div className="mb-4 text-center">
        <div className="text-[15px] font-bold text-[#101828]">How ReplaySemantics works</div>
        <div className="mt-0.5 text-[12.5px] text-[#5c6b7a]">
          Pick a case above and press <span className="font-semibold text-[#101828]">Run Replay</span>.
        </div>
      </div>
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          return (
            <li key={s.title} className="relative rounded-xl border border-[#e2e6ea] bg-white p-3.5 shadow-card">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/10 text-teal-500">
                  <Icon size={15} />
                </span>
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-[#8a97a3]">Step {i + 1}</span>
              </div>
              <div className="text-[13px] font-bold text-[#101828]">{s.title}</div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-[#5c6b7a]">{s.text}</p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// Compact one-row version for the Dashboard: the same four steps, no card chrome.
export function HowItWorksStrip() {
  return (
    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {STEPS.map((s, i) => {
        const Icon = s.icon
        return (
          <li key={s.title} className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-500">
              <Icon size={17} />
            </span>
            <div className="min-w-0">
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-[#8a97a3]">Step {i + 1}</div>
              <div className="text-[13px] font-bold text-[#101828]">{s.title}</div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-[#5c6b7a]">{s.text}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
