// src/lib/api.js
//
// Thin client for the REAL backend (src/api/app.py). Every function here
// maps 1:1 to an endpoint that actually runs your Month 1-2 pipeline
// against the live VBFA-derived OCEL 2.0 log -- nothing in this file is
// mocked. See src/data/mockData.js for the Month 3-5 screens that don't
// have a backend yet.

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function request(path) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}`)
  } catch (err) {
    throw new ApiError(
      `Could not reach the backend at ${API_BASE}. Is "uvicorn api.app:app --reload" running?`,
      0
    )
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail || detail
    } catch {
      /* ignore parse failure */
    }
    throw new ApiError(detail, res.status)
  }
  return res.json()
}

// GET /api/health
export function getHealth() {
  return request('/api/health')
}

// GET /api/dashboard
export function getDashboard() {
  return request('/api/dashboard')
}

// GET /api/cases
export function getCases() {
  return request('/api/cases')
}

// GET /api/cases/{case_id}/replay?max_events=&min_events=&max_hops=
export function runReplay(caseId, { maxEvents = 8, minEvents = 3, maxHops = 3 } = {}) {
  const params = new URLSearchParams({
    max_events: maxEvents,
    min_events: minEvents,
    max_hops: maxHops,
  })
  return request(`/api/cases/${encodeURIComponent(caseId)}/replay?${params}`)
}

export { ApiError, API_BASE }
