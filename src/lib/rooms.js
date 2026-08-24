/* 방 API 클라이언트. orbit API와 같은 방식 — 매 요청에 Firebase ID 토큰. */
import { auth, hasFirebase } from './firebase'

async function call(path, { method = 'GET', body } = {}) {
  if (!hasFirebase || !auth?.currentUser) throw new Error('로그인이 필요합니다.')
  const token = await auth.currentUser.getIdToken()
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `요청 실패 (${res.status})`)
    err.needRoom = !!data.needRoom
    throw err
  }
  return data
}

export const fetchMe = () => call('/api/me')
export const createRoom = (name) => call('/api/room/create', { method: 'POST', body: { name } })
export const joinRoom = (code) => call('/api/room/join', { method: 'POST', body: { code } })
export const leaveRoom = () => call('/api/room/leave', { method: 'POST' })
