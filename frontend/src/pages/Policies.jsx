import { useCallback, useEffect, useState } from 'react'
import { ArrowLeftRight, ShieldCheck } from 'lucide-react'
import { useApi } from '../lib/useApi'
import { getPolicies } from '../lib/api'
import Card from '../components/Card'
import { LoadingState, ErrorState } from '../components/StatusStates'

// The real, versioned policy files (policy_engine/policies/P-*.json). A policy does two jobs:
//   1. defines the correction rules (what "compliant" means, what each correction restores);
//   2. says which corrections must be applied BEFORE which others (canonical orderings).
// Job 2 is what decides POLICY-ORDERED vs BLOCKED: when two corrections interact and the policy
// has no rule ordering them, the confluence checker cannot pick an order and the case is BLOCKED.

const human = (id) => id.replace(/_correction$/, '').replace(/_/g, ' ')

export default function Policies() {
  const api = useApi(useCallback(() => getPolicies(), []))
  const [selected, setSelected] = useState(null)
  const policies = api.data?.policies ?? []

  useEffect(() => {
    if (!selected && policies.length) {
      setSelected((policies.find((p) => p.policy_version === 'P-2026-Q3-001') ?? policies[0]).policy_version)
    }
  }, [policies, selected])

  if (api.loading) return <LoadingState label="Loading policies…" />
  if (api.error) return <ErrorState error={api.error} onRetry={api.refetch} />

  const policy = policies.find((p) => p.policy_version === selected)
  if (!policy) return null

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex flex-col gap-3 lg:sticky lg:top-2 lg:self-start">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8a97a3]">
          {policies.length} policy versions
        </div>
        {policies.map((p) => (
          <PolicyListItem
            key={p.policy_version}
            policy={p}
            active={p.policy_version === selected}
            onClick={() => setSelected(p.policy_version)}
          />
        ))}
      </div>
      <PolicyDetail policy={policy} />
    </div>
  )
}

function coverageTone(cov) {
  if (cov.ordered_pairs === 0) return { text: 'text-status-blocked', bg: 'bg-status-blockedBg', label: 'no ordering' }
  if (cov.unordered_pairs.length === 0) return { text: 'text-status-pass', bg: 'bg-status-passBg', label: 'fully ordered' }
  return { text: 'text-status-ordered', bg: 'bg-status-orderedBg', label: 'partly ordered' }
}

