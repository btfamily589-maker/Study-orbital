/* Orbit API 라우터. server.js가 /api/orbit 아래에 마운트한다.
 *
 * 여기는 조립만 한다 — 실제 로직은 study.js 같은 하위 모듈에 있고, 함선 상태를
 * 응답 모양으로 바꾸는 건 format.js가 맡는다.
 */
import { asyncRouter, jsonErrorHandler } from './async-router.js'
import { orbitStore, newShip } from './store.js'
import { makeRequireMember, makeRequireShip } from './auth.js'
import { formatShip } from './format.js'
import { createStudyRoutes } from './study.js'
import {
  createRouteRoutes,
  buildFleet,
  buildStudyRanking,
  buildMissiles,
  namesOf,
  RANKING_LOG_LIMIT,
} from './route.js'
import { createCombatRoutes } from './combat.js'
import { createAdminRoutes } from './admin.js'
import { isNoAttackZone, isNoFlyZone } from './engine.js'
import { resolveDueAttacks } from './combat.js'
import { COL } from './store.js'
import { makeNotifier } from './notify.js'

/**
 * @param deps.adminAuth  () => admin Auth  (server.js의 firebaseAdminAuth)
 * @param deps.adminDb    () => Firestore   (server.js의 firebaseAdminFirestore)
 * @param deps.adminMessaging () => Messaging (미사일 피격 알림용)
 * @param deps.classId    반 구분값
 */
