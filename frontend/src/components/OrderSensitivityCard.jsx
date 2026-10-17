import { ArrowLeftRight, Check, FlaskConical } from 'lucide-react'
import Card from './Card'
import StatusBadge from './StatusBadge'
import { pairDetails, pairSentence } from '../lib/verdict'
import { MAX_SCENARIO_EVENTS, samePair, unionEvents } from '../lib/scenario'

// Stage 3/4: the event pairs whose correction order really changes the total, and whether the policy
// fixes their order. Click lines to select one OR SEVERAL pairs (they are highlighted on the graph);
// "Run change" then corrects every event in the selected pairs together and opens the Corrected Scenario.
export default function OrderSensitivityCard({
  result,
  nodeStatus,
  eventLookup = {},
  selectedPairs = [],
  onToggle,
  onClear,
  onRun,
}) {
  if (result?.stage_3_confluence_checks?.status !== 'complete') return null
  const pairs = pairDetails(result)
  // only pairs that exist in THIS result can be selected (guards against a stale selection from another case)
  const chosen = selectedPairs.filter((sp) => pairs.some((p) => samePair(p, sp)))
  const events = unionEvents(chosen)
  const tooMany = events.length > MAX_SCENARIO_EVENTS
  const anyBlocked = chosen.some((p) => p.status === 'blocked')

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-2 text-[13px] font-bold text-[#101828]">
        <span className="flex items-center gap-1.5">
          <ArrowLeftRight size={13} /> Order-sensitive pairs
        </span>
        {pairs.length > 1 && (
          <span className="flex items-center gap-2 text-[11px] font-semibold">
            <button onClick={() => pairs.forEach((p) => !chosen.some((c) => samePair(c, p)) && onToggle?.(p))} className="text-teal-500 hover:underline">
              select all
            </button>
            {chosen.length > 0 && (
              <button onClick={() => onClear?.()} className="text-[#8a97a3] hover:underline">
                clear
              </button>
            )}
          </span>
        )}
      </div>
      {pairs.length === 0 ? (
        <p className="text-[11.5px] leading-relaxed text-[#5c6b7a]">
          No pair disagreed: every legitimate order of the corrections gives the same total.
        </p>
      ) : (
        <>
          <p className="mb-3 text-[11.5px] leading-relaxed text-[#8a97a3]">
            Applying these corrections in a different order changes the total. Click a line to select it; select more than
            one to see their combined effect.
          </p>
          <ul className="flex max-h-[360px] flex-col gap-1.5 overflow-y-auto pr-1">
            {pairs.map((p) => {
              const isSel = chosen.some((c) => samePair(c, p))
              return (
                <li key={`${p.a}-${p.b}`}>
                  <button
                    onClick={() => onToggle?.(p)}
                    aria-pressed={isSel}
                    className={`w-full rounded-lg border px-2.5 py-2 text-left text-[12px] leading-snug transition-colors ${
                      isSel
                        ? 'border-amber-400 bg-amber-50 text-amber-900'
                        : 'border-[#e2e6ea] bg-white text-[#101828] hover:border-teal-300 hover:bg-teal-50'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-mono font-semibold">
                        <span
                          className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                            isSel ? 'border-amber-500 bg-amber-500 text-white' : 'border-[#c2cad2] bg-white'
                          }`}
                        >
                          {isSel && <Check size={10} strokeWidth={3} />}
                        </span>
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
          {onRun && (
            <div className="mt-3 border-t border-[#eef1f4] pt-3">
              {chosen.length === 0 ? (
                <p className="text-[11px] text-[#8a97a3]">Select one or more pairs above to run their change.</p>
              ) : (
                <>
                  <button
                    onClick={() => onRun(chosen)}
                    disabled={tooMany}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-navy-900 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <FlaskConical size={14} />
                    {chosen.length === 1
                      ? `Run change · ${chosen[0].a} ⇄ ${chosen[0].b}`
                      : `Run change · ${chosen.length} pairs (${events.join(', ')})`}
                  </button>
                  <p className="mt-1.5 text-[11px] leading-snug text-[#8a97a3]">
                    {tooMany
                      ? `These pairs involve ${events.length} events; one change can correct at most ${MAX_SCENARIO_EVENTS}. Deselect a pair.`
                      : chosen.length > 1
                      ? `Corrects all ${events.length} events together (an event in two pairs is corrected once) and tries every legitimate order. ${
                          anyBlocked
                            ? 'A selected pair has no authoritative order, so the combined result is exploratory and no Shapley is issued.'
                            : 'The combined verdict decides whether the result is authoritative.'
                        }`
                      : chosen[0].status === 'blocked'
                      ? 'No authoritative order exists for this pair, so both orders are shown as exploratory and no Shapley is issued.'
                      : `Corrects both events${chosen[0].policy_first ? `, ${chosen[0].policy_first} first (the policy order)` : ''}, then shows the new graph, total, realised loss and Shapley.`}
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  )
}
