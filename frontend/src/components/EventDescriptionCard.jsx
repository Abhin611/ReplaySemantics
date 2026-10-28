import Card from './Card'

// "Event description" tab: for every event in the graph (e1, e2, ...) what it stands for, every value stored
// in it, and how its own total is worked out. Comes from `event_descriptions` in the replay payload, which the
// backend builds from the observed (as-posted) state with the engine's own arithmetic.
export default function EventDescriptionCard({ events, selected, onSelect }) {
  if (!events?.length) {
    return (
      <Card>
        <div className="mb-1 text-[13px] font-bold text-[#101828]">Event description</div>
        <p className="text-[12px] text-[#8a97a3]">Run a benchmark case to see what each event stands for.</p>
      </Card>
    )
  }
  return (
    <>
      <p className="px-1 text-[11.5px] leading-relaxed text-[#8a97a3]">
        What each event in the graph stands for, the values stored in it, and how its own total is worked out (values as posted,
        before any correction).
      </p>
      {events.map((e) => {
        const inputs = e.lines.filter((l) => l.kind === 'input')
        const steps = e.lines.filter((l) => l.kind === 'step')
        const on = selected === e.node_id
        return (
          <Card key={e.node_id} className={`!p-3.5 ${on ? 'ring-2 ring-amber-400' : ''}`}>
            <button type="button" onClick={() => onSelect?.(on ? null : e.node_id)} className="block w-full text-left" title="Highlight on graph">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-[#e2e6ea] bg-[#f4f6f8] px-1.5 py-0.5 font-mono text-[12px] font-bold text-[#101828]">
                  {e.node_id}
                </span>
                <span className="text-[13px] font-bold text-[#101828]">{e.title}</span>
                {e.activity && <span className="font-mono text-[10.5px] text-[#8a97a3]">{e.activity}</span>}
                {e.exempt && (
                  <span className="rounded-full bg-[#eef1f4] px-1.5 text-[10px] font-semibold text-[#5c6b7a]">approved exception</span>
                )}
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-[#5c6b7a]">{e.meaning}</p>
            </button>

            {inputs.length > 0 && (
              <Section title="Values stored in this event">
                {inputs.map((l, i) => <Row key={i} line={l} />)}
              </Section>
            )}
            {steps.length > 0 && (
              <Section title={e.node_type === 'net' ? 'What it adds up' : 'How the total is worked out'}>
                {steps.map((l, i) => <Row key={i} line={l} />)}
              </Section>
            )}
            {e.total && (
              <div className="mt-2 flex items-baseline justify-between gap-2 rounded-md bg-[#f4f6f8] px-2 py-1.5">
                <span className="text-[11.5px] font-bold text-[#101828]">{e.total.label}</span>
                <span className="font-mono text-[13px] font-bold text-[#101828]">{e.total.text}</span>
              </div>
            )}
            {e.note && <p className="mt-1.5 text-[11px] leading-relaxed text-status-ordered">{e.note}</p>}
          </Card>
        )
      })}
    </>
  )
}

function Section({ title, children }) {
  return (
    <div className="mt-2">
      <div className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#8a97a3]">{title}</div>
      <div className="rounded-md border border-[#e2e6ea]">{children}</div>
    </div>
  )
}

function Row({ line }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[#eef1f4] px-2 py-1 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[11.5px] font-semibold text-[#344054]">{line.label}</div>
        {line.expr && <div className="break-words font-mono text-[10.5px] leading-snug text-[#8a97a3]">{line.expr}</div>}
      </div>
      <div className="shrink-0 text-right font-mono text-[12px] font-semibold text-[#101828]">{line.text}</div>
    </div>
  )
}
