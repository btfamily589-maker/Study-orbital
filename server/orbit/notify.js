/* Orbit 알림.
 *
 * 미사일은 쏘고 몇 시간 뒤에 떨어진다. 그동안 앱을 안 보고 있으면 맞은 줄도
 * 모르고, 열어봤을 때 안정성만 깎여 있다. 맞는 순간 알려줘야 방어막을 채우든
 * 수리를 하든 손을 쓸 수 있다.
 *
 * 토큰은 Sevenly가 이미 쓰던 곳(classes/{cid}/tokens)을 그대로 쓴다. 문서 ID가
 * 토큰이고 안에 uid가 들어 있어서, 맞은 사람 것만 골라 보낼 수 있다.
 */

import { pushMessage, sendPush } from '../push-message.js'

/**
 * @param deps.adminMessaging () => admin Messaging (server.js의 firebaseAdminMessaging)
 * @param deps.db             Firestore
 * @param deps.classId        반 구분값
 */
export function makeNotifier({ adminMessaging, db, classId }) {
  /**
   * 한 사람에게만 보낸다. 실패해도 게임 진행을 막지 않는다 —
   * 알림이 안 갔다고 착탄을 되돌릴 수는 없다.
   */
  return async function notify(uid, { title, body }) {
    if (!uid) return
    const messaging = adminMessaging?.()
    if (!messaging || !db) return

    try {
      // 설정에서 Orbit 알림을 꺼둔 사람에게는 안 보낸다.
      const member = await db.doc(`classes/${classId}/members/${uid}`).get()
      if (member.data()?.notify?.orbit === false) return

      const snap = await db.collection(`classes/${classId}/tokens`).where('uid', '==', uid).get()
      const tokens = snap.docs.map((d) => d.id)
      if (!tokens.length) return

      await sendPush({
        messaging,
        db,
        classId,
        tokens,
        message: pushMessage('orbit', { title, body }),
      })
    } catch (e) {
      // 알림은 부가 기능이다. 여기서 던지면 착탄 처리 전체가 멈춘다.
      console.error('[orbit notify]', e)
    }
  }
}
