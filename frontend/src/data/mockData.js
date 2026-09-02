// src/data/mockData.js
//
// PREVIEW DATA ONLY.
//
// Everything in this file is illustrative filler for screens whose real
// pipeline stage doesn't exist yet:
//   - Confluence Checks / verdicts        -> Month 4 (Member 1)
//   - Policy Resolution / correction fns  -> Member 2, in progress
//   - Shapley attribution                 -> Month 5 (Member 3)
//   - Audit log, auth/roles               -> not started
//
// None of it is read from the real OCEL log. It exists so the frontend
// can be built end-to-end now, ahead of the backend, per the Figma
// prototype -- swap each piece out for a real endpoint as it lands.
// Every place this data is used is tagged with a <PreviewTag /> in the UI.

export const STATUS_OPTIONS = ['PASS', 'POLICY-ORDERED', 'BLOCKED']

// Deterministic pseudo-verdict so the same case always renders the same
// badge across reloads (purely cosmetic -- NOT a real classification).
export function previewStatusFor(caseId) {
  let hash = 0
  for (let i = 0; i < caseId.length; i++) {
    hash = (hash * 31 + caseId.charCodeAt(i)) >>> 0
  }
  return STATUS_OPTIONS[hash % STATUS_OPTIONS.length]
}

export function previewPolicyVersionFor(caseId) {
  const versions = ['P-2024-Q4-003', 'P-2024-Q4-002', 'P-2024-Q3-011']
  let hash = 0
  for (let i = 0; i < caseId.length; i++) hash = (hash * 17 + caseId.charCodeAt(i)) >>> 0
  return versions[hash % versions.length]
}

export const mockPolicy = {
  id: 'P-2024-Q4-003',
  name: 'Canonical Correction Order',
  active: true,
  steps: [
    {
      order: 1,
      title: 'Discount Correction',
      description:
        'Unauthorized or missing discount adjustments are applied first, before any tax recomputation, to establish the correct pre-tax base amount.',
    },
    {
      order: 2,
      title: 'Tax Recalculation',
      description:
        'Applicable tax is recomputed after discount resolution; confluent tax writes across GR and IR lines are merged using the GR line as authoritative.',
    },
    {
      order: 3,
      title: 'Currency Conversion',
      description:
        'Functional-currency conversion is applied after tax recalculation using the ECB reference rate at the document date.',
    },
    {
      order: 4,
      title: 'Rounding Adjustment',
      description:
        'Cent-precision rounding is applied last; rounding events are terminal and any subsequent write to the same account triggers a new replay.',
    },
  ],
}

export const mockAuditLog = [
  {
    timestamp: '2024-11-14 09:22:44',
    actor: 'kavya.mehra@org.com',
    role: 'Auditor',
    action: 'REPLAY_RUN',
  },
  {
    timestamp: '2024-11-14 09:21:10',
    actor: 'kavya.mehra@org.com',
    role: 'Auditor',
    action: 'CASE_OPEN',
  },
  {
    timestamp: '2024-11-13 16:08:31',
    actor: 'r.sharma@org.com',
    role: 'Auditor',
    action: 'REPLAY_RUN',
  },
  {
    timestamp: '2024-11-13 15:56:03',
    actor: 'r.sharma@org.com',
    role: 'Auditor',
    action: 'CASE_OPEN',
  },
  {
    timestamp: '2024-11-13 11:40:52',
    actor: 'admin@org.com',
    role: 'Admin',
    action: 'POLICY_PUBLISH',
  },
]

export const mockUser = {
  name: 'Kavya Mehra',
  email: 'kavya.mehra@acme-corp.io',
  role: 'Auditor',
  lastLogin: '2024-11-14 09:21',
  initials: 'KM',
}

export const mockPermissions = [
  { permission: 'View Cases', analyst: true, auditor: true, admin: true },
  { permission: 'Run Replay', analyst: true, auditor: true, admin: true },
  { permission: 'View Attribution', analyst: true, auditor: true, admin: true },
  { permission: 'Publish Policies', analyst: false, auditor: false, admin: true },
  { permission: 'Export Audit Log', analyst: false, auditor: true, admin: true },
  { permission: 'Manage Users', analyst: false, auditor: false, admin: true },
  { permission: 'Override BLOCKED', analyst: false, auditor: true, admin: true },
]

// Mock Shapley attribution -- shape mirrors what Member 3's eventual
// endpoint will need to return (event_id, activity, phi share, loss).
export function mockAttributionFor(caseValueEur = 284730) {
  const rows = [
    { event: 'E4', activity: 'Discount Correction', phi: 0.38, inCoalition: false },
    { event: 'E5', activity: 'Tax Recalculation', phi: 0.27, inCoalition: true },
    { event: 'E6', activity: 'Currency Conversion', phi: 0.18, inCoalition: true },
    { event: 'E3', activity: 'IR-Receipt', phi: 0.09, inCoalition: true },
    { event: 'E2', activity: 'GR-Posting', phi: 0.05, inCoalition: true },
    { event: 'E1', activity: 'PO-Approval', phi: 0.02, inCoalition: true },
    { event: 'E7', activity: 'Rounding Adjustment', phi: 0.01, inCoalition: true },
  ]
  return rows.map((r) => ({ ...r, loss: Math.round(r.phi * caseValueEur) }))
}
