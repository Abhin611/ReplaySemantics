import { ArrowLeftRight } from 'lucide-react'
import Card from './Card'
import StatusBadge from './StatusBadge'
import { pairDetails, pairSentence } from '../lib/verdict'

// Stage 3/4: the event pairs whose correction order really changes the total, and whether the
// policy fixes their order. Click a row to highlight the two events on the graph.
export default function OrderSensitivityCard({ result, nodeStatus, eventLookup = {}, selected, onSelect }) {
  if (result?.stage_3_confluence_checks?.status !== 'complete') return null
  const pairs = pairDetails(result)

  return (
    <Card>
      <div className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-[#101828]">
        <ArrowLeftRight size={13} /> Order-sensitive pairs
      </div>
      {pairs.length === 0 ? (
        <p className="text-[11.5px] leading-relaxed text-[#5c6b7a]">
          No pair disagreed: every legitimate order of the corrections gives the same total.
        </p>
      ) : (
        <>
          <p className="mb-3 text-[11.5px] leading-relaxed text-[#8a97a3]">
            Applying these corrections in a different order changes the total. Click a line to highlight the
            two events.
          </p>
          <ul className="flex max-h-[360px] flex-col gap-1.5 overflow-y-auto pr-1">
            {pairs.map((p) => {
              const isSel = selected && selected.a === p.a && selected.b === p.b
              return (
                <li key={`${p.a}-${p.b}`}>
                  <button
                    onClick={() => onSelect?.(isSel ? null : p)}
                    className={`w-full rounded-lg border px-2.5 py-2 text-left text-[12px] leading-snug transition-colors ${
                      isSel
                        ? 'border-amber-400 bg-amber-50 text-amber-900'
                        : 'border-[#e2e6ea] bg-white text-[#101828] hover:border-teal-300 hover:bg-teal-50'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold">
                        {p.a} ⇄ {p.b}
                      </span>
                      <StatusBadge
                        status={p.status === 'blocked' ? 'BLOCKED' : 'POLICY-ORDERED'}
                        className="!px-1.5 !py-0.5 !text-[10px]"
                      />
                    </div>
                    <div className="text-[11px] text-[#5c6b7a]">{pairSentence(p, nodeStatus, eventLookup)}</div>
                    <div className="mt-0.5 text-[10.5px] text-[#8a97a3]">
                      swapping them matters in {p.subsets_order_sensitive} subset
                      {p.subsets_order_sensitive === 1 ? '' : 's'}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Card>
  )
}
