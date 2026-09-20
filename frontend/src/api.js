// API client. In dev, requests go to /api and Vite proxies them to the backend.
// In a deployed build, set VITE_API_BASE to the API Gateway invoke URL.
const BASE = import.meta.env.VITE_API_BASE || '/api'

const TIMEOUT_MS = 45000

class ApiError extends Error {
  constructor(message, { code, detail, status } = {}) {
    super(message)
    this.code = code
    this.detail = detail
    this.status = status
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      throw new ApiError('The request timed out.', {
        code: 'timeout',
        detail: 'The backend did not respond in time. It may be waiting on Bedrock.',
      })
    }
    throw new ApiError('Could not reach the backend.', {
      code: 'network',
      detail: 'Is the API running? Start it with: python3 local_server.py',
    })
  }
  clearTimeout(timer)

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new ApiError('The backend returned a malformed response.', {
      status: response.status,
    })
  }

  if (!response.ok) {
    const e = payload?.error || {}
    throw new ApiError(e.message || `Request failed (${response.status})`, {
      code: e.code,
      detail: e.detail,
      status: response.status,
    })
  }
  return payload
}

export const getHealth = () => request('/health')

export const getEvents = (minutes = 30, mode) =>
  request(`/events?minutes=${minutes}${mode ? `&mode=${mode}` : ''}`)

export const investigate = ({ incidentTime, lookbackMinutes, description, mode }) =>
  request('/investigate', {
    method: 'POST',
    body: {
      incident_time: incidentTime,
      lookback_minutes: lookbackMinutes,
      description: description || undefined,
      mode,
    },
  })

export const explain = ({ incidentTime, lookbackMinutes, description, mode, eventIds }) =>
  request('/explain', {
    method: 'POST',
    body: {
      incident_time: incidentTime,
      lookback_minutes: lookbackMinutes,
      description: description || undefined,
      mode,
      event_ids: eventIds,
    },
  })

export { ApiError }