function PolicyListItem({ policy, active, onClick }) {
  const tone = coverageTone(policy.coverage)
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-4 text-left shadow-card transition-colors ${
        active ? 'border-teal-500 bg-teal-50' : 'border-[#e2e6ea] bg-white hover:border-teal-300'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] font-bold text-[#101828]">{policy.policy_version}</span>
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${tone.bg} ${tone.text}`}>
          {tone.label}
        </span>
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-[#5c6b7a]">{policy.description}</p>
      <div className="mt-2 text-[11px] text-[#8a97a3]">
        {policy.coverage.ordered_pairs} of {policy.coverage.total_pairs} correction pairs ordered
        {policy.used_by_cases !== null && ` · ${policy.used_by_cases} benchmark cases`}
      </div>
    </button>
  )
}

function PolicyDetail({ policy }) {
  const label = Object.fromEntries(policy.corrections.map((c) => [c.correction_id, c.activity]))
  const cov = policy.coverage
  const tone = coverageTone(cov)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[15px] font-bold text-[#101828]">
              <ShieldCheck size={16} className="text-teal-500" />
              {policy.policy_version}
            </div>
            <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-[#5c6b7a]">{policy.description}</p>
          </div>
          <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${tone.bg} ${tone.text}`}>
            {cov.ordered_pairs} / {cov.total_pairs} pairs ordered
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Fact label="Effective from" value={policy.effective_from} />
          <Fact
            label="Discount stacking"
            value={`${policy.stacking.mode} · cap ${Math.round(Number(policy.stacking.max_total_discount) * 100)}%`}
          />
          <Fact label="Rounding" value={`${policy.rounding.decimals} decimals · ${policy.rounding.mode}`} />
          <Fact
            label="Used by"
            value={policy.used_by_cases === null ? '—' : `${policy.used_by_cases} benchmark cases`}
            hint={policy.used_by_cases === null ? 'no benchmark generated' : 'synthetic'}
          />
        </div>
      </Card>

      <Card>
        <div className="mb-1 text-[14px] font-bold text-[#101828]">Canonical correction order</div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-[#8a97a3]">
          Rules saying which correction must be applied before another. The order the log already fixes always
          wins; these rules apply only where the log is silent.
        </p>
        {policy.canonical_orderings.length === 0 ? (
          <div className="rounded-lg border border-status-blocked/30 bg-status-blockedBg px-4 py-3 text-[12.5px] leading-relaxed text-status-blocked">
            <span className="font-semibold">This policy defines no ordering rules.</span> Whenever two corrections
            interact and the log does not fix their order, nothing decides which comes first, so the confluence
            checker marks the case BLOCKED and withholds attribution.
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {policy.canonical_orderings.map((r, i) => (
              <li key={r.rule_id} className="flex gap-4">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#c2cad2] text-[12px] font-bold text-[#5c6b7a]">
                  {i + 1}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-bold text-[#101828]">
                    <span className="rounded bg-[#eef1f4] px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-[#5c6b7a]">
                      {r.rule_id}
                    </span>
                    {r.before ? (
                      <>
                        {label[r.before] ?? human(r.before)}
                        <span className="font-normal text-[#8a97a3]">before</span>
                        {label[r.after] ?? human(r.after)}
                      </>
                    ) : (
                      <>
                        Within {label[r.within] ?? human(r.within)}
                        <span className="font-normal text-[#8a97a3]">·</span>
                        {String(r.by).replace(/_/g, ' ')}
                      </>
                    )}
                  </div>
                  <div className="mt-1 text-[12.5px] leading-relaxed text-[#5c6b7a]">{r.rationale}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <div className="mb-1 flex items-center gap-1.5 text-[14px] font-bold text-[#101828]">
          <ArrowLeftRight size={14} /> Pairs this policy does not order ({cov.unordered_pairs.length} of{' '}
          {cov.total_pairs})
        </div>
        {cov.unordered_pairs.length === 0 ? (
          <p className="text-[12.5px] text-status-pass">Every pair of corrections has a defined order.</p>
        ) : (
          <>
            <p className="mb-3 text-[12.5px] leading-relaxed text-[#8a97a3]">
              If two corrections in this list interact (their order changes the total) and the log does not fix their
              order, the case cannot be resolved and is BLOCKED. Pairs whose order does not change the total are
              unaffected.
            </p>
            <div className="flex max-h-[220px] flex-wrap gap-1.5 overflow-y-auto">
              {cov.unordered_pairs.map(([a, b]) => (
                <span
                  key={`${a}-${b}`}
                  className="rounded-md border border-[#e2e6ea] bg-[#f7f9fa] px-2 py-1 font-mono text-[11px] text-[#5c6b7a]"
                >
                  {human(a)} ⇄ {human(b)}
                </span>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-[#e2e6ea] px-5 py-3 text-[14px] font-bold text-[#101828]">
          Corrections ({policy.corrections.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-[#e2e6ea] text-[11px] uppercase tracking-wide text-[#8a97a3]">
                <th className="px-5 py-2.5 font-semibold">Correction</th>
                <th className="px-5 py-2.5 font-semibold">Fixes events of type</th>
                <th className="px-5 py-2.5 font-semibold">Cost</th>
                <th className="px-5 py-2.5 font-semibold">What it restores</th>
              </tr>
            </thead>
            <tbody>
              {policy.corrections.map((c) => (
                <tr key={c.correction_id} className="border-b border-[#eef1f4] last:border-0">
                  <td className="px-5 py-2.5 font-mono text-[11.5px] font-semibold text-[#101828]">{c.correction_id}</td>
                  <td className="px-5 py-2.5 text-[#5c6b7a]">{c.activity}</td>
                  <td className="px-5 py-2.5 text-[#5c6b7a]">{c.remediation_cost}</td>
                  <td className="px-5 py-2.5 text-[#5c6b7a]">{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function Fact({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-[#e2e6ea] px-3 py-2">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#8a97a3]">{label}</div>
      <div className="mt-0.5 text-[12.5px] font-semibold text-[#101828]">{value}</div>
      {hint && <div className="text-[10.5px] text-[#8a97a3]">{hint}</div>}
    </div>
  )
}
