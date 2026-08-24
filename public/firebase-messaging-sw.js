/* 백그라운드 푸시 수신용 서비스워커.
 * 서비스워커에는 import.meta.env가 없다. 그래서 push.js가 등록할 때 설정을
 * 쿼리스트링으로 붙여 보내고, 여기서 자기 URL을 읽어 쓴다. 이렇게 해야 설정이
 * .env 한 군데에만 남는다 — 예전처럼 여기에 값을 또 적어두면 한쪽만 바뀌어도
 * 조용히 어긋난다.
 * 이 값들은 공개돼도 되는 웹 설정값이다 (실제 보호는 firestore.rules가 한다). */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js')

const cfg = Object.fromEntries(new URL(self.location).searchParams)

/* 새 서비스워커가 바로 일을 넘겨받게 한다. 기본값은 "열려 있는 탭이 전부 닫힐
 * 때까지 기다리기"라서, 고쳐서 배포해도 예전 서비스워커가 한참 더 푸시를
 * 처리한다 — 알림이 두 개씩 뜨던 문제가 며칠씩 남아 있게 된다.
 * 여기는 화면을 그리지 않고 푸시만 받으므로 바로 바꿔도 위험하지 않다. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

/* firebase.messaging()을 부르는 것만으로 SDK가 push·notificationclick을 다 맡는다 —
 * 알림 표시도, 눌렀을 때 앱을 여는 것도.
 *
 * 예전엔 여기에 onBackgroundMessage 핸들러를 하나 더 달아서 직접
 * showNotification을 불렀다. 그런데 SDK는 notification이 실린 푸시를 받으면
 * *자기가 먼저 띄우고 나서* 이 핸들러를 부른다(@firebase/messaging의 onPush).
 * 그래서 푸시 한 통에 알림이 두 개씩 떴다 — tag도 서로 달라서 합쳐지지 않았다.
 * 표시는 SDK에 맡기고, 모양(tag·아이콘·눌렀을 때 열 주소)은 서버가
 * webpush.notification으로 정해서 보낸다(server/push-message.js). */
if (cfg.apiKey && cfg.projectId) {
  firebase.initializeApp(cfg)
  firebase.messaging()
}

/* 앱이 직접 띄운 알림(포그라운드 경로)과, 링크 없이 보내진 옛 알림용 대비책.
 * FCM이 띄운 알림은 SDK 핸들러가 stopImmediatePropagation으로 먼저 끊기 때문에
 * 여기까지 오지 않는다 — 창이 두 개 열릴 일은 없다. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin)
      return open ? open.focus() : self.clients.openWindow('/')
    }),
  )
})
