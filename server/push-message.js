/* 푸시 한 통을 어떤 모양으로 보낼지 한곳에서 정한다.
 *
 * 예전엔 보내는 곳마다(아침 크론·저녁 크론·테스트·오비탈) 각자
 * `{ notification: { title, body } }`만 넘겼다. 그래서 웹푸시에만 있는 것들 —
 * 유효시간(TTL), 급한 정도(Urgency), 같은 종류끼리 묶는 tag, 눌렀을 때 열 주소 —
 * 이 전부 비어 있었다. 그게 두 가지 증상으로 나타났다.
 *
 * 1) 폰이 브라우저를 재웠다 깨우면(삼성 기기에서 최근 앱을 모두 닫으면 그렇게 된다)
 *    그동안 밀린 푸시가 한꺼번에 쏟아진다. TTL이 없으면 몇 시간 지난 알림도 그대로
 *    배달된다 — 이미 지나간 미사일 피격 알림이 그때 우르르 뜨는 이유다.
 *    종류마다 유효시간을 정해두면 그 시간이 지난 건 배달 자체가 안 된다.
 *
 * 2) 같은 종류가 여러 통 오면 알림창에 그만큼 쌓인다. tag를 붙이면 최신 것 하나로
 *    덮인다 — 미사일 다섯 발이면 다섯 줄이 아니라 마지막 한 줄만 남는다.
 *
 * notification과 webpush.notification을 둘 다 넣는다. 웹에서는 뒤엣것이 이기고,
 * 혹시 다른 경로로 갈 때를 위해 앞엣것도 남겨둔다.
 */

const ICON = '/icon-192.png'

/**
 * 종류별 유효시간(초)과 급한 정도.
 * 유효시간은 "이 시간이 지나면 안 보내느니만 못한가"로 정했다.
 */
export const PUSH_KINDS = {
  // 게시판에 새 글. 급한 건 아니지만 그날 안에는 봐야 의미가 있다.
  post: { tag: 'sevenly-post', ttl: 6 * 3600, urgency: 'normal' },
  // 알림장. 준비물·공지가 올라오는 곳이라 늦게 보면 곤란하다.
  notice: { tag: 'sevenly-notice', ttl: 12 * 3600, urgency: 'high' },
  // 07:20 아침 알림. 1교시가 시작하고도 한참 뒤에 오면 의미가 없다.
  morning: { tag: 'sevenly-morning', ttl: 3 * 3600, urgency: 'high' },
  // 17:30 내일 일정. 자기 전까지는 쓸모가 있다.
  evening: { tag: 'sevenly-evening', ttl: 6 * 3600, urgency: 'normal' },
  // 피격. 방어막을 채우든 수리를 하든 바로 손을 써야 의미가 있다.
  orbit: { tag: 'sevenly-orbit', ttl: 30 * 60, urgency: 'high' },
  /* GMC패스 신청. 평일 저녁에 한 번 가는 알림이다. 그날 안 하면 소용없으니
   * 밤까지만 살려둔다 — 다음 날 아침에 뒤늦게 뜨면 헷갈리기만 한다. */
  gmc: { tag: 'sevenly-gmc', ttl: 4 * 3600, urgency: 'high' },
  // 눌러서 확인하는 용도다. 몇 시간 뒤에 오면 확인이 아니라 혼란이다.
  test: { tag: 'sevenly-test', ttl: 5 * 60, urgency: 'high' },
}

/**
 * sendEachForMulticast/send에 그대로 펼쳐 넣을 메시지 본문.
 * @param kind  PUSH_KINDS의 키
 */
export function pushMessage(kind, { title, body, link = '/' }) {
  const spec = PUSH_KINDS[kind]
  if (!spec) throw new Error(`알 수 없는 푸시 종류: ${kind}`)

  /* 본문이 없는 알림도 있다 — GMC패스처럼 제목 한 줄이면 끝나는 것들이다.
   * 빈 문자열을 실어 보내면 알림창에 빈 줄이 한 칸 생기므로 아예 뺀다. */
  const text = body ? { title, body } : { title }

  return {
    notification: text,
    webpush: {
      headers: { TTL: String(spec.ttl), Urgency: spec.urgency },
      notification: { ...text, tag: spec.tag, icon: ICON, badge: ICON },
      // 알림을 눌렀을 때 열 주소. 이게 있어야 SDK가 눌림을 처리한다.
      fcmOptions: { link },
      data: { kind },
    },
  }
}

/** 앱을 지웠거나 알림을 끈 기기의 토큰. 그대로 두면 발송이 계속 실패한다. */
const DEAD_TOKEN_CODES = ['registration-token-not-registered', 'invalid-argument']

/**
 * 여러 기기로 보내고, 죽은 토큰은 정리한다.
 *
 * 예전엔 보내는 곳마다(아침·저녁 크론, 테스트, 게시판) 이 열 줄을 각자 베껴
 * 갖고 있었다. firestore.rules가 "토큰 삭제는 서버가 한다"를 전제하므로 정리를
 * 빠뜨리면 죽은 토큰이 영원히 쌓인다.
 */
export async function sendPush({ messaging, db, classId, tokens, message }) {
  if (!tokens.length) return { sent: 0, total: 0, dead: 0 }

  const result = await messaging.sendEachForMulticast({ tokens, ...message })

  const dead = []
  result.responses.forEach((r, i) => {
    if (r.success) return
    const code = r.error?.code ?? ''
    if (DEAD_TOKEN_CODES.some((c) => code.includes(c))) dead.push(tokens[i])
  })
  await Promise.all(dead.map((t) => db.doc(`classes/${classId}/tokens/${t}`).delete()))

  return { sent: result.successCount, total: tokens.length, dead: dead.length }
}
