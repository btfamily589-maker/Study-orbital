/* Orbit 인증.
 *
 * 원본은 users/sessions 표에 자체 계정을 두고 JWT를 직접 발급했다. 여기선 그
 * 전부를 버리고 Sevenly 계정을 그대로 쓴다:
 *
 *   브라우저 (Firebase Auth 로그인 상태)
 *     → getIdToken()
 *     → Authorization: Bearer <token>
 *     → 서버가 verifyIdToken()으로 uid 확인
 *     → classes/{cid}/members/{uid}에서 이름 조회
 *
 * 그래서 "Orbit 로그인"이라는 게 따로 없다. Sevenly에 로그인돼 있으면 끝이다.
 */

/** Authorization 헤더에서 Bearer 토큰만 뽑는다. */
function bearer(req) {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

/**
 * 로그인한 반원인지 확인하고 req.orbit에 { uid, nickname, isAdmin }을 채운다.
 * 참가 여부(배가 있는지)는 안 본다 — 참가하기 API도 이걸 통과해야 하니까.
 */
export function makeRequireMember({ adminAuth, store }) {
  return async function requireMember(req, res, next) {
    const token = bearer(req)
    if (!token) {
      return res.status(401).json({ error: '로그인이 필요합니다.' })
    }
    try {
      const decoded = await adminAuth().verifyIdToken(token)
      const uid = decoded.uid

      const memberSnap = await store.base.collection('members').doc(uid).get()
      if (!memberSnap.exists) {
        return res.status(403).json({ error: '반 명부에 없는 계정입니다.' })
      }
      const member = memberSnap.data()

      req.orbit = {
        uid,
        nickname: member.name || '이름 없음',
        isAdmin: member.role === 'admin',
      }
      next()
    } catch (e) {
      // 토큰 만료가 제일 흔하다. 클라이언트가 새로 받아서 재시도하면 된다.
      console.warn('[orbit] 토큰 검증 실패', e?.code || e?.message || e)
      return res.status(401).json({ error: '로그인이 만료됐습니다. 새로고침 후 다시 시도하세요.' })
    }
  }
}

/**
 * 참가자(배가 있는 사람)만 통과. requireMember 뒤에 붙여 쓴다.
 * req.orbit.ship에 배 상태를 얹어준다 — 어차피 대부분의 라우트가 필요로 한다.
 */
export function makeRequireShip({ store }) {
  return async function requireShip(req, res, next) {
    const ship = await store.getShip(req.orbit.uid)
    if (!ship) {
      return res.status(404).json({ error: '아직 참가하지 않았습니다.', notJoined: true })
    }
    req.orbit.ship = ship
    next()
  }
}
