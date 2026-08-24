/* 항로맵·랭킹.
 *
 * 원본 route.ts에서 옮겼다. 핵심은 "살아있는 위치(live position)"다 — 지금 공부
 * 중인 사람은 세션 시작 시각부터 흐른 시간만큼 위치를 미리 더해서 보여준다.
 * 세션이 끝나야 위치가 갱신되면 맵이 멈춰 있는 것처럼 보이는데, 이렇게 하면
 * 남이 공부하는 동안 배가 실제로 기어가는 게 보인다.
 *
 * 실제 저장된 위치는 세션이 끝날 때 한 번만 쓴다(study.js) — 여기서 더하는 건
 * 화면에 보여주는 값일 뿐이라 DB에 안 쌓인다.
 */
import { asyncRouter } from './async-router.js'
import { COL } from './store.js'
import {
  ATTACK_CONFIGS,
  MAX_SHIELDS,
  clampEnergy,
  distanceFor,
  getShipStatus,
  getSpeedFactor,
} from './engine.js'
import { energyFor, settledAtOf } from './progress.js'
import { resolveDueAttacks } from './combat.js'

/* ------------------------------------------------------------------
 * 조립 함수들.
 *
 * 라우트마다 Firestore를 각자 읽던 걸, "이미 읽어온 것"을 받아 모양만 만드는
 * 순수 함수로 떼어냈다. 첫 화면(/boot)이 한 번만 읽어서 이 함수들에 나눠줄 수
 * 있게 하려는 것이다 — 예전엔 화면 한 번 여는 데 반 명부를 일곱 번 읽었다.
 * ---------------------------------------------------------------- */

/** 함대 + 순위. 공부 중인 사람은 흐른 시간만큼 미리 나아간 위치로 보여준다. */
export function buildFleet({ uid, ships, names, sessions, now = Date.now() }) {
  const enriched = ships.map((ship) => {
    /* 공부 중이면 마지막 정산 이후 흐른 만큼 미리 나아간 위치·잔고를 보여준다.
     * 문서에 쓰지는 않는다 — 화면용 값이다. 실제 반영은 세션이 끝나거나
     * 미사일을 맞을 때 일어난다(progress.js). */
    const session = sessions.get(ship.uid)
    const energy = Math.max(0, ship.energy ?? 0)
    let liveEnergy = energy
    let livePosition = ship.routePosition

    if (session?.startedAt) {
      const minutes = Math.max(0, (now - settledAtOf(session).getTime()) / 60000)
      const gained = energyFor(minutes)
      livePosition += distanceFor(energy, gained)
      liveEnergy = clampEnergy(energy + gained)
    }

    return {
      uid: ship.uid,
      nickname: names.get(ship.uid) ?? '이름 없음',
      routePosition: livePosition,
      savedPosition: ship.routePosition,
      status: getShipStatus(liveEnergy),
      energy: liveEnergy,
      speed: getSpeedFactor(liveEnergy),
      shields: ship.shields ?? 0,
      maxShields: MAX_SHIELDS,
      isMe: ship.uid === uid,
      isStudying: !!session?.startedAt,
      sessionStartedAt: session?.startedAt ?? null,
    }
  })

  enriched.sort((a, b) => b.routePosition - a.routePosition)
  return enriched.map((e, i) => ({ ...e, rank: i + 1 }))
}

