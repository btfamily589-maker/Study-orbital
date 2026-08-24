/* 공부 세션 → 에너지 → 전진. Study Orbital의 핵심 루프.
 *
 * 원본 study.ts(668줄)를 옮겼다. 옮기면서 바뀐 것:
 *
 * 1. 에너지 상한을 SQL `LEAST(energy + x, 50)`으로 처리하던 걸 트랜잭션 안의
 *    clampEnergy로 바꿨다. Firestore엔 원자적 산술이 increment()밖에 없는데
 *    그건 상한을 못 걸어서, 읽고-계산하고-쓰는 걸 트랜잭션으로 감싼다.
 *
 * 2. 로그 수정 이력(원본 study_log_edits 표)은 로그 문서 안 배열로 넣었다.
 *    로그 하나당 몇 개 안 되고, 항상 로그와 같이 읽힌다.
 *
 * 3. 로그 겹침 검사: 원본은 `startedAt < newEnd AND endedAt > logStart` 두 범위
 *    조건을 한 쿼리로 걸었는데, Firestore는 서로 다른 필드에 범위 조건을 두 개
 *    못 건다. 그날치 로그만 읽어와서 메모리에서 검사한다(하루 몇 개뿐이라 싸다).
 *
 * 4. route_progress 표는 안 옮겼다 — 이동 이력을 쌓기만 하고 아무도 안 읽는다.
 */
import { asyncRouter } from './async-router.js'
import { randomBytes } from 'node:crypto'
import { COL, normalizeShip } from './store.js'
import { formatShip, formatLog } from './format.js'
import {
  clampEnergy,
  distanceFor,
  isNoFlyZone,
  isOverlongSession,
  MAX_SESSION_MINUTES,
  studyDayOf,
} from './engine.js'
import { energyFor, settleUpTo } from './progress.js'

const fmtMin = (m) => `${Math.floor(m / 60)}시간 ${m % 60}분`

/* 어느 기기에서 온 요청인가. 클라이언트가 처음 켤 때 만들어 두고 계속 보내는
 * 값이다(lib/orbit.js). 없으면 빈 문자열 — 옛 클라이언트는 기기 구분 없이
 * 예전처럼 동작한다. 신원 확인용이 아니라 "같은 기기냐"만 보는 값이라 위조를
 * 걱정할 필요는 없다. 위조해 봐야 제 세션을 이어받을 뿐이다. */
const deviceOf = (req) => String(req.get('x-device-id') ?? req.body?.deviceId ?? '').slice(0, 64)

