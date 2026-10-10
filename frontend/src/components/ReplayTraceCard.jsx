import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'
import Card from './Card'
import { traceSteps, correctionLabel } from '../lib/verdict'
import { formatAmount } from '../lib/format'

// Step through R_P(X, E): the corrections applied one at a time, with the case total after each.
// The step's event is highlighted on the graph (onStepNode). `replay` is
// stage_5_verdict.replay_of_all_corrections from the real backend.
export default function ReplayTraceCard({ replay, nodeStatus, onStepNode }) {
  const steps = useMemo(() => traceSteps(replay), [replay])
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(false)
  const last = steps.length - 1

  useEffect(() => {
    setI(0)
    setPlaying(false)
  }, [replay])

  useEffect(() => {
    if (!playing) return undefined
    if (i >= last) {
      setPlaying(false)
      return undefined
    }
    const t = setTimeout(() => setI((x) => Math.min(last, x + 1)), 1100)
    return () => clearTimeout(t)
  }, [playing, i, last])

  useEffect(() => {
    onStepNode?.(steps[i]?.nodeId ?? null)
  }, [i, steps]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!replay || steps.length <= 1) return null
  const cur = steps[i]
  const prev = steps[i - 1]
  const delta = prev ? Number(cur.net) - Number(prev.net) : null

  return (
    <Card>
      <div className="mb-1 text-[13px] font-bold text-[#101828]">Replay step-through</div>
      <p className="mb-3 text-[11.5px] leading-relaxed text-[#8a97a3]">
        {replay.order_is_authoritative
          ? 'Corrections applied in the authoritative order.'
          : 'Illustrative canonical order only — the case is BLOCKED, so this is not an authoritative outcome.'}
      </p>

      <div className="mb-3 flex flex-wrap gap-1">
        {steps.map((s) => (
          <button
            key={s.index}
            onClick={() => {
              setPlaying(false)
              setI(s.index)
            }}
            className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${
              s.index === i
                ? 'border-amber-400 bg-amber-50 font-bold text-amber-900'
                : s.index < i
                ? 'border-teal-300 bg-teal-50 text-teal-800'
                : 'border-[#e2e6ea] text-[#8a97a3]'
            }`}
            title={s.index === 0 ? 'observed (as posted)' : `apply ${s.nodeId}`}
          >
            {s.index === 0 ? 'X' : s.nodeId}
          </button>
        ))}
      </div>

      <div className="rounded-lg bg-[#f4f6f8] px-3 py-2 text-[12px]">
        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#8a97a3]">
          {i === 0 ? 'Observed (as posted)' : `After step ${i}: ${cur.nodeId}`}
        </div>
        <div className="font-mono text-[16px] font-bold text-[#101828]">{formatAmount(cur.net)}</div>
        {delta !== null && (
          <div className="text-[11px] text-[#5c6b7a]">
            {delta === 0 ? 'no change in total' : `${delta > 0 ? '+' : ''}${formatAmount(delta)} vs previous step`}
            {nodeStatus?.[cur.nodeId]?.correction && ` · ${correctionLabel(nodeStatus[cur.nodeId].correction)}`}
          </div>
        )}
        {cur.applied === false && (
          <div className="text-[11px] text-[#8a97a3]">
            {cur.reason === 'exempt' ? 'approved exception — correction skipped' : 'context event — nothing to correct'}
          </div>
        )}
        {cur.changed.length > 0 && (
          <ul className="mt-1 text-[11px] text-[#5c6b7a]">
            {cur.changed.slice(0, 4).map((c, k) => (
              <li key={k} className="font-mono">
                {c.node}.{c.field}: {fmtField(c.field, c.before)} → {fmtField(c.field, c.after)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <IconBtn onClick={() => { setPlaying(false); setI(0) }} label="Reset" disabled={i === 0}><RotateCcw size={14} /></IconBtn>
          <IconBtn onClick={() => { setPlaying(false); setI((x) => Math.max(0, x - 1)) }} label="Previous step" disabled={i === 0}><ChevronLeft size={14} /></IconBtn>
          <IconBtn onClick={() => setPlaying((p) => (i >= last ? false : !p))} label={playing ? 'Pause' : 'Play'} disabled={i >= last}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </IconBtn>
          <IconBtn onClick={() => { setPlaying(false); setI((x) => Math.min(last, x + 1)) }} label="Next step" disabled={i >= last}><ChevronRight size={14} /></IconBtn>
        </div>
        <div className="text-right text-[11px] text-[#8a97a3]">
          compliant total {formatAmount(replay.compliant_net)}
          {i === last && (
            <div className={replay.reaches_compliant_net ? 'font-semibold text-status-pass' : 'font-semibold text-status-ordered'}>
              {replay.reaches_compliant_net ? 'reached ✓' : 'not reached'}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

// Amounts get thousands grouping; rates, quantities, modes etc. are shown exactly as stored.
const EXACT_FIELDS = new Set(['rate', 'fx_rate', 'decimals', 'mode', 'quantity', 'unit_price', 'slot'])
function fmtField(field, value) {
  if (!EXACT_FIELDS.has(field)) return formatAmount(value)
  const n = Number(value)
  return Number.isNaN(n) ? String(value) : String(n) // 0.180000 -> 0.18, ROUND_DOWN stays text
}

function IconBtn({ children, onClick, label, disabled }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className="rounded-md border border-[#e2e6ea] p-1.5 text-[#5c6b7a] hover:bg-[#f2f4f6] disabled:opacity-30"
    >
      {children}
    </button>
  )
}