export function createOrbitRouter({ adminAuth, adminDb, adminMessaging, classId }) {
  const router = asyncRouter()

  /* Firestore 인스턴스는 첫 요청 때 만든다. server.js가 Admin SDK를 게으르게
   * 초기화해서, 모듈 로드 시점엔 아직 준비가 안 돼 있을 수 있다. */
  let cached = null
  function store() {
    if (!cached) {
      const db = adminDb()
      if (!db) return null
      cached = orbitStore(db, classId, {
        notify: makeNotifier({ adminMessaging, db, classId }),
      })
    }
    return cached
  }

  // Firebase 설정이 없는 배포에서도 앱 나머지는 돌아가야 한다.
  router.use((req, res, next) => {
    if (!store()) {
      return res.status(501).json({ error: '서버에 Firebase 설정이 없습니다.' })
    }
    next()
  })

  const requireMember = (req, res, next) =>
    makeRequireMember({ adminAuth, store: store() })(req, res, next)
  const requireShip = (req, res, next) => makeRequireShip({ store: store() })(req, res, next)

  /** 내가 참가자인지, 지금 항해 금지 시간인지 — 첫 화면에서 한 번에 묻는다. */
  router.get('/status', requireMember, async (req, res) => {
    const s = store()
    const [ship, settings] = await Promise.all([s.getShip(req.orbit.uid), s.getSettings()])
    res.json({
      joined: !!ship,
      nickname: req.orbit.nickname,
      isAdmin: req.orbit.isAdmin,
      noFlyZone: isNoFlyZone(settings),
      noAttackZone: isNoAttackZone(settings),
    })
  })

  /* 첫 화면에 필요한 걸 한 번에.
   *
   * 예전엔 화면을 한 번 여는 데 요청이 여섯 번 나갔다 — status가 끝나야 나머지
   * 다섯이 출발하는 2단계 구조라 왕복이 두 겹으로 쌓였고, 요청마다 토큰을 다시
   * 검증하고 명부를 다시 읽어서 Firestore 왕복이 18번이었다(그중 반 명부 전체를
   * 읽은 것만 일곱 번). 20초마다 그걸 통째로 반복했다.
   *
   * 여기서는 읽기를 한 번씩만 하고 그 결과를 조립 함수들에 나눠준다. 착탄 처리도
   * 한 번만 돌린다(예전엔 leaderboard와 missiles가 각각 돌렸다).
   *
   * 기존 낱개 API는 그대로 둔다 — 다른 화면들이 쓰고 있고, 여기가 잘못돼도
   * 그쪽으로 돌아갈 수 있어야 한다. */
  router.get('/boot', requireMember, async (req, res) => {
    const s = store()
    const uid = req.orbit.uid

    /* 착탄부터 처리한다. 이걸 먼저 안 하면 방금 떨어진 미사일이 반영되기 전의
     * 배 상태를 읽게 된다. */
    await resolveDueAttacks(s)

    const [ships, membersSnap, sessionsSnap, settings, logsSnap, attacksSnap] = await Promise.all([
      s.allShips(),
      s.base.collection('members').get(),
      s.col(COL.sessions).get(),
      s.getSettings(),
      s.col(COL.logs).orderBy('createdAt', 'desc').limit(RANKING_LOG_LIMIT).get(),
      s.col(COL.attacks).where('status', '==', 'in_flight').get(),
    ])

    const names = namesOf(membersSnap)
    const sessions = new Map(sessionsSnap.docs.map((d) => [d.id, d.data()]))
    const ship = ships.find((x) => x.uid === uid) ?? null

    const status = {
      joined: !!ship,
      nickname: req.orbit.nickname,
      isAdmin: req.orbit.isAdmin,
      noFlyZone: isNoFlyZone(settings),
      noAttackZone: isNoAttackZone(settings),
    }

    // 아직 참가 안 했으면 나머지는 그릴 게 없다 — 참가 화면만 뜨면 된다.
    if (!ship)
      return res.json({ status, ship: null, fleet: [], ranking: [], missiles: [], session: null })

    /* 세션은 이미 읽은 sessions 맵 안에 있다 — 따로 한 번 더 읽지 않는다.
     * mine은 "이 기기가 돌리는 세션인가"다(다른 기기 것이면 구경만 한다). */
    const mySession = sessions.get(uid) ?? null
    const device = String(req.get('x-device-id') ?? '').slice(0, 64)

    res.json({
      status,
      ship: formatShip(ship, req.orbit.nickname, s.rankOf(ships, uid)),
      fleet: buildFleet({ uid, ships, names, sessions }),
      ranking: buildStudyRanking({
        uid,
        logs: logsSnap.docs.map((d) => d.data()),
        names,
        ships,
        today: req.query.today || null,
      }),
      missiles: buildMissiles({
        uid,
        attacks: attacksSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        names,
      }),
      session: mySession?.startedAt
        ? {
            sessionId: mySession.sessionId,
            startedAt: mySession.startedAt,
            mine: !mySession.deviceId || mySession.deviceId === device,
          }
        : { sessionId: null, startedAt: null },
    })
  })

  /* 참가하기. 원본은 회원가입이 곧 참가였지만, 여기선 반원 중 원하는 사람만
   * 배를 받는다 — 배 문서가 있으면 참가자, 없으면 미참가. */
  router.post('/join', requireMember, async (req, res) => {
    const s = store()
    const ref = s.shipRef(req.orbit.uid)

    /* 두 번 눌러도 배가 두 개 생기거나 초기화되면 안 된다. 트랜잭션 안에서
     * "없을 때만 만들기"로 처리한다. */
    const created = await s.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (snap.exists) return false
      tx.set(ref, newShip(req.orbit.uid))
      return true
    })

    if (created) {
      await s.addSystemMessage(`🚀 ${req.orbit.nickname} 님이 항해를 시작했습니다.`)
    }

    const ships = await s.allShips()
    const ship = ships.find((x) => x.uid === req.orbit.uid)
    res.json(formatShip(ship, req.orbit.nickname, s.rankOf(ships, req.orbit.uid)))
  })

  /** 내 배 상태 */
  router.get('/ship', requireMember, requireShip, async (req, res) => {
    const s = store()
    const ships = await s.allShips()
    res.json(formatShip(req.orbit.ship, req.orbit.nickname, s.rankOf(ships, req.orbit.uid)))
  })

  /** 참가자 전원 — 항로맵·랭킹·공격 대상 고르기에 쓴다. */
  router.get('/fleet', requireMember, async (req, res) => {
    const s = store()
    const [ships, membersSnap] = await Promise.all([
      s.allShips(),
      s.base.collection('members').get(),
    ])

    // 닉네임은 Sevenly 명부가 원본이다. 배 문서엔 복사해두지 않는다.
    const names = new Map(membersSnap.docs.map((d) => [d.id, d.data().name || '이름 없음']))
    const sorted = [...ships].sort((a, b) => b.routePosition - a.routePosition)

    res.json(sorted.map((ship, i) => formatShip(ship, names.get(ship.uid) ?? '이름 없음', i + 1)))
  })

  /* 하위 라우터들. store()는 첫 요청 때 만들어지므로 지금 라우트를 만들 수
   * 없다 — 요청이 들어온 시점에 한 번 만들어 두고 위임한다. */
  const lazy = (make) => {
    let sub = null
    return (req, res, next) => {
      if (!sub) sub = make()
      sub(req, res, next)
    }
  }

  // 공부 세션·로그
  router.use(
    '/study',
    lazy(() => createStudyRoutes({ store: store(), requireMember, requireShip })),
  )
  // 항로맵·랭킹
  router.use(
    '/route',
    lazy(() => createRouteRoutes({ store: store(), requireMember })),
  )
  // 공격·방어막·수리
  router.use(
    '/combat',
    lazy(() => createCombatRoutes({ store: store(), requireMember, requireShip })),
  )
  // 운영자 (설정·참가자 관리·시뮬레이션)
  router.use(
    '/admin',
    lazy(() => createAdminRoutes({ store: store(), requireMember })),
  )

  /* 맨 끝. 위 어디서 터졌든(하위 라우터 포함) 여기로 모여 500이 나간다. 이게
   * 없으면 Express 기본 처리기가 HTML 오류 문서를 내려보내고, 클라이언트는 그걸
   * JSON으로 읽으려다 엉뚱한 소리를 한다. */
  router.use(jsonErrorHandler('orbit'))

  return router
}
