// The case total written out as the sum it is: one row per step, with its own numbers.
//   gross - discounts + tax  ->  x fx rate  ->  + adjustments  ->  + rounding  =  net
// `rows` come from the backend (replay_core/explain.py) so the arithmetic on screen is the engine's own.
// With `prevRows`, any row whose value moved since the previous stage is highlighted and shows "was ...".
export default function CalcTable({ rows, prevRows, animate = false, dense = false }) {
  if (!rows?.length) return null
  const prev = Object.fromEntries((prevRows ?? []).map((r) => [r.key, r]))
  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-[#e2e6ea] bg-white/80">
      {rows.map((r, idx) => {
        const before = prev[r.key]
        const changed = before && Number(before.value) !== Number(r.value)
        const total = r.key === 'net'
        return (
          <div
            key={r.key}
            style={animate ? { animationDelay: `${0.45 + idx * 0.09}s` } : undefined}
            className={`${animate ? (changed ? 'rs-row-in rs-flash' : 'rs-row-in') : ''} grid grid-cols-[1rem_1fr_auto] items-baseline gap-x-2 border-b border-[#eef1f4] px-2 ${dense ? 'py-0.5' : 'py-1'} last:border-b-0 ${
              changed ? 'bg-amber-50' : total ? 'bg-[#f4f6f8]' : ''
            }`}
          >
            <span className="text-center font-mono text-[12px] font-bold text-[#8a97a3]">{r.op}</span>
            {dense ? (
              <>
                {/* one line per step: label, then the arithmetic in grey (full text on hover) */}
                <div className="min-w-0 truncate" title={r.expr ? `${r.label}: ${r.expr}` : r.label}>
                  <span className={`text-[11.5px] ${total ? 'font-bold text-[#101828]' : 'font-semibold text-[#344054]'}`}>{r.label}</span>
                  {r.expr && <span className="ml-2 font-mono text-[10px] text-[#a0abb6]">{r.expr}</span>}
                </div>
                <div className="whitespace-nowrap text-right">
                  {changed && <span className="mr-1.5 font-mono text-[10px] text-[#8a97a3] line-through">{before.text}</span>}
                  <span className={`font-mono text-[12px] ${total ? 'font-bold' : 'font-semibold'} ${changed ? 'text-amber-900' : 'text-[#101828]'}`}>{r.text}</span>
                </div>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <div className={`text-[11.5px] ${total ? 'font-bold text-[#101828]' : 'font-semibold text-[#344054]'}`}>{r.label}</div>
                  {r.expr && <div className="break-words font-mono text-[10.5px] leading-snug text-[#8a97a3]">{r.expr}</div>}
                </div>
                <div className="text-right">
                  <div className={`font-mono text-[12px] ${total ? 'font-bold' : 'font-semibold'} ${changed ? 'text-amber-900' : 'text-[#101828]'}`}>
                    {r.text}
                  </div>
                  {changed && <div className="font-mono text-[10px] text-[#8a97a3]">was {before.text}</div>}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
