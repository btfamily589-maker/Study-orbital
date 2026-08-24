/* 푸시 한 통을 어떤 모양으로 보낼지 한곳에서 정한다. Sevenly에서 옮겨온 것.
 *
 * 웹푸시에만 있는 것들 — 유효시간(TTL), 급한 정도(Urgency), 같은 종류끼리 묶는
 * tag, 눌렀을 때 열 주소 — 를 비워 두면 두 가지 증상이 난다.
 * 1) 폰이 브라우저를 재웠다 깨우면 몇 시간 지난 알림이 그대로 우르르 배달된다.
 *    TTL을 정해두면 그 시간이 지난 건 배달 자체가 안 된다.
 * 2) 같은 종류가 여러 통 오면 알림창에 그만큼 쌓인다. tag를 붙이면 최신 것
 *    하나로 덮인다.
 */

const ICON = '/icon-192.png'

/** 종류별 유효시간(초)과 급한 정도. */
export const PUSH_KINDS = {
  // 미사일 발사·착탄. 방어막을 사든 피하든 바로 봐야 의미가 있다.
  orbit: { tag: 'orbital-orbit', ttl: 30 * 60, urgency: 'high' },
  // 눌러서 확인하는 용도다. 몇 시간 뒤에 오면 확인이 아니라 혼란이다.
  test: { tag: 'orbital-test', ttl: 5 * 60, urgency: 'high' },
}

/**
 * sendEachForMulticast/send에 그대로 펼쳐 넣을 메시지 본문.
 * @param kind  PUSH_KINDS의 키
 */
export function pushMessage(kind, { title, body, link = '/' }) {
  const spec = PUSH_KINDS[kind]
  if (!spec) throw new Error(`알 수 없는 푸시 종류: ${kind}`)

  const text = body ? { title, body } : { title }

  return {
    webpush: {
      headers: { TTL: String(spec.ttl), Urgency: spec.urgency },
      notification: { ...text, tag: spec.tag, icon: ICON, badge: ICON },
      // 알림을 눌렀을 때 열 주소. 이게 있어야 SDK가 눌림을 처리한다.
      fcmOptions: { link },
      data: { kind },
    },
    notification: text,
  }
}

/** 앱을 지웠거나 알림을 끈 기기의 토큰. 그대로 두면 발송이 계속 실패한다. */
const DEAD_TOKEN_CODES = ['registration-token-not-registered', 'invalid-argument']

/**
 * 여러 기기로 보내고, 죽은 토큰은 정리한다.
 * 토큰은 pushTokens/{token} 문서로 산다 — 문서 ID가 토큰, 안에 uid.
 */
export async function sendPush({ messaging, db, tokens, message }) {
  if (!tokens.length) return { sent: 0, total: 0, dead: 0 }

  const result = await messaging.sendEachForMulticast({ tokens, ...message })

  const dead = []
  result.responses.forEach((r, i) => {
    if (r.success) return
    const code = r.error?.code ?? ''
    if (DEAD_TOKEN_CODES.some((c) => code.includes(c))) dead.push(tokens[i])
  })
  await Promise.all(dead.map((t) => db.doc(`pushTokens/${t}`).delete()))

  return { sent: result.successCount, total: tokens.length, dead: dead.length }
}
