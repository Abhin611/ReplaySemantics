import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CornerDownRight } from 'lucide-react'
import { traceSteps } from '../lib/verdict'
import { formatAmount } from '../lib/format'
import AnimatedNumber from './AnimatedNumber'

// The replay as one horizontal line: Original graph -> event -> event -> ... each card with the case total after it, joined
// by arrows. When the line is too long it wraps to the next row and the arrow turns the corner. Each card lights up in turn.
export default function ReplayStrip({ replay, labels = {}, playKey, finishKey, delay, onStepNode, onEnd }) {
  const steps = useMemo(() => traceSteps(replay), [replay])
  const [shown, setShown] = useState(steps.length)
  const [cur, setCur] = useState(-1)
  const endRef = useRef(onEnd)
  endRef.current = onEnd
  const stepRef = useRef(onStepNode)
  stepRef.current = onStepNode

  useEffect(() => {
    if (playKey == null) { setShown(steps.length); setCur(-1); return undefined }
    if (!delay) { setShown(steps.length); setCur(-1); endRef.current?.('done'); return undefined }
    setShown(1); setCur(0)
    const t = []
    for (let i = 1; i < steps.length; i++) {
      t.push(setTimeout(() => { setShown(i + 1); setCur(i); stepRef.current?.(steps[i].nodeId) }, i * Math.max(600, delay * 0.55)))
    }
    t.push(setTimeout(() => { setCur(-1); stepRef.current?.(null); endRef.current?.('done') }, steps.length * Math.max(600, delay * 0.55) + 400))
    return () => t.forEach(clearTimeout)
  }, [playKey, steps, delay]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (finishKey) { setShown(steps.length); setCur(-1) } }, [finishKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!steps.length) return null
  return (
    <div className="flex flex-wrap items-stretch gap-y-4" data-testid="replay-strip">
      {steps.slice(0, shown).map((s, i) => {
        const prev = steps[i - 1]
        const delta = prev ? Number(s.net) - Number(prev.net) : null
        const on = i === cur
        return (
          <div key={s.index} className="flex items-center">
            {i > 0 && <ArrowRight size={22} className="mx-2 shrink-0 text-teal-600" />}
            <div className={`rs-step w-[190px] rounded-xl border px-3 py-2.5 transition-all ${on ? 'border-teal-500 bg-teal-50 shadow-lg ring-2 ring-teal-200' : 'border-[#e2e6ea] bg-white shadow-sm'}`}>
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#8a97a3]">
                {i === 0 ? 'Start · as posted' : `Step ${s.index}`}
              </div>
              <div className="truncate text-[12.5px] font-bold text-[#101828]">
                {i === 0 ? 'Original graph' : `${s.nodeId} · ${labels[s.nodeId] || 'event'}`}
              </div>
              <div className="mt-1 font-mono text-[15px] font-bold text-[#101828]">
                {on && prev ? <AnimatedNumber from={prev.net} value={s.net} format={formatAmount} ms={900} /> : formatAmount(s.net)}
              </div>
              {delta != null && (
                <div className={`font-mono text-[11px] font-semibold ${delta === 0 ? 'text-[#8a97a3]' : delta > 0 ? 'text-status-pass' : 'text-status-blocked'}`}>
                  {delta === 0 ? 'no change' : `${delta > 0 ? '+' : '−'}${formatAmount(Math.abs(delta))}`}
                </div>
              )}
              {s.loss != null && <div className="text-[10.5px] text-[#8a97a3]">loss {formatAmount(s.loss)}</div>}
              {s.applied === false && <div className="text-[10.5px] text-[#8a97a3]">{s.reason === 'exempt' ? 'approved exception: skipped' : 'nothing to correct'}</div>}
            </div>
          </div>
        )
      })}
      {shown < steps.length && <CornerDownRight size={18} className="ml-3 self-center text-[#c2cad2]" />}
    </div>
  )
}
