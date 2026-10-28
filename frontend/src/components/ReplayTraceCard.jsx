import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'
import Card from './Card'
import CalcTable from './CalcTable'
import { traceSteps, correctionLabel, observedExplanation } from '../lib/verdict'
import { formatAmount } from '../lib/format'

// Step through R_P(X, E): the corrections applied one at a time, with the case total after each.
// The step's event is highlighted on the graph (onStepNode). `replay` is
// stage_5_verdict.replay_of_all_corrections from the real backend.
export default function ReplayTraceCard({ replay, nodeStatus, onStepNode, title = 'Replay step-through', nonAuthoritativeNote }) {
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

  // Bring the newest stage into view by scrolling only the panel that holds this card (not the whole page),
  // leaving the case bar and graph where they are. Skipped on first load / reset.
  const newestRef = useRef(null)
  useEffect(() => {
    const el = newestRef.current
    if (i === 0 || !el) return
    let p = el.parentElement
    while (p && !(['auto', 'scroll'].includes(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight)) p = p.parentElement
    if (!p) return
    const HEADER = 110 // the pinned controls + chips
    p.scrollBy({ top: el.getBoundingClientRect().top - p.getBoundingClientRect().top - HEADER, behavior: 'smooth' })
  }, [i])

  if (!replay || steps.length <= 1) return null

  return (
    <Card>
      <div className="mb-1 text-[13px] font-bold text-[#101828]">{title}</div>
      <p className="mb-2 text-[11.5px] leading-relaxed text-[#8a97a3]">
        {replay.order_is_authoritative
          ? 'Corrections applied in the authoritative order.'
          : nonAuthoritativeNote || 'Illustrative canonical order only — the case is BLOCKED, so this is not an authoritative outcome.'}
      </p>

      {/* Controls and stage chips stay pinned while the flowchart below grows */}
      <div className="sticky top-0 z-10 -mx-5 mb-3 border-b border-[#eef1f4] bg-white px-5 pb-2.5 pt-1">
      <div className="flex items-center justify-between">
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
      <div className="mt-2 flex flex-wrap gap-1">
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
      </div>

      {/* Flowchart: each stage stays on screen; the next one appears below an arrow as the replay advances. */}
      <div className="flex flex-col items-stretch">
        {steps.slice(0, i + 1).map((st, k) => {
          const before = steps[k - 1]
          const isCur = k === i
          return (
            <div key={st.index} ref={isCur ? newestRef : null} className="rs-stage-in flex flex-col items-stretch">
              {before && <StageArrow label={`apply ${st.nodeId}`} />}
              <StageBox
                step={st}
                before={before}
                isCur={isCur}
                correction={nodeStatus?.[st.nodeId]?.correction}
                breakdown={replay.observed_breakdown}
                prevCalc={before?.calculation}
                onClick={() => {
                  setPlaying(false)
                  onStepNode?.(st.nodeId ?? null)
                }}
              />
            </div>
          )
        })}
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

// One stage of the flowchart: the case total after this step, what moved, and the realised loss.
function StageBox({ step, before, isCur, correction, breakdown, prevCalc, onClick }) {
  const delta = before ? Number(step.net) - Number(before.net) : null
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border px-3 py-2 text-left text-[12px] transition-colors ${
        isCur ? 'border-amber-400 bg-amber-50' : 'border-teal-300 bg-teal-50/60 hover:bg-teal-50'
      }`}
    >
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#8a97a3]">
        {step.index === 0 ? 'Stage 0 · Observed (as posted)' : `Stage ${step.index} · ${step.nodeId}`}
      </div>
      <div className="font-mono text-[16px] font-bold text-[#101828]">{formatAmount(step.net)}</div>
      {step.index === 0 &&
        (step.calculation ? (
          <>
            <div className="mt-0.5 text-[11px] text-[#5c6b7a]">How this posted total was calculated:</div>
            <CalcTable rows={step.calculation.rows} />
          </>
        ) : (
          <div className="mt-0.5 text-[11px] leading-relaxed text-[#5c6b7a]">{observedExplanation(breakdown, formatAmount)}</div>
        ))}
      {delta !== null && (
        <div className="text-[11px] text-[#5c6b7a]">
          {delta === 0 ? 'no change in total' : `${delta > 0 ? '+' : ''}${formatAmount(delta)} vs previous stage`}
          {correction && ` · ${correctionLabel(correction)}`}
        </div>
      )}
      {step.loss != null && (
        <div className="mt-0.5 text-[11px] text-[#5c6b7a]">
          realised loss <span className="font-mono font-semibold text-[#101828]">{formatAmount(step.loss)}</span>
          {before?.loss != null && Number(step.loss) !== Number(before.loss) && (
            <> ({Number(step.loss) - Number(before.loss) > 0 ? '+' : '−'}{formatAmount(Math.abs(Number(step.loss) - Number(before.loss)))} vs previous stage)</>
          )}
        </div>
      )}
      {step.applied === false && (
        <div className="text-[11px] text-[#8a97a3]">
          {step.reason === 'exempt' ? 'approved exception — correction skipped' : 'context event — nothing to correct'}
        </div>
      )}
      {step.changed.length > 0 && (
        <ul className="mt-1 text-[11px] text-[#5c6b7a]">
          {step.changed.slice(0, 4).map((c, k) => (
            <li key={k} className="font-mono">
              {c.node}.{c.field}: {fmtField(c.field, c.before)} → {fmtField(c.field, c.after)}
            </li>
          ))}
        </ul>
      )}
      {step.index > 0 && step.calculation && (
        <>
          <div className="mt-1.5 text-[11px] text-[#5c6b7a]">Total recalculated (changed lines highlighted):</div>
          <CalcTable rows={step.calculation.rows} prevRows={prevCalc?.rows} />
        </>
      )}
    </button>
  )
}

// Connector between two stages: a short vertical line ending in an arrowhead, labelled with the event applied.
function StageArrow({ label }) {
  return (
    <div className="flex items-center gap-2 py-0.5 pl-6" aria-hidden="true">
      <svg width="14" height="30" viewBox="0 0 14 30" className="shrink-0 text-teal-600">
        <line x1="7" y1="0" x2="7" y2="22" stroke="currentColor" strokeWidth="1.8" />
        <path d="M2 18 L7 27 L12 18 Z" fill="currentColor" />
      </svg>
      <span className="font-mono text-[10.5px] text-[#8a97a3]">{label}</span>
    </div>
  )
}
