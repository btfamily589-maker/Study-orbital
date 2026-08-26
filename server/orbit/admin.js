/* Orbit 운영자 기능. Sevenly 설정 탭에서 쓴다.
 *
 * 원본은 별도 운영자 화면(admin.ts)이 있었다. 여기선 Sevenly 설정 탭 안으로
 * 넣었다 — 운영자가 두 군데를 오갈 이유가 없다.
 *
 * 전부 운영자만 부를 수 있다. 판정은 Sevenly 명부의 role이 한다
 * (classes/{cid}/members/{uid}.role === 'admin'). Orbit에 따로 권한이 없다.
 */
import { asyncRouter } from './async-router.js'
import { COL, newShip } from './store.js'
import { MAX_ENERGY, MAX_SHIELDS, clampEnergy, studyDayOf } from './engine.js'

/* 시뮬레이션이 만드는 함선 수와, 반원이 모자랄 때 채워 넣는 가짜 반원.
 * uid에 접두사를 두는 이유는 초기화할 때 이것들만 골라 지우기 위해서다. */
const SIM_SHIPS = 8
const SIM_PREFIX = 'sim:'
const SIM_NAMES = ['가영', '나준', '다은', '라온', '마루', '바다', '사랑', '아름']

/** 운영자가 아니면 여기서 끊는다. requireMember 다음에 온다. */
function requireAdmin(req, res, next) {
  if (!req.orbit?.isAdmin) return res.status(403).json({ error: '운영자만 쓸 수 있습니다.' })
  next()
}

const iso = (ms) => new Date(ms).toISOString()

/* Firestore 배치는 500건이 상한이다. 반원 수가 늘면 시뮬레이션이 그걸 넘길 수
 * 있어서, 400건마다 알아서 끊어 커밋하는 얇은 껍데기를 쓴다. */
function chunkedWriter(db, limit = 400) {
  let batch = db.batch()
  let n = 0
  const pending = []
  return {
    set(ref, data) {
      batch.set(ref, data)
      if (++n >= limit) {
        pending.push(batch.commit())
        batch = db.batch()
        n = 0
      }
    },
    async commit() {
      if (n > 0) pending.push(batch.commit())
      await Promise.all(pending)
    },
  }
}

/* 시뮬레이션에 쓸 과목. 로그가 전부 같은 내용이면 화면이 어떻게 보이는지
 * 확인이 안 된다. */
const SUBJECTS = [
  '수학 미적분 3단원',
  '영어 독해 모의고사',
  '물리 역학 문제풀이',
  '생명 유전 단원정리',
  '확률과통계 기출',
  '국어 문학 작품분석',
  '화학 산화환원',
  '윤리 사상가 정리',
]

