import { useState } from 'react'
import { Link2, Shuffle } from 'lucide-react'
import { constraintLists } from '../lib/flow'

// Below the graph: the two kinds of relationship between events, in two vertical tabs.
//   Locked by process  -- the log fixes the order (shared object, earlier timestamp)
//   Order not fixed    -- permutable pairs: nothing in the log says which came first
export default function ConstraintTabs({ result, eventLookup, onSelect }) {
  const { locked, toTarget, permutable } = constraintLists(result)
  const [tab, setTab] = useState('locked')
  const name = (id) => `${id}${eventLookup[id] ? ` · ${eventLookup[id]}` : ''}`
  const tabs = [
    { key: 'locked', label: 'Locked by process', n: locked.length, icon: Link2 },
    { key: 'free', label: 'Order not fixed (permutable)', n: permutable.length, icon: Shuffle },
  ]
  return (
    <div className="grid gap-3 rounded-2xl border border-[#e2e6ea] bg-white p-3 shadow-card md:grid-cols-[230px_minmax(0,1fr)]" data-testid="constraint-tabs">
      <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-1.5">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[12.5px] font-semibold transition-colors ${tab === t.key ? 'bg-navy-900 text-white' : 'bg-[#f4f6f8] text-[#344054] hover:bg-[#eaeef2]'}`}>
            <t.icon size={14} /> <span className="flex-1">{t.label}</span>
            <span className={`rounded-full px-1.5 text-[10.5px] ${tab === t.key ? 'bg-white/20' : 'bg-white'}`}>{t.n}</span>
          </button>
        ))}
        <p className="px-1 pt-1 text-[11px] leading-relaxed text-[#8a97a3]">
          {tab === 'locked' ? 'The log itself fixes these orders, so they are never swapped.' : 'Nothing in the log orders these, so the replay tests both orders.'}
        </p>
      </div>
      <div className="max-h-[260px] overflow-y-auto pr-1">
        {tab === 'locked' && (
          <>
            {locked.length === 0 && <p className="text-[12.5px] text-[#8a97a3]">No two candidate events are ordered by a shared object.</p>}
            {locked.map((c, i) => (
              <button key={i} onClick={() => onSelect?.({ type: 'constraint', before: c.before, after: c.after })}
                className="mb-1.5 block w-full rounded-lg border border-[#e2e6ea] px-3 py-2 text-left text-[12.5px] hover:bg-[#f7f9fa]">
                <b>{name(c.before)}</b> happens before <b>{name(c.after)}</b>
                <span className="block text-[11px] text-[#8a97a3]">{c.shared_object ? `they share ${c.shared_object} and the earlier timestamp comes first` : 'ordered through a chain of shared objects'}</span>
              </button>
            ))}
            {toTarget.length > 0 && <p className="mt-2 text-[11.5px] text-[#8a97a3]">Plus {toTarget.length} locks of every candidate before the target event.</p>}
          </>
        )}
        {tab === 'free' && (
          <>
            {permutable.length === 0 && <p className="text-[12.5px] text-[#8a97a3]">Every pair of candidates has a fixed order.</p>}
            {permutable.map((p, i) => (
              <button key={i} onClick={() => onSelect?.({ type: 'pairs', pairs: [[p.a, p.b]] })}
                className="mb-1.5 block w-full rounded-lg border border-[#e2e6ea] px-3 py-2 text-left text-[12.5px] hover:bg-[#f7f9fa]">
                <b>{name(p.a)}</b> ⇄ <b>{name(p.b)}</b>
                <span className="block text-[11px] text-[#8a97a3]">no object ties them in time: either could have come first</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
