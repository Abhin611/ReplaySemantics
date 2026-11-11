import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Scale } from 'lucide-react'
import AnimatedNumber from './AnimatedNumber'

const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// A real result from the benchmark (case RSC-2026-00040): the same two posted documents in the two possible orders.
// Posted: discount e3 = 1,267.22, tax e4 = 1,025.30, net 906,570.00. Tax first: the discount is taken on the amount
// that already holds the tax (1,380.01) and the net falls to 897,504.30. Policy rule CO-03 orders discount before tax.
const POSTED = { discount: 1267.22, net: 906570.0 }
const SWAPPED = { discount: 1380.01, net: 897504.3 }

function Segmented({ swapped, onChange }) {
  const refs = useRef([])
  const [pill, setPill] = useState(null)
  useLayoutEffect(() => {
    const el = refs.current[swapped ? 1 : 0]
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth })
  }, [swapped])
  return (
    <div role="tablist" aria-label="Order of the two events" className="relative flex rounded-full border border-white/10 bg-white/[0.06] p-1 text-[12px] font-semibold">
      <span aria-hidden="true" className="absolute bottom-1 top-1 rounded-full bg-white shadow-[0_4px_12px_-4px_rgba(0,0,0,0.5)] transition-[left,width] duration-500 ease-spring"
        style={pill ? { left: pill.left, width: pill.width } : { opacity: 0 }} />
      {['As posted', 'Tax first'].map((label, i) => {
        const on = swapped === (i === 1)
        return (
          <button key={label} ref={(el) => { refs.current[i] = el }} role="tab" aria-selected={on} onClick={() => onChange(i === 1)}
            className={`relative z-10 rounded-full px-3.5 py-1.5 transition-colors duration-300 ${on ? 'text-navy-950' : 'text-[#b4c3d0] hover:text-white'}`}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

function EventChip({ id, name, rate, shift, moved }) {
  return (
    <div className="transition-transform duration-700 ease-spring" style={{ transform: `translateX(${shift})` }}>
      <div className={`flex items-center gap-2.5 rounded-2xl border px-3 py-3 transition-[border-color,background-color,box-shadow] duration-500 sm:gap-3 sm:px-3.5 ${
        moved ? 'border-amber-300/50 bg-amber-300/[0.08] shadow-[0_0_0_4px_rgba(252,211,77,0.06)]' : 'border-white/10 bg-white/[0.05]'}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-teal-400/70 bg-teal-400/10 text-[12.5px] font-bold text-teal-200 sm:h-10 sm:w-10">{id}</span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-bold text-white">{name}</span>
          <span className="block whitespace-nowrap text-[11.5px] text-[#8fa3b5]">rate {rate}</span>
        </span>
      </div>
    </div>
  )
}

// The landing page's centrepiece: flip the order of two events and watch one recorded value, and the total, move.
export default function SwapDemo({ swapped, onChange }) {
  const [ms, setMs] = useState(0) // no count-up on first paint
  useEffect(() => { setMs(900) }, [])
  const now = swapped ? SWAPPED : POSTED

  return (
    <div className="rs-glass-dark relative rounded-[28px] p-5 sm:p-6" data-testid="swap-demo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11.5px] text-[#8fa3b5]">Case RSC-2026-00040 · same events, same inputs</span>
        <Segmented swapped={swapped} onChange={onChange} />
      </div>

      {/* The two events trade places. Each column is one slot; a chip slides one slot over. */}
      <div className="relative mt-5 grid grid-cols-2 gap-9">
        <EventChip id="e3" name="Discount" rate="0.11" shift={swapped ? 'calc(100% + 2.25rem)' : '0px'} moved={swapped} />
        <EventChip id="e4" name="Tax" rate="0.10" shift={swapped ? 'calc(-100% - 2.25rem)' : '0px'} moved={false} />
        <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-navy-900 text-[#8fa3b5] ring-1 ring-white/10">
          <ArrowRight size={14} />
        </span>
      </div>

      <dl className="mt-5 divide-y divide-white/[0.07] rounded-2xl border border-white/[0.07] bg-navy-950/50 text-[13px]">
        <div className={`flex items-baseline justify-between gap-3 px-4 py-3 transition-colors duration-700 ${swapped ? 'bg-amber-300/[0.07]' : ''}`}>
          <dt className="text-[#b4c3d0]">
            Discount e3
            <span className="mt-0.5 block text-[11.5px] text-[#8fa3b5]">{swapped ? '0.11 × (11,520.21 + 1,025.30 tax)' : '0.11 × 11,520.21'}</span>
          </dt>
          <dd className={`font-bold transition-colors duration-500 ${swapped ? 'text-amber-200' : 'text-white'}`}><AnimatedNumber value={now.discount} format={money} ms={ms} /></dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 px-4 py-3">
          <dt className="text-[#b4c3d0]">
            Tax e4
            <span className="mt-0.5 block text-[11.5px] text-[#8fa3b5]">{swapped ? 'ran first, so it keeps its recorded value' : '0.10 × the amount after discount'}</span>
          </dt>
          <dd className="font-bold text-white">1,025.30</dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <div className="text-[11.5px] text-[#8fa3b5]">Net total of the invoice</div>
          <div className="mt-1 text-[34px] font-extrabold leading-none tracking-[-0.035em] text-white sm:text-[40px]" aria-live="polite">
            <AnimatedNumber value={now.net} format={money} ms={ms} />
          </div>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-[12px] font-bold transition-all duration-500 ease-out ${
          swapped ? 'bg-rose-400/15 text-rose-200' : 'bg-teal-400/15 text-teal-200'}`}>
          {swapped ? '9,065.70 lower' : 'matches the books'}
        </span>
      </div>

      <p className="mt-5 flex items-start gap-2.5 border-t border-white/[0.07] pt-4 text-[12.5px] leading-relaxed text-[#b4c3d0]">
        <Scale size={15} className="mt-0.5 shrink-0 text-amber-300" />
        <span>Two totals, one invoice. Policy rule CO-03 puts discount before tax, so this case is <b className="font-bold text-amber-200">POLICY-ORDERED</b>. Without that rule it would be BLOCKED.</span>
      </p>
    </div>
  )
}
