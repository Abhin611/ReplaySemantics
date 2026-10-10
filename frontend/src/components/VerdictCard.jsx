import { useState } from 'react'
import { ShieldCheck, ShieldAlert, ShieldX, Info, ChevronDown, ChevronRight } from 'lucide-react'
import Card from './Card'
import StatusBadge from './StatusBadge'
import { VERDICTS, REASONS, badgeStatus, subsetRows } from '../lib/verdict'
import { formatAmount } from '../lib/format'

const ICON = { PASS: ShieldCheck, POLICY_ORDERED: ShieldAlert, BLOCKED: ShieldX }

// The stage 5 verdict, straight from the confluence checker -- no placeholder values.
// For real VBFA events the pipeline stops at stage 2b; this card then says so instead of
// showing any verdict (a "PASS" with nothing to attribute would be a false result).
export default function VerdictCard({ result }) {
  const [showTable, setShowTable] = useState(false)
  const v = result?.stage_5_verdict
  if (!v) return null

  if (v.status !== 'complete') {
    return (
      <Card>
        <div className="mb-1 flex items-center gap-1.5 text-[13px] font-bold text-[#101828]">
          <Info size={14} /> Verdict
        </div>
        <span className="mb-2 inline-block rounded-md bg-status-idleBg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-status-idle">
          not applicable
        </span>
        <p className="text-[12px] leading-relaxed text-[#5c6b7a]">
          <span className="font-semibold">Not applicable to this case.</span> {v.message}
        </p>
      </Card>
    )
  }

  const meta = VERDICTS[v.classification]
  const Icon = ICON[v.classification] ?? ShieldCheck
  const s3 = result.stage_3_confluence_checks
  const s4 = result.stage_4_policy_resolution
  const pairs = s4.pair_details ?? []
  const unresolved = pairs.filter((p) => p.status === 'blocked')
  const rows = subsetRows(result)
  const rep = v.replay_of_all_corrections

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#101828]">
          <Icon size={15} style={{ color: meta?.color }} /> Verdict
        </div>
        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          synthetic benchmark case
        </span>
      </div>

      <StatusBadge status={badgeStatus(v.classification)} className="!text-[13px]" />
      <p className="mt-2 text-[12px] leading-relaxed text-[#5c6b7a]">{meta?.meaning}</p>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[
          ['PASS', v.counts.PASS, '#1a7f4c'],
          ['POLICY-ORDERED', v.counts.POLICY_ORDERED, '#92650a'],
          ['BLOCKED', v.counts.BLOCKED, '#b3261e'],
        ].map(([label, n, color]) => (
          <div key={label} className="rounded-lg border border-[#e2e6ea] px-1 py-2">
            <div className="text-[17px] font-bold" style={{ color: n ? color : '#c2cad2' }}>
              {n}
            </div>
            <div className="text-[9.5px] font-semibold uppercase tracking-wide text-[#8a97a3]">{label}</div>
          </div>
        ))}
      </div>
      <div className="mt-1 text-center text-[10.5px] text-[#8a97a3]">
        subsets of the {s3.players.length} correctable events ({s3.num_subsets} in total)
      </div>

      <div className="mt-3 flex flex-col gap-1 text-[12px]">
        <Row label="Realized loss" value={formatAmount(v.realized_loss)} />
        <Row label="Policy" value={result.policy_version} />
        <Row
          label="Attribution"
          value={v.attribution_allowed ? 'allowed' : 'withheld'}
          valueClass={v.attribution_allowed ? 'text-status-pass' : 'text-status-blocked'}
        />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-[#8a97a3]">{v.shapley_status}</p>

      <div className="mt-3 rounded-lg bg-[#f4f6f8] px-3 py-2 text-[11.5px] leading-relaxed text-[#5c6b7a]">
        <span className="font-semibold text-[#101828]">Structure is not the verdict.</span>{' '}
        <span className="font-semibold">{s3.distinct_pairs_unlocked}</span> pair
        {s3.distinct_pairs_unlocked === 1 ? '' : 's'} of correctable events had no fixed order in the log; the
        checker found that <span className="font-semibold">{s3.order_sensitive_pairs.length}</span> of them
        really {s3.order_sensitive_pairs.length === 1 ? 'changes' : 'change'} the total when swapped
        {s3.distinct_pairs_locked > 0 &&
          ` (${s3.distinct_pairs_locked} other pair${s3.distinct_pairs_locked === 1 ? '' : 's'} skipped: order fixed by the log)`}.
      </div>

      {unresolved.length > 0 && (
        <div className="mt-3 rounded-lg border border-status-blocked/30 bg-status-blockedBg px-3 py-2 text-[11.5px] leading-relaxed text-status-blocked">
          <div className="font-semibold">Why this is blocked</div>
          {REASONS[unresolved[0].reason_code] ?? 'The policy does not resolve the order.'} Unresolved:{' '}
          {unresolved.map((p) => `${p.a} ⇄ ${p.b}`).join(', ')}.
        </div>
      )}

      {rep?.order_is_authoritative === false && (
        <p className="mt-2 text-[11px] leading-snug text-[#8a97a3]">
          The step-through below uses an illustrative order only. It is not an authoritative outcome.
        </p>
      )}

      <button
        onClick={() => setShowTable((x) => !x)}
        className="mt-3 flex items-center gap-1 text-[12px] font-semibold text-[#2a9d8f] hover:underline"
      >
        {showTable ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Coalition values v(S) — {rows.length} subsets
      </button>
      {showTable && (
        <div className="mt-2 max-h-[300px] overflow-auto rounded-lg border border-[#e2e6ea]">
          <table className="w-full text-left text-[11.5px]">
            <thead className="sticky top-0 bg-[#f7f9fa] text-[10px] uppercase tracking-wide text-[#8a97a3]">
              <tr>
                <th className="px-2 py-1.5 font-semibold">Subset S</th>
                <th className="px-2 py-1.5 font-semibold">Verdict</th>
                <th className="px-2 py-1.5 text-right font-semibold">v(S)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key || '∅'} className="border-t border-[#eef1f4]">
                  <td className="px-2 py-1 font-mono">{r.key === '' ? '∅' : r.key}</td>
                  <td className="px-2 py-1">
                    <StatusBadge status={badgeStatus(r.verdict)} className="!px-1.5 !py-0.5 !text-[10px]" />
                  </td>
                  <td className="px-2 py-1 text-right font-mono">
                    {r.value === null ? <span className="text-status-blocked">withheld</span> : formatAmount(r.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function Row({ label, value, valueClass = 'text-[#101828]' }) {
  return (
    <div className="flex items-center justify-between border-b border-[#eef1f4] py-1 last:border-0">
      <span className="text-[#8a97a3]">{label}</span>
      <span className={`font-semibold ${valueClass}`}>{value}</span>
    </div>
  )
}