/** 공부 시간 순위 — 오늘·주간·월간·누적 합계. 정렬은 화면이 한다. */
export function buildStudyRanking({ uid, logs, names, ships, today }) {
  /* 오늘 = 새벽 5시 기준 하루(클라이언트가 계산해서 보낸다).
   * 주간 = 오늘 포함 7일, 월간 = 오늘 포함 30일. 달력상의 '이번 달'이 아니라
   * 최근 30일이다 — 1일에 순위가 통째로 비는 게 더 이상하다. */
  const daysBack = (n) => {
    const set = new Set()
    if (!today) return set
    const base = new Date(`${today}T00:00:00Z`)
    for (let i = 0; i < n; i++) {
      const d = new Date(base)
      d.setUTCDate(d.getUTCDate() - i)
      set.add(d.toISOString().slice(0, 10))
    }
    return set
  }
  const week = daysBack(7)
  const month = daysBack(30)

  /* 나간 사람은 순위에서도 뺀다.
   *
   * 함대(ships)에는 명부에 있는 사람만 온다(store.js allShips). 그런데 로그는
   * 그 사람이 나가도 남아 있어서, 로그만 보고 줄을 만들면 "이름 없음"이 순위표에
   * 그대로 뜬다 — 지금 반에 있는 사람만 센다. */
  const alive = new Set(ships.map((x) => x.uid))

  const byUid = new Map()
  for (const log of logs) {
    if (log.status && log.status !== 'valid') continue
    if (!alive.has(log.uid)) continue
    if (!byUid.has(log.uid)) byUid.set(log.uid, { today: 0, week: 0, month: 0, total: 0 })
    const acc = byUid.get(log.uid)
    const m = log.durationMinutes ?? 0
    acc.total += m
    if (log.studyDate === today) acc.today += m
    if (week.has(log.studyDate)) acc.week += m
    if (month.has(log.studyDate)) acc.month += m
  }

  /* 참가자 전원을 넣는다. 기록이 없는 사람이 순위에서 아예 사라지면
   * "나는 왜 없지?"가 된다 — 0분으로라도 자리를 만들어 준다. */
  for (const ship of ships) {
    if (!byUid.has(ship.uid)) byUid.set(ship.uid, { today: 0, week: 0, month: 0, total: 0 })
  }

  return [...byUid.entries()].map(([id, acc]) => ({
    uid: id,
    nickname: names.get(id) ?? '이름 없음',
    todayMinutes: acc.today,
    weekMinutes: acc.week,
    monthMinutes: acc.month,
    totalMinutes: acc.total,
    isMe: id === uid,
  }))
}

/** 날아다니는 미사일. 스텔스는 쏜 본인에게만 보인다. */
export function buildMissiles({ uid, attacks, names }) {
  return attacks
    .filter((a) => !a.stealth || a.attackerUid === uid)
    .map((a) => ({
      id: a.id,
      type: a.attackType,
      fromUid: a.attackerUid,
      toUid: a.targetUid,
      fromNickname: names.get(a.attackerUid) ?? '?',
      toNickname: names.get(a.targetUid) ?? '?',
      // 발사 시점 좌표. 배가 순위에서 사라져도 선은 그려야 한다.
      fromPos: a.fromPos ?? 0,
      toPos: a.toPos ?? 0,
      launchedAt: new Date(a.createdAt).getTime(),
      impactAt: new Date(a.impactAt).getTime(),
      stealth: !!a.stealth,
      isMine: a.attackerUid === uid,
      /* 요격탄이 마주 오는 중이면 그 사정도 같이 준다. 목록은 "요격 중" 배지를,
       * 맵은 표적을 향해 날아가는 요격탄과 그 경로를 이걸로 그린다. */
      interceptedBy: a.interceptedBy ?? null,
      interceptorType: a.interceptorType ?? null,
      interceptStartAt: a.interceptStartAt ? new Date(a.interceptStartAt).getTime() : null,
      interceptAt: a.interceptAt ? new Date(a.interceptAt).getTime() : null,
    }))
}

/* 누적은 가져온 범위 안에서만 정확하다. 한 반이 한 학기에 쌓는 양(대략
 * 30명 × 하루 2건 × 100일 = 6000건)을 넘으면 오래된 기록이 빠진다. 그때가
 * 오면 날짜별 합계를 따로 저장하는 쪽으로 바꿔야 한다. */
export const RANKING_LOG_LIMIT = 6000

/** 이름 맵. members 스냅샷 하나로 여러 조립 함수가 같이 쓴다. */
export const namesOf = (membersSnap) =>
  new Map(membersSnap.docs.map((d) => [d.id, d.data().name || '이름 없음']))