export function createAdminRoutes({ store, requireMember }) {
  const router = asyncRouter()
  const s = store
  const guard = [requireMember, requireAdmin]

  /* ── 설정 ─────────────────────────────────────────────── */

  /** 현재 설정. 읽기는 참가자 누구나 — 언제 항해 금지인지는 다 알아야 한다. */
  router.get('/settings', requireMember, async (req, res) => {
    res.json(await s.getSettings())
  })

  /** 항해 금지 시간대 설정. */
  router.put('/settings', guard, async (req, res) => {
    const { nfzEnabled, nfzStart, nfzEnd, nazEnabled, nazStart, nazEnd } = req.body || {}
    const patch = {}

    if (nfzEnabled !== undefined) patch.nfzEnabled = !!nfzEnabled
    if (nazEnabled !== undefined) patch.nazEnabled = !!nazEnabled
    for (const [key, val] of [
      ['nfzStart', nfzStart],
      ['nfzEnd', nfzEnd],
      ['nazStart', nazStart],
      ['nazEnd', nazEnd],
    ]) {
      if (val === undefined) continue
      // HH:MM만 받는다. 형식이 깨지면 문자열 비교로 하는 시간 판정이 조용히 틀어진다.
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(val))) {
        return res.status(400).json({ error: `${key}는 HH:MM 형식이어야 합니다.` })
      }
      patch[key] = String(val)
    }

    /* 항해 금지는 수업시간 개념이라 하루 안에서 끝나야 한다. 공격 금지는
     * 밤 구간(자정 걸침)이 기본 꼴이라 순서를 강제하지 않는다 — 시작이 더
     * 늦으면 "그 시각부터 다음 날 그 시각까지"로 읽는다(engine.inTimeWindow). */
    if (patch.nfzStart && patch.nfzEnd && patch.nfzStart >= patch.nfzEnd) {
      return res.status(400).json({ error: '시작 시각이 종료 시각보다 빨라야 합니다.' })
    }

    await s.col(COL.settings).doc('config').set(patch, { merge: true })
    res.json(await s.getSettings())
  })

  /* ── 참가자 ───────────────────────────────────────────── */

  /** 반원 전체 + 참가 여부·현재 상태. 운영자 화면 목록용. */
  router.get('/members', guard, async (req, res) => {
    const [names, ships, sessionsSnap] = await Promise.all([
      s.memberNames(),
      s.allShips(),
      s.col(COL.sessions).get(),
    ])
    const byUid = new Map(ships.map((x) => [x.uid, x]))
    const studying = new Set(sessionsSnap.docs.map((d) => d.id))

    res.json(
      [...names.entries()].map(([uid, name]) => {
        const ship = byUid.get(uid)
        return {
          uid,
          name,
          joined: !!ship,
          isMe: uid === req.orbit.uid,
          isStudying: studying.has(uid),
          energy: ship?.energy ?? null,
          shields: ship?.shields ?? null,
          routePosition: ship?.routePosition ?? null,
        }
      }),
    )
  })

  /** 함선 상태를 직접 고친다. 준 값만 바뀐다. */
  router.patch('/ship/:uid', guard, async (req, res) => {
    const { uid } = req.params
    const { energy, shields, routePosition } = req.body || {}

    const patch = { updatedAt: new Date().toISOString() }
    if (energy !== undefined) patch.energy = clampEnergy(Number(energy))
    if (shields !== undefined) {
      patch.shields = Math.max(0, Math.min(MAX_SHIELDS, Math.floor(Number(shields))))
    }
    if (routePosition !== undefined) patch.routePosition = Math.max(0, Number(routePosition))

    for (const v of Object.values(patch)) {
      if (typeof v === 'number' && !Number.isFinite(v)) {
        return res.status(400).json({ error: '숫자가 아닌 값이 있습니다.' })
      }
    }

    // 아직 참가 안 한 사람이면 배부터 만들어준다.
    const ref = s.shipRef(uid)
    const snap = await ref.get()
    if (!snap.exists) await ref.set({ ...newShip(uid), ...patch })
    else await ref.update(patch)

    res.json({ ok: true, ...(await ref.get()).data() })
  })

  /* ── 시뮬레이션 ───────────────────────────────────────── */

  /* 손으로 만들기 번거로운 상황을 한 번에 깔아준다. 화면이 실제로 어떻게
   * 보이는지 보려면 함선이 흩어져 있고, 미사일이 날고, 누군가는 정지해 있고,
   * 랭킹에 쌓인 기록이 있어야 한다.
   *
   * 참가 안 한 반원에게도 배를 만들어준다 — 테스트 도구니까. */
  router.post('/simulate', guard, async (req, res) => {
    const now = Date.now()
    const me = req.orbit.uid
    const names = await s.memberNames()

    // 나를 맨 앞에 두고 나머지를 뒤에 붙인다. 시나리오 배정이 결정적이어야
    // 몇 번을 돌려도 같은 그림이 나온다.
    const real = [me, ...[...names.keys()].filter((u) => u !== me).sort()]

    /* 시뮬레이션은 여덟 대쯤 떠 있어야 볼 게 있다 — 순위 다툼도, 페이지 넘김도,
     * 여기저기 날아다니는 미사일도 사람이 적으면 그림이 안 나온다. 반원이
     * 모자라면 가짜 반원을 만들어 채운다. 이름 앞에 [시뮬]을 붙여서 진짜 반원과
     * 헷갈리지 않게 하고, 초기화할 때 같이 지운다. */
    const fillers = []
    for (let i = real.length; i < SIM_SHIPS; i++) {
      const uid = `${SIM_PREFIX}${i}`
      const name = `[시뮬] ${SIM_NAMES[i % SIM_NAMES.length]}`
      fillers.push({ uid, name })
      names.set(uid, name)
    }
    const uids = [...real, ...fillers.map((f) => f.uid)].slice(0, Math.max(SIM_SHIPS, real.length))

    /* 시나리오. 앞에서부터 순서대로 배정하고, 인원이 모자라면 있는 만큼만 쓴다.
     * 나(0번)는 요청대로 에너지를 꽉 채우고 상태도 최상으로 둔다. */
    const scenarios = [
      { pos: 12.4, shields: 1, energy: MAX_ENERGY, note: '나 — 선두, 에너지 만땅에 방어막' },
      { pos: 11.8, shields: 0, energy: 12, note: '바짝 추격, 에너지가 모자라 느리다' },
      { pos: 9.2, shields: 1, energy: 30, note: '최고속 문턱, 방어막 있음' },
      { pos: 7.6, shields: 0, energy: 0, note: '에너지 고갈 — 멈춰 있다' },
      { pos: 6.1, shields: 0, energy: 8, note: '한 대 더 맞으면 바닥' },
      { pos: 4.3, shields: 0, energy: 22, note: '보통' },
      { pos: 2.0, shields: 0, energy: 45, note: '뒤처졌지만 최고속' },
      { pos: 0.5, shields: 1, energy: 2, note: '거의 출발선, 방어막만 있음' },
    ]

    const batch = chunkedWriter(s.db)
    const assigned = []

    // 가짜 반원은 명부에도 넣어야 이름이 뜬다.
    for (const f of fillers) {
      batch.set(s.base.collection('members').doc(f.uid), {
        uid: f.uid,
        name: f.name,
        role: 'member',
        simulated: true,
        joinedAt: iso(now),
      })
    }

    uids.forEach((uid, i) => {
      const sc = scenarios[i % scenarios.length]
      // 두 바퀴째부터는 조금씩 밀어서 겹치지 않게 한다.
      const lap = Math.floor(i / scenarios.length)
      const ship = {
        ...newShip(uid),
        routePosition: Math.max(0, sc.pos - lap * 0.7),
        shields: sc.shields,
        energy: sc.energy,
        updatedAt: iso(now),
      }
      batch.set(s.shipRef(uid), ship)
      assigned.push({ uid, name: names.get(uid), note: sc.note })
    })

    /* 최근 7일 공부 기록. 랭킹과 로그북이 비어 있으면 아무것도 확인할 수 없다.
     * 사람마다 총량이 다르게 나오도록 배수를 다르게 준다. */
    let logCount = 0
    uids.forEach((uid, i) => {
      const weight = [1.0, 0.85, 0.7, 0.45, 0.6, 0.3, 0.9, 0.5][i % 8]
      for (let d = 0; d < 7; d++) {
        // 요일마다 들쭉날쭉하게. 매일 같은 시간이면 그래프가 밋밋하다.
        const minutes = Math.round((40 + ((i * 37 + d * 53) % 160)) * weight)
        if (minutes < 15) continue
        const at = now - d * 86400e3 - ((i * 3 + 5) % 9) * 3600e3
        batch.set(s.col(COL.logs).doc(), {
          uid,
          nickname: names.get(uid) ?? '이름 없음',
          durationMinutes: minutes,
          content: SUBJECTS[(i + d) % SUBJECTS.length],
          memo: d === 0 && i === 0 ? '시뮬레이션으로 만든 기록입니다.' : null,
          studyDate: studyDayOf(new Date(at)),
          status: 'valid',
          editHistory: [],
          createdAt: iso(at),
        })
        logCount++
      }
    })

    /* 비행 중 미사일. 도착 시각을 다르게 줘서 항로맵에서 궤적이 서로 다른
     * 지점에 그려지게 한다. 하나는 곧 떨어져서 착탄 처리도 볼 수 있다. */
    const shots = [
      { from: 1, to: 0, type: 'missile_basic', inMin: 2 },
      { from: 0, to: 4, type: 'missile_nuke', inMin: 95 },
      { from: 2, to: 1, type: 'missile_basic', inMin: 150 },
      { from: 0, to: 5, type: 'missile_basic', inMin: 200 },
      { from: 4, to: 0, type: 'missile_nuke', inMin: 230 },
    ]
    let shotCount = 0
    for (const sh of shots) {
      if (sh.from >= uids.length || sh.to >= uids.length || sh.from === sh.to) continue
      const impact = now + sh.inMin * 60e3
      batch.set(s.col(COL.attacks).doc(), {
        attackerUid: uids[sh.from],
        targetUid: uids[sh.to],
        attackType: sh.type,
        energyCost: 10,
        stealth: !!sh.stealth,
        status: 'in_flight',
        damageDealt: 0,
        resolvedAt: null,
        createdAt: iso(now - 30 * 60e3),
        impactAt: iso(impact),
        fromPos: scenarios[sh.from % scenarios.length].pos,
        toPos: scenarios[sh.to % scenarios.length].pos,
      })
      shotCount++
    }

    /* 이미 끝난 공격 몇 개 — 피격 기록 화면이 비어 있지 않게. */
    for (const [fromI, type, ago, dmg, status] of [
      [1, 'emp', 12, 5, 'hit'],
      [3, 'missile_basic', 90, 20, 'hit'],
      [2, 'missile_basic', 200, 0, 'miss'],
    ]) {
      if (fromI >= uids.length) continue
      batch.set(s.col(COL.attacks).doc(), {
        attackerUid: uids[fromI],
        targetUid: me,
        attackType: type,
        energyCost: 10,
        stealth: false,
        status,
        damageDealt: dmg,
        resolvedAt: iso(now - ago * 60e3),
        createdAt: iso(now - (ago + 5) * 60e3),
        impactAt: iso(now - ago * 60e3),
        fromPos: 0,
        toPos: 0,
      })
    }

    /* 남이 공부하는 중이어야 항로맵에서 배가 실제로 기어가는 걸 볼 수 있다.
     * 나는 빼둔다 — 내 세션이 생기면 Orbit을 열자마자 공부 화면이 떠버린다. */
    const runner = uids[1]
    batch.set(s.sessionRef(runner), {
      uid: runner,
      sessionId: `sim_${now}`,
      startedAt: iso(now - 43 * 60e3),
      studyDate: studyDayOf(),
    })

    await batch.commit()

    res.json({
      ok: true,
      members: assigned.length,
      logs: logCount,
      missiles: shotCount,
      studying: names.get(runner) ?? runner,
      assigned,
      message:
        `함선 ${assigned.length}대, 공부 기록 ${logCount}건, 비행 중 미사일 ${shotCount}발을 만들었습니다. ` +
        `${names.get(runner) ?? ''} 님이 공부 중이라 항로맵에서 배가 움직입니다. ` +
        `2분 뒤에 나에게 미사일이 하나 떨어집니다.`,
    })
  })

  /** 게임 상태 전체 초기화. 기록·공격·세션을 지우고 배를 새것으로 되돌린다. */
  router.post('/reset', guard, async (req, res) => {
    /* 참가자 목록은 지우지 않는다 — 배 문서를 초기화할 뿐이다. 반원 명부는
     * Sevenly 것이지 Orbit 것이 아니다. */
    let deleted = 0
    for (const name of [COL.logs, COL.attacks, COL.sessions, COL.chat]) {
      // Firestore엔 "컬렉션 통째로 삭제"가 없다. 나눠서 지운다.
      for (;;) {
        const snap = await s.col(name).limit(400).get()
        if (snap.empty) break
        const batch = s.db.batch()
        snap.docs.forEach((d) => batch.delete(d.ref))
        await batch.commit()
        deleted += snap.size
        if (snap.size < 400) break
      }
    }

    /* 시뮬레이션이 만든 가짜 반원은 배도 명부도 통째로 지운다 — 초기화하고도
     * [시뮬] 이름이 명부에 남아 있으면 반원 관리 화면이 지저분해진다. */
    const ships = await s.allShips()
    const batch = s.db.batch()
    let removed = 0
    for (const ship of ships) {
      if (String(ship.uid).startsWith(SIM_PREFIX)) {
        batch.delete(s.shipRef(ship.uid))
        batch.delete(s.base.collection('members').doc(ship.uid))
        removed += 1
      } else {
        batch.set(s.shipRef(ship.uid), newShip(ship.uid))
      }
    }
    await batch.commit()

    const kept = ships.length - removed
    res.json({
      ok: true,
      ships: kept,
      deleted,
      removed,
      message:
        `문서 ${deleted}건을 지우고 함선 ${kept}대를 초기화했습니다.` +
        (removed ? ` 시뮬레이션 함선 ${removed}대는 명부에서 지웠습니다.` : ''),
    })
  })

  /** 참가 취소 — 이 사람 배만 없앤다. */
  router.delete('/member/:uid', guard, async (req, res) => {
    const { uid } = req.params
    await s.shipRef(uid).delete()
    await s
      .sessionRef(uid)
      .delete()
      .catch(() => {})
    res.json({ ok: true })
  })

  /** 수리에 필요한 시간. 화면에 숫자를 박지 않으려고 같이 내려준다. */
  router.get('/constants', guard, (req, res) => {
    res.json({ maxEnergy: MAX_ENERGY, maxShields: MAX_SHIELDS })
  })

  return router
}
