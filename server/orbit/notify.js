/* Orbit 알림.
 *
 * 미사일은 쏘고 몇 시간 뒤에 떨어진다. 그동안 앱을 안 보고 있으면 맞은 줄도
 * 모르고, 열어봤을 때 에너지만 깎여 있다. 발사됐을 때·맞았을 때 알려줘야
 * 방어막을 사든 피하든 손을 쓸 수 있다.
 *
 * 토큰은 방과 무관하게 사람에게 붙는다 — pushTokens/{token} 문서 안의 uid로
 * 받을 사람 것만 골라 보낸다 (server.js의 /api/push/register가 적는다).
 */

import { pushMessage, sendPush } from '../push-message.js'

/**
 * @param deps.adminMessaging () => admin Messaging
 * @param deps.db             Firestore
 */
export function makeNotifier({ adminMessaging, db }) {
  /**
   * 한 사람에게만 보낸다. 실패해도 게임 진행을 막지 않는다 —
   * 알림이 안 갔다고 착탄을 되돌릴 수는 없다.
   */
  return async function notify(uid, { title, body }) {
    if (!uid) return
    const messaging = adminMessaging?.()
    if (!messaging || !db) return

    try {
      const snap = await db.collection('pushTokens').where('uid', '==', uid).get()
      const tokens = snap.docs.map((d) => d.id)
      if (!tokens.length) return

      await sendPush({ messaging, db, tokens, message: pushMessage('orbit', { title, body }) })
    } catch (e) {
      // 알림은 부가 기능이다. 여기서 던지면 착탄 처리 전체가 멈춘다.
      console.error('[orbit notify]', e)
    }
  }
}