export function createStudyRoutes({ store, requireMember, requireShip }) {
  const router = asyncRouter()
  const s = store

  /* ---------------- 세션 ---------------- */

  /** 지금 진행 중인 세션. 앱을 껐다 켜도 타이머를 이어가려고 쓴다.
   *
   * mine이 false면 같은 계정의 다른 기기가 돌리고 있는 세션이다 — 이 기기에서
   * 정지·기록을 누르게 두면 안 된다(옆에서 공부 중인 걸 끊어버린다).
   * deviceId가 없는 옛 세션은 내 것으로 친다 — 이 기능이 생기기 전에 시작한
   * 사람이 갑자기 제 세션을 못 만지게 되면 안 된다. */
  router.get('/session/active', requireMember, requireShip, async (req, res) => {
    const snap = await s.sessionRef(req.orbit.uid).get()
    if (!snap.exists) return res.json({ sessionId: null, startedAt: null })
    const session = snap.data()

    /* 이미 무효가 된 세션은 여기서 치운다. 안 그러면 정지를 안 누른 사람의
     * 타이머가 며칠씩 돌아가고, 그동안 새 세션도 못 시작한다. */
    const openMinutes = (Date.now() - new Date(session.startedAt).getTime()) / 60000
    if (isOverlongSession(openMinutes)) {
      await s.sessionRef(req.orbit.uid).delete()
      return res.json({ sessionId: null, startedAt: null, voided: true })
    }

    res.json({
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      mine: !session.deviceId || session.deviceId === deviceOf(req),
    })
  })

  router.post('/session/start', requireMember, requireShip, async (req, res) => {
    const settings = await s.getSettings()
    if (isNoFlyZone(settings)) {
      return res.status(403).json({
        error: '항해 금지 시간대입니다(평일 수업시간). 이 시간엔 학습을 시작할 수 없습니다.',
      })
    }

    const ref = s.sessionRef(req.orbit.uid)
    const device = deviceOf(req)
    const takeover = !!req.body?.takeover

    /* 세션은 1인 1개다. 문서 ID가 uid라 애초에 두 개가 안 생긴다.
     *
     * 문제는 같은 계정으로 로그인한 다른 기기다. 예전엔 그쪽에서 시작을 누르면
     * 돌고 있던 세션에 말없이 올라탔다 — 폰에서 재우고 태블릿에서 시작하면
     * 태블릿 타이머가 이미 1시간 32분을 가리켰고, 거기서 정지를 누르면 폰에서
     * 하던 공부가 끝나 버렸다. 어느 기기 것인지 적어 두고, 남의 기기 세션이면
     * 거절한다.
     *
     * 그래도 길은 열어 둔다. 폰을 잃어버렸거나 앱을 지웠으면 영영 못 끝내게
     * 되므로, 이어받겠다고 하면(takeover) 주인만 바꾸고 시작 시각은 그대로 둔다
     * — 그때까지 한 공부는 살아 있어야 한다.
     *
     * deviceId가 없는 옛 세션은 지금 기기가 이어받는다. 이 기능이 생기기 전에
     * 시작한 사람이 제 세션에서 잠기면 안 된다. */
    const result = await s.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (snap.exists) {
        const cur = snap.data()
        /* 이미 무효가 된 세션은 이어받지 않는다 — 그걸 이어 시작하면 첫
         * 정지에서 곧바로 무효가 되어 그 뒤로 한 공부까지 같이 날아간다. */
        const openMinutes = (Date.now() - new Date(cur.startedAt).getTime()) / 60000
        if (isOverlongSession(openMinutes)) {
          tx.delete(ref)
          const startedAt = new Date().toISOString()
          const fresh = {
            uid: req.orbit.uid,
            sessionId: randomBytes(16).toString('hex'),
            startedAt,
            deviceId: device,
            settledAt: startedAt,
          }
          tx.set(ref, fresh)
          return { sessionId: fresh.sessionId, startedAt, resumed: false, mine: true, voided: true }
        }
        const mine = !cur.deviceId || cur.deviceId === device
        if (!mine && !takeover) return { conflict: true, startedAt: cur.startedAt }
        if (!mine || !cur.deviceId) tx.update(ref, { deviceId: device })
        return { sessionId: cur.sessionId, startedAt: cur.startedAt, resumed: true, mine: true }
      }
      const startedAt = new Date().toISOString()
      const session = {
        uid: req.orbit.uid,
        sessionId: randomBytes(16).toString('hex'),
        startedAt,
        deviceId: device,
        /* 어디까지 정산했는지. 공부하는 중에도 잔고가 차오르고, 맞으면 그때부터
         * 느려져야 하므로 구간을 끊어서 계산한다(progress.js). */
        settledAt: startedAt,
      }
      tx.set(ref, session)
      return { sessionId: session.sessionId, startedAt, resumed: false, mine: true }
    })

    if (result.conflict) {
      return res.status(409).json({
        error: '다른 기기에서 이미 공부 중입니다.',
        otherDevice: true,
        startedAt: result.startedAt,
      })
    }
    res.json(result)
  })

  router.post('/session/cancel', requireMember, requireShip, async (req, res) => {
    await s.sessionRef(req.orbit.uid).delete()
    res.json({ ok: true })
  })

  /* 세션 종료 — 여기가 실제로 점수가 움직이는 지점이다.
   *
   * 공부 시간은 클라이언트가 보낸 값을 그대로 믿지 않는다. 서버가 기록해둔
   * 세션 시작 시각으로 계산한 값과 비교해서 "더 큰 쪽"을 쓴다(원본과 같은 규칙).
   * 클라이언트가 시간을 부풀려도 서버 기록을 넘을 수 없다. */
  router.post('/session/end', requireMember, requireShip, async (req, res) => {
    const { sessionId, durationMinutes: clientMinutes, content, memo } = req.body ?? {}
    if (!sessionId || !clientMinutes) {
      return res.status(400).json({ error: 'sessionId와 durationMinutes가 필요합니다.' })
    }
    /* 무엇을 공부했는지는 안 받는다. 끝낼 때마다 적게 하면 귀찮아서 타이머를
     * 안 쓰게 된다 — 이 게임은 "얼마나 오래 했나"만 있으면 돌아간다. */
    const note = typeof content === 'string' && content.trim() ? content.trim() : null

    const uid = req.orbit.uid
    const sessionSnap = await s.sessionRef(uid).get()
    const session = sessionSnap.exists ? sessionSnap.data() : null

    // 세션 기록이 없으면(서버 재시작 등) 클라이언트 값으로 되돌아간다.
    const endedAt = new Date()
    const startedAt = session?.startedAt
      ? new Date(session.startedAt)
      : new Date(endedAt.getTime() - clientMinutes * 60000)

    const serverMinutes = Math.max(1, Math.floor((endedAt - startedAt) / 60000))
    const durationMinutes = Math.max(Number(clientMinutes), serverMinutes)

    /* 너무 긴 세션은 통째로 버린다. 정지를 안 누르고 잠든 것이지 그만큼 공부한
     * 게 아니다(engine.js의 MAX_SESSION_MINUTES). 세션만 지우고 로그도 에너지도
     * 남기지 않는다 — 화면이 왜 사라졌는지 알 수 있게 이유를 돌려준다. */
    if (isOverlongSession(durationMinutes)) {
      await s.sessionRef(uid).delete()
      await s.addSystemMessage(
        `📖 ${req.orbit.nickname} — ${fmtMin(durationMinutes)} 세션 무효 (${fmtMin(MAX_SESSION_MINUTES)} 초과)`,
        'study',
      )
      return res.status(422).json({
        voided: true,
        durationMinutes,
        maxMinutes: MAX_SESSION_MINUTES,
        error: `한 번에 ${fmtMin(MAX_SESSION_MINUTES)}이 넘는 공부는 기록되지 않습니다. 정지를 누르는 걸 잊으셨나요?`,
      })
    }

    const energyGained = energyFor(durationMinutes)
    /* 앉은 시각으로 어느 날인지 정한다. 새벽 2시에 시작해 6시에 끝냈다면 전날
     * 밤의 연장이라 전날 몫이다 — 끝난 시각으로 재면 그 네 시간이 통째로
     * 다음 날로 넘어간다. */
    const studyDate = studyDayOf(startedAt)

    const logsCol = s.col(COL.logs)

    /* 배 상태 변경과 로그 작성을 한 트랜잭션으로 묶는다. 중간에 실패하면 에너지만
     * 오르고 로그는 없는(또는 반대) 상태가 생기면 안 된다.
     * Firestore 트랜잭션은 읽기를 전부 먼저 하고 쓰기를 뒤에 몰아야 한다. */
    const outcome = await s.db.runTransaction(async (tx) => {
      const shipSnap = await tx.get(s.shipRef(uid))
      const ship = normalizeShip(shipSnap.data())

      /* 남은 구간을 정산한다. 중간에 미사일을 맞았으면 그 시점까지는 이미
       * 정산돼 있고(combat.js), 여기서는 그 뒤부터 끝까지만 센다. */
      const settled = session
        ? settleUpTo(ship, session, endedAt)
        : {
            energyGained,
            distance: 0,
            patch: {
              energy: clampEnergy((ship.energy ?? 0) + energyGained),
              routePosition: ship.routePosition ?? 0,
              updatedAt: endedAt.toISOString(),
            },
          }

      const next = { ...ship, ...(settled?.patch ?? {}) }
      next.updatedAt = endedAt.toISOString()

      // 로그는 세션 전체 시간으로 남긴다 — 중간 정산과 상관없이 "몇 분 했나"다.
      const logs = [makeLog(uid, studyDate, durationMinutes, note, memo, startedAt, endedAt)]

      tx.set(s.shipRef(uid), next)
      for (const log of logs) tx.set(logsCol.doc(), log)
      tx.delete(s.sessionRef(uid))

      return { ship: next, logs, distanceMoved: settled?.distance ?? 0 }
    })

    // 시스템 공지는 트랜잭션 밖에서. 실패해도 게임 상태엔 영향이 없어야 한다.
    await s.addSystemMessage(
      `📖 ${req.orbit.nickname} — 공부 세션 완료 (${fmtMin(durationMinutes)}, +${energyGained}E)`,
      'study',
    )

    const ships = await s.allShips()
    res.json({
      energyGained,
      distanceMoved: outcome.distanceMoved,
      shipState: formatShip(outcome.ship, req.orbit.nickname, s.rankOf(ships, uid)),
    })
  })

  /* ---------------- 로그 ---------------- */

  /* 로그 목록. uid를 주면 그 사람 것만, 없으면 전체(로그북 탭).
   *
   * uid로 거르는 걸 `where('uid').orderBy('createdAt')`로 하면 Firestore가 복합
   * 색인을 요구한다 — 콘솔에서 손으로 만들어야 하는 물건이라, 반 규모에선
   * 최근 것만 넉넉히 가져와 메모리에서 거른다. */
  router.get('/logs', requireMember, async (req, res) => {
    const limit = Math.min(500, parseInt(req.query.limit ?? '50', 10) || 50)
    const targetUid = req.query.uid

    const [snap, membersSnap] = await Promise.all([
      s
        .col(COL.logs)
        .orderBy('createdAt', 'desc')
        .limit(targetUid ? 500 : limit)
        .get(),
      s.base.collection('members').get(),
    ])
    const names = new Map(membersSnap.docs.map((d) => [d.id, d.data().name || '이름 없음']))

    let logs = snap.docs.map((d) =>
      formatLog({ id: d.id, ...d.data(), nickname: names.get(d.data().uid) ?? '이름 없음' }),
    )
    if (targetUid) logs = logs.filter((l) => l.uid === targetUid).slice(0, limit)

    res.json({ logs })
  })

  /** 직접 입력(타이머를 안 쓰고 나중에 적는 경우) */
  router.post('/logs', requireMember, requireShip, async (req, res) => {
    const { durationMinutes, content, memo } = req.body ?? {}
    const minutes = Number(durationMinutes)
    if (!minutes || minutes < 1) {
      return res.status(400).json({ error: 'durationMinutes는 1 이상이어야 합니다.' })
    }
    /* 타이머로 못 하는 걸 손으로 적어 넣게 두면 규칙이 없는 것과 같다. */
    if (isOverlongSession(minutes)) {
      return res.status(400).json({
        error: `한 번에 ${MAX_SESSION_MINUTES / 60}시간이 넘는 공부는 기록할 수 없습니다. 나눠서 적어주세요.`,
        maxMinutes: MAX_SESSION_MINUTES,
      })
    }

    const uid = req.orbit.uid
    const energyGained = energyFor(minutes)
    const endedAt = new Date()
    const startedAt = new Date(endedAt.getTime() - minutes * 60000)
    const logRef = s.col(COL.logs).doc()

    /* 직접 입력은 에너지만 주고 전진시키지 않는다(원본과 같다). 타이머로 잰
     * 세션만 항로를 나아가게 해서, 손으로 적어 넣는 걸로 순위를 올리지 못하게
     * 하려는 규칙으로 보인다. */
    const ship = await s.db.runTransaction(async (tx) => {
      const snap = await tx.get(s.shipRef(uid))
      const cur = snap.data()
      const next = {
        ...cur,
        energy: clampEnergy((cur.energy ?? 0) + energyGained),
        updatedAt: endedAt.toISOString(),
      }
      tx.set(s.shipRef(uid), next)
      tx.set(
        logRef,
        makeLog(
          uid,
          // 손으로 적어 넣는 것도 "앉은 시각" 기준이다(세션 종료와 같은 규칙).
          studyDayOf(startedAt),
          minutes,
          typeof content === 'string' && content.trim() ? content.trim() : null,
          memo,
          startedAt,
          endedAt,
        ),
      )
      return next
    })

    await s.addSystemMessage(
      `📖 ${req.orbit.nickname} — 공부 기록 추가 (${fmtMin(minutes)}, +${energyGained}E)`,
      'study',
    )

    const ships = await s.allShips()
    res.status(201).json({
      shipState: formatShip(ship, req.orbit.nickname, s.rankOf(ships, uid)),
    })
  })

  /* 로그 수정. 본인 것만, 그리고 줄이는 것만 된다.
   *
   * 시간을 바꾸면 에너지와 항로 위치를 그만큼 되돌려 다시 계산한다. 그래도
   * 늘리는 걸 열어두면 "1분으로 적어 두고 나중에 10시간으로 고치기"로 순위를
   * 만들 수 있어서, 아예 줄이는 쪽만 받는다 — 타이머 끄는 걸 잊었을 때 줄이는
   * 게 원래 쓸 일이다. 화면에서도 막지만 여기서 한 번 더 막는다: 화면만 막으면
   * 콘솔 한 줄로 우회된다.
   *
   * 수정 이력은 남겨서 나중에 누가 봐도 알 수 있게 한다. */
  router.patch('/logs/:id', requireMember, requireShip, async (req, res) => {
    const { durationMinutes, reason } = req.body ?? {}
    const minutes = Number(durationMinutes)
    if (!minutes || minutes < 1) {
      return res.status(400).json({ error: 'durationMinutes는 1 이상이어야 합니다.' })
    }
    // 고쳐 적는 것도 마찬가지다 — 30분으로 남긴 걸 여섯 시간으로 늘릴 수 없다.
    if (isOverlongSession(minutes)) {
      return res.status(400).json({
        error: `한 번에 ${MAX_SESSION_MINUTES / 60}시간이 넘는 공부는 기록할 수 없습니다. 나눠서 적어주세요.`,
        maxMinutes: MAX_SESSION_MINUTES,
      })
    }

    const uid = req.orbit.uid
    const logRef = s.col(COL.logs).doc(req.params.id)
    const logSnap = await logRef.get()
    if (!logSnap.exists) return res.status(404).json({ error: '없는 기록입니다.' })

    const log = logSnap.data()
    if (log.uid !== uid) return res.status(403).json({ error: '본인 기록만 수정할 수 있습니다.' })
    if (log.durationMinutes === minutes) return res.json(formatLog({ id: logSnap.id, ...log }))
    if (minutes > log.durationMinutes) {
      return res
        .status(400)
        .json({ error: '기록한 시간보다 늘릴 수는 없습니다. 줄이는 것만 됩니다.' })
    }
    if (!log.startedAt)
      return res.status(400).json({ error: '시작 시각이 없어 수정할 수 없습니다.' })

    /* 겹침 검사는 뺐다. 늘리는 걸 막은 뒤로는 구간이 줄기만 하므로, 원래
     * 안 겹쳤다면 줄여도 안 겹친다 — 매번 그날 로그를 통째로 읽던 조회 하나가
     * 통째로 없어진다. */
    const start = new Date(log.startedAt).getTime()
    const newEnd = start + minutes * 60000

    const oldMinutes = log.durationMinutes
    const energyDiff = energyFor(minutes) - (log.energyGained ?? 0)

    const outcome = await s.db.runTransaction(async (tx) => {
      const shipSnap = await tx.get(s.shipRef(uid))
      const ship = normalizeShip(shipSnap.data())

      /* 거리도 차액만큼 보정한다. 늘렸으면 지금 잔고에서 그만큼 더 번 셈으로,
       * 줄였으면 그만큼 덜 번 셈으로 친다. */
      const base = ship.energy ?? 0
      const distanceDiff =
        energyDiff >= 0
          ? distanceFor(base, energyDiff)
          : -distanceFor(Math.max(0, base + energyDiff), -energyDiff)

      const next = {
        ...ship,
        energy: clampEnergy(base + energyDiff),
        routePosition: Math.max(0, (ship.routePosition ?? 0) + distanceDiff),
        updatedAt: new Date().toISOString(),
      }

      const history = Array.isArray(log.editHistory) ? log.editHistory : []
      tx.set(s.shipRef(uid), next)
      tx.update(logRef, {
        durationMinutes: minutes,
        energyGained: energyFor(minutes),
        endedAt: new Date(newEnd).toISOString(),
        editedAt: new Date().toISOString(),
        editedFromMinutes: oldMinutes,
        editHistory: [
          ...history,
          {
            editNumber: history.length + 1,
            oldMinutes,
            newMinutes: minutes,
            energyDiff,
            reason: (reason || '').trim(),
            editedAt: new Date().toISOString(),
          },
        ],
      })

      return { ship: next, distanceDiff, editNumber: history.length + 1 }
    })

    const sign = (n) => (n >= 0 ? '+' : '')
    const reasonPart = (reason || '').trim() ? ` [사유: ${reason.trim()}]` : ''
    await s.addSystemMessage(
      `📝 ${req.orbit.nickname} — 기록 ${outcome.editNumber}차 수정: ${fmtMin(oldMinutes)} → ${fmtMin(minutes)} ` +
        `(에너지 ${sign(energyDiff)}${Math.round(energyDiff * 10) / 10}E, ` +
        `거리 ${sign(outcome.distanceDiff)}${Math.round(outcome.distanceDiff * 1000) / 1000})${reasonPart}`,
      'study',
    )

    const updated = await logRef.get()
    const ships = await s.allShips()
    res.json({
      log: formatLog({ id: updated.id, ...updated.data() }),
      shipState: formatShip(outcome.ship, req.orbit.nickname, s.rankOf(ships, uid)),
    })
  })

  return router
}

/** 로그 문서 한 벌. 필드 이름은 원본 study_logs 표를 그대로 따랐다. */
function makeLog(uid, studyDate, durationMinutes, content, memo, startedAt, endedAt) {
  return {
    uid,
    studyDate,
    durationMinutes,
    content,
    memo: memo || null,
    energyGained: durationMinutes / 10,
    status: 'valid',
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    createdAt: new Date().toISOString(),
    editHistory: [],
  }
}
