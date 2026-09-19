import { Link2 } from 'lucide-react'
import Card from './Card'

// Renders each real structural constraint (stage_2b_constraint_extraction
// .given_constraints) as a plain-English sentence -- "X cannot happen
// before Y" -- and lets the user click one to highlight the two events it
// involves on the candidate graph (see EventNode's `highlighted` prop and
// the `selectedConstraint` state lifted up in ReplayConsole/ReplayGraph).
//
// Two constraint "reasons" read slightly differently:
//   - target_precedence: the candidate must precede the target because
//     the target is this analysis's fixed endpoint (see
//     constraint_extraction.py) -- phrased around "the target event"
//     rather than a shared object, and omits the "via object" line when
//     there isn't a direct one (shared_object is null for candidates
//     several hops upstream).
//   - structural_precedence: two non-target candidates ordered by a
//     directly shared object.
export default function ConstraintExplanationList({
  constraints = [],
  eventLookup = {},
  selected,
  onSelect,
}) {
  if (constraints.length === 0) {
    return (
      <Card>
        <div className="mb-1 text-[13px] font-bold text-[#101828]">Constraint Explanations</div>
        <p className="text-[11.5px] text-[#8a97a3]">
          No structural constraints in this candidate set yet -- run a replay first.
        </p>
      </Card>
    )
  }

  const label = (id) => (eventLookup[id] ? `${eventLookup[id]} (${id})` : id)

  return (
    <Card>
      <div className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-[#101828]">
        <Link2 size={13} />
        Constraint Explanations
      </div>
      <p className="mb-3 text-[11.5px] leading-relaxed text-[#8a97a3]">
        Click any line to highlight the two events involved on the graph.
      </p>
      <ul className="flex max-h-[420px] flex-col gap-1.5 overflow-y-auto pr-1">
        {constraints.map((c, i) => {
          const isSelected =
            selected && selected.before === c.before && selected.after === c.after
          return (
            <li key={`${c.before}-${c.after}-${i}`}>
              <button
                onClick={() => onSelect?.(isSelected ? null : c)}
                className={`w-full rounded-lg border px-2.5 py-2 text-left text-[12px] leading-snug transition-colors ${
                  isSelected
                    ? 'border-amber-400 bg-amber-50 text-amber-900'
                    : 'border-[#e2e6ea] bg-white text-[#101828] hover:border-teal-300 hover:bg-teal-50'
                }`}
              >
                <span className="font-semibold">{label(c.after)}</span> cannot happen before{' '}
                <span className="font-semibold">{label(c.before)}</span>
                {c.shared_object ? (
                  <div className="mt-0.5 text-[10.5px] text-[#8a97a3]">
                    via shared object {c.shared_object}
                  </div>
                ) : c.reason === 'target_precedence' ? (
                  <div className="mt-0.5 text-[10.5px] text-[#8a97a3]">
                    {label(c.after)} is this case&apos;s target event
                  </div>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
