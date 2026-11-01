import { X } from 'lucide-react'
import { clampPopover } from '../lib/flow'

// The floating card that opens over the graph when a node is clicked: what the event is, every value in it, and what the
// OCEL log recorded for it. Context events show their recorded values too, even though they never change the total.
export default function NodePopover({ node, desc, facts, anchor, size, onClose }) {
  const W = 340
  const pos = clampPopover(anchor.x, anchor.y, W, 360, size.w, size.h)
  const lines = desc?.lines ?? []
  const inputs = lines.filter((l) => l.kind === 'input')
  const steps = lines.filter((l) => l.kind === 'step')
  const recorded = desc?.recorded?.length
    ? desc.recorded
    : facts
    ? [{ label: 'Time', text: facts.timestamp }, ...(facts.objects?.length ? [{ label: 'Related objects', text: facts.objects.map((o) => `${o.type} ${o.id}`).join(', ') }] : []),
       ...Object.entries(facts.attributes || {}).map(([k, v]) => ({ label: k, text: String(v) }))]
    : []
  return (
    <div className="rs-popover absolute z-20 flex max-h-[360px] flex-col overflow-hidden rounded-xl border border-[#d5dbe1] bg-white/95 text-[12px] shadow-2xl backdrop-blur"
      style={{ left: pos.left, top: pos.top, width: W }} data-testid="node-popover" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start gap-2 border-b border-[#eef1f4] px-3 py-2">
        <span className="rounded-md border border-[#e2e6ea] bg-[#f4f6f8] px-1.5 py-0.5 font-mono text-[12px] font-bold">{node.id}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-[#101828]">{desc?.title || node.activity}</div>
          <div className="truncate font-mono text-[10.5px] text-[#8a97a3]">{node.activity}{node.hop != null ? ` · hop ${node.hop}` : node.is_target ? ' · target' : ''}</div>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded p-0.5 text-[#8a97a3] hover:bg-[#eef1f4]"><X size={14} /></button>
      </div>
      <div className="overflow-y-auto px-3 py-2">
        {desc?.meaning && <p className="mb-2 leading-relaxed text-[#5c6b7a]">{desc.meaning}</p>}
        {desc?.sources?.length > 0 && <Block title="Where each value comes from" rows={desc.sources.map((s) => [s.label, s.text, s.source])} />}
        {inputs.length > 0 && <Block title="Values in this event" rows={inputs.map((l) => [l.label, l.text, l.expr])} />}
        {steps.length > 0 && <Block title={desc.node_type === 'net' ? 'What it adds up' : 'How its total is worked out'} rows={steps.map((l) => [l.label, l.text, l.expr])} />}
        {desc?.total && <div className="mb-2 flex justify-between rounded-md bg-[#f4f6f8] px-2 py-1.5 font-bold"><span>{desc.total.label}</span><span className="font-mono">{desc.total.text}</span></div>}
        {recorded.length > 0 && <Block title="Recorded in the OCEL log" rows={recorded.map((r) => [r.label, r.text])} />}
        {desc?.note && <p className="text-[11px] leading-relaxed text-status-ordered">{desc.note}</p>}
        {!desc && recorded.length === 0 && <p className="text-[#8a97a3]">Nothing recorded for this event.</p>}
      </div>
    </div>
  )
}

function Block({ title, rows }) {
  return (
    <div className="mb-2">
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8a97a3]">{title}</div>
      <div className="rounded-md border border-[#e2e6ea]">
        {rows.map(([a, b, c], i) => (
          <div key={i} className="flex items-baseline justify-between gap-3 border-b border-[#eef1f4] px-2 py-1 last:border-b-0">
            <div className="min-w-0"><div className="font-semibold text-[#344054]">{a}</div>{c && <div className="break-words font-mono text-[10px] leading-snug text-[#8a97a3]">{c}</div>}</div>
            <div className="max-w-[55%] shrink-0 break-words text-right font-mono font-semibold text-[#101828]">{b}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
