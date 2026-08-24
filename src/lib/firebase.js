import { initializeApp } from 'firebase/app'
import { getAuth, signInWithCustomToken, signOut, onAuthStateChanged } from 'firebase/auth'

/* Study Orbital의 Firebase는 로그인(Auth)만 쓴다.
 *
 * 데이터는 전부 서버 API를 거친다 — 클라이언트가 Firestore를 직접 읽고 쓰는
 * 길이 없어서 firestore.rules는 전부 잠가둔다. 여기 값들은 VITE_ 접두사라
 * 번들에 노출되는데, 그건 정상이다(웹 설정값은 비밀이 아니다).
 */
const trim = (v) => v?.trim() || v

const cfg = {
  apiKey: trim(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: trim(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: trim(import.meta.env.VITE_FIREBASE_PROJECT_ID),
  appId: trim(import.meta.env.VITE_FIREBASE_APP_ID),
}

export const hasFirebase = Boolean(cfg.apiKey && cfg.projectId)

let app, auth
if (hasFirebase) {
  app = initializeApp(cfg)
  auth = getAuth(app)
}
export { auth }

/* 자체 로그인. 서버(/api/login, /api/signup)가 이름+비밀번호를 확인해서
 * Firebase 커스텀 토큰을 돌려주면, 그걸로 로그인을 마무리한다. */
async function authWith(path, name, pin, fallbackError) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, pin }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || fallbackError)
  return signInWithCustomToken(auth, data.token)
}

export const loginWithPin = (name, pin) => authWith('/api/login', name, pin, '로그인에 실패했습니다.')
export const signUpWithPin = (name, pin) =>
  authWith('/api/signup', name, pin, '계정을 만들지 못했습니다.')

export function watchAuth(cb) {
  if (!hasFirebase) return () => {}
  return onAuthStateChanged(auth, cb)
}

/* 로그아웃이 가끔 안 끝난다(Sevenly에서 겪은 것 — IndexedDB 쓰기가 영영
 * 안 끝나는 경우). 몇 초만 기다리고, 안 되면 저장된 로그인 흔적을 지우고 새로 연다. */
export async function logout() {
  try {
    if (!auth) throw new Error('로그인 정보가 없습니다.')
    await Promise.race([
      signOut(auth),
      new Promise((_, reject) => setTimeout(() => reject(new Error('시간 초과')), 4000)),
    ])
  } catch {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('firebase:authUser:')) localStorage.removeItem(k)
      }
    } catch {
      /* 저장소가 막힌 브라우저면 지울 것도 없다 */
    }
    location.reload()
  }
}
