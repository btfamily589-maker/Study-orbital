/* 웹 푸시 — 미사일 발사·착탄 알림이 오는 길. Sevenly의 push.js를 옮겨온 것.
 *
 * 토큰은 Firestore에 직접 못 쓴다(규칙이 전부 잠김) — 서버 API로 등록한다.
 * - 안드로이드 크롬: 그냥 된다.
 * - iOS 사파리: 홈 화면에 추가(PWA)한 뒤에만 된다. 그냥 사파리 탭에서는 권한
 *   창 자체가 안 뜬다.
 */
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging'
import { app, hasFirebase, firebaseConfig } from './firebase'
import { registerPushToken } from './rooms'

const VAPID = import.meta.env.VITE_FIREBASE_VAPID_KEY

function missingConfig() {
  if (!hasFirebase) return 'Firebase 설정(VITE_FIREBASE_*)이 없습니다.'
  if (!VAPID) {
    return (
      '웹 푸시 키(VITE_FIREBASE_VAPID_KEY)가 없습니다. Firebase 콘솔 → 프로젝트 설정 → ' +
      '클라우드 메시징 → 웹 푸시 인증서에서 키 쌍을 만들어 환경변수에 넣고 다시 배포하세요.'
    )
  }
  return null
}

/* 설정을 쿼리로 넘긴다. 서비스워커에는 import.meta.env가 없어서, 자기 URL에서
 * 읽어 쓴다. register()는 같은 URL이면 이미 등록된 것을 그대로 돌려준다. */
function registerSw() {
  const qs = new URLSearchParams(Object.entries(firebaseConfig).filter(([, v]) => v)).toString()
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${qs}`)
}

/* 탭이 열려 있는(포그라운드) 상태로 오는 푸시는 브라우저가 알아서 안 띄운다 —
 * 직접 띄워야 보인다. 화면을 보고 있으면 굳이 안 띄운다. */
let foregroundBound = false

export async function listenForegroundMessages() {
  if (missingConfig()) return
  if (foregroundBound) return
  if (!(await isSupported())) return
  foregroundBound = true
  onMessage(getMessaging(app), async (payload) => {
    const { title, body } = payload.notification ?? {}
    if (!title) return
    if (document.visibilityState === 'visible') return
    try {
      /* new Notification()은 안드로이드 크롬에서 막혀 있다 — 서비스워커로만 띄운다. */
      const reg = await navigator.serviceWorker.getRegistration()
      await reg?.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'orbital-orbit',
      })
    } catch (e) {
      console.warn('[push] 알림 표시 실패', e)
    }
  })
}

/** 이 기기가 실제로 푸시를 받게 등록돼 있는가. 권한만으로는 모자라다. */
export async function isPushRegistered() {
  if (missingConfig()) return false
  if (!('serviceWorker' in navigator)) return false
  if (!('Notification' in window) || Notification.permission !== 'granted') return false
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sw = reg?.active ?? reg?.waiting ?? reg?.installing
    return Boolean(sw?.scriptURL?.includes('firebase-messaging-sw.js'))
  } catch {
    return false
  }
}

/** 알림 켜기 — 권한을 묻고 토큰을 발급받아 서버에 등록한다. */
export async function enablePush() {
  const missing = missingConfig()
  if (missing) throw new Error(missing)
  if (!(await isSupported())) {
    throw new Error(
      '이 브라우저는 웹 푸시를 지원하지 않습니다. iPhone은 홈 화면에 추가한 뒤 열어보세요.',
    )
  }

  const perm = await Notification.requestPermission()
  if (perm !== 'granted')
    throw new Error('알림이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요.')

  const reg = await registerSw()
  const token = await getToken(getMessaging(app), {
    vapidKey: VAPID,
    serviceWorkerRegistration: reg,
  })
  if (!token) throw new Error('토큰을 발급받지 못했습니다.')

  await registerPushToken(token)
  await listenForegroundMessages()
  return token
}

/* 알림을 기본으로 켠다. 버튼을 찾아 눌러야만 등록되는 게 아니라, 앱이 뜨면
 * 권한을 묻고(이미 허락돼 있으면 창 없이 통과) 조용히 등록한다.
 * 토큰은 브라우저가 알아서 갈아끼우기도 하므로, 이미 등록된 기기도 앱이 뜰
 * 때마다 지금 토큰을 지금 계정으로 다시 적어둔다 — getToken은 이미 있으면
 * 같은 값을 그대로 준다. 거절했거나(iOS 사파리 탭처럼) 지원이 안 되면
 * 아무것도 안 한다. */
export async function ensurePushRegistered() {
  if (missingConfig()) return
  if (!('Notification' in window)) return
  if (!(await isSupported())) return
  if (Notification.permission === 'denied') return
  try {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return
    const reg = await registerSw()
    const token = await getToken(getMessaging(app), {
      vapidKey: VAPID,
      serviceWorkerRegistration: reg,
    })
    if (token) await registerPushToken(token)
    await listenForegroundMessages()
  } catch (e) {
    // 알림 등록은 부가 기능이다. 실패해도 앱은 그대로 써야 한다.
    console.warn('[push] 자동 등록 실패', e)
  }
}