export function createRouteRoutes({ store, requireMember }) {
  const router = asyncRouter()
  const s = store

  /** 함대 전체 + 순위. 항로맵과 랭킹이 같이 쓴다. */
  router.get('/leaderboard', requireMember, async (req, res) => {
    /* 맵을 그리기 전에 도착한 미사일부터 터뜨린다. 예약 타이머를 쓰지 않으므로
     * 여기가 실제로 착탄이 일어나는 지점이다(combat.js 머리말 참고). */
    await resolveDueAttacks(s)

    const [ships, membersSnap, sessionsSnap] = await Promise.all([
      s.allShips(),
      s.base.collection('members').get(),
      s.col(COL.sessions).get(),
    ])

    res.json(
      buildFleet({
        uid: req.orbit.uid,
        ships,
        names: namesOf(membersSnap),
        // 진행 중인 세션. 문서 ID가 uid라 그대로 맵이 된다.
        sessions: new Map(sessionsSnap.docs.map((d) => [d.id, d.data()])),
      }),
    )
  })

  /* 공부 시간 순위 — 오늘 · 주간 · 월간 · 누적.
   *
   * 원본은 SQL GROUP BY 한 방이었지만 Firestore엔 집계가 없다. 로그를 가져와
   * 서버에서 더한다 — 인원이 열 명 안팎이라 이 편이 색인 만드는 것보다 싸고
   * 단순하다. */
  router.get('/study-ranking', requireMember, async (req, res) => {
    const [logsSnap, membersSnap, ships] = await Promise.all([
      s.col(COL.logs).orderBy('createdAt', 'desc').limit(RANKING_LOG_LIMIT).get(),
      s.base.collection('members').get(),
      s.allShips(),
    ])

    res.json(
      buildStudyRanking({
        uid: req.orbit.uid,
        logs: logsSnap.docs.map((d) => d.data()),
        names: namesOf(membersSnap),
        ships,
        today: req.query.today || null,
      }),
    )
  })

  /* 지금 날아다니는 미사일. 맵에 궤적을 그리는 데 쓴다.
   * 스텔스는 쏜 본인에게만 보인다 — 맞는 쪽은 터지기 전까지 모른다. */
  router.get('/missiles', requireMember, async (req, res) => {
    await resolveDueAttacks(s)

    const [snap, names] = await Promise.all([
      s.col(COL.attacks).where('status', '==', 'in_flight').get(),
      s.memberNames(),
    ])

    res.json(
      buildMissiles({
        uid: req.orbit.uid,
        attacks: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
        names,
      }),
    )
  })

  /* 지금까지 발사된 것 전부. OPER의 log 탭이 일별로 나눠 보여준다.
   *
   * 스텔스는 아직 날아가는 동안에만 감춘다 — 이미 떨어진 건 누가 쐈는지 다들
   * 아는 마당이라 목록에서만 가리는 건 뜻이 없다. */
  router.get('/attacks', requireMember, async (req, res) => {
    await resolveDueAttacks(s)
    const limit = Math.min(300, parseInt(req.query.limit ?? '120', 10) || 120)

    const [snap, names] = await Promise.all([
      s.col(COL.attacks).orderBy('createdAt', 'desc').limit(limit).get(),
      s.memberNames(),
    ])

    const uid = req.orbit.uid
    res.json(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => !(a.stealth && a.status === 'in_flight' && a.attackerUid !== uid))
        .map((a) => ({
          id: a.id,
          type: a.attackType,
          status: a.status,
          fromNickname: names.get(a.attackerUid) ?? '?',
          /* 요격탄의 상대는 사람이 아니라 미사일이다. "주현규의 Missile"처럼
           * 문장으로 만들어 내려보내면 화면은 여느 줄처럼 그대로 그리면 된다. */
          toNickname: a.targetAttackId
            ? `${names.get(a.targetMissileFrom) ?? '?'}의 ${
                ATTACK_CONFIGS[a.targetMissileType]?.label ?? '미사일'
              }`
            : (names.get(a.targetUid) ?? '?'),
          isMine: a.attackerUid === uid,
          isTarget: a.targetUid === uid,
          reflected: !!a.reflected,
          intercept: !!a.targetAttackId,
          damageDealt: a.damageDealt ?? 0,
          launchedAt: new Date(a.createdAt).getTime(),
          impactAt: new Date(a.impactAt).getTime(),
        })),
    )
  })

  return router
}
