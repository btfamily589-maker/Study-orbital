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
/** 프사 바꾸기(data URL) 또는 지우기(null). */
export const setMyPhoto = (photo) => call('/api/me/photo', { method: 'POST', body: { photo } })
/** 방 참가자들의 프사 — { uid: dataUrl }. 함선 옆에 띄운다. */
export const fetchRoomPhotos = () => call('/api/room/photos')
/** 이 기기의 푸시 토큰을 내 uid로 등록한다 — 미사일 알림이 이걸 보고 온다. */
export const registerPushToken = (token) =>
  call('/api/push/register', { method: 'POST', body: { token } })
