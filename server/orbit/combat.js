/* 전투 — 공격 발사, 착탄 처리, 방어막 수리, 안정성 수리.
 *
 * 원본(attacks.ts, ships.ts)에서 옮기면서 두 군데를 바꿨다.
 *
 * 1) 미사일 착탄을 setTimeout으로 예약하지 않는다.
 *    원본은 발사할 때 setTimeout(4시간)을 걸어뒀다. 그 사이 서버가 한 번이라도
 *    재시작하면(Railway는 배포할 때마다 재시작한다) 그 미사일은 영영 안 떨어진다.
 *    여기선 반대로 한다 — 예약하지 않고, 누군가 화면을 볼 때마다 "도착 시각이
 *    지난 미사일"을 찾아서 그 자리에서 처리한다(resolveDueAttacks).
 *    타이머가 없으니 재시작해도 잃어버릴 게 없다.
 *
 * 2) Sick Day 면역은 뺐다. Sick Day 기능 자체를 안 가져왔다.
 *
 * 동시성: 두 사람이 같은 사람을 동시에 때리면 나중 것이 앞의 피해를 덮어쓸 수
 * 있다. 그래서 배 문서를 건드리는 건 전부 runTransaction 안에서 한다.
 */
import { asyncRouter } from './async-router.js'
import {
  ATTACK_CONFIGS,
  ATTACK_DAMAGE,
  ATTACK_DESC,
  MAX_REFLECT,
  MAX_SHIELDS,
  REFLECT_PRICE,
  applyDamage,
  clampEnergy,
  isNoFlyZone,
  shieldCostFrom,
  shieldTierPrice,
  willLandInNoFlyZone,
} from './engine.js'
import { settleUpTo } from './progress.js'
import { COL, normalizeShip } from './store.js'
import { formatShip } from './format.js'

const isMissile = (type) => type.startsWith('missile_')

function damageText(r) {
  if (r.reflected) return '반사막이 되돌려 보냄'
  if (r.blocked) return '방어막이 막아냄'
  const parts = []
  if (r.pierced) parts.push('방어막 관통')
  if (r.energyLost > 0) parts.push(`에너지 -${Math.round(r.energyLost * 10) / 10}`)
  return parts.join(', ') || '피해 없음'
}

/** 도달까지 걸리는 시간 문구. "360분"보다 "6시간"이 읽기 쉽다. */
function etaText(min) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`
}

/**
 * 한 발을 대상 배에 적용한다. 트랜잭션 안에서 돌아간다.
 *
 * 방어막은 미사일만 막는다 — EMP는 막을 무시하고 에너지를 깎는다.
 * 막을 수 있는 공격이 막히면 방어막 한 장이 터지고 에너지는 그대로다.
 * 뉴클리어는 풀 방어(1차·2차+반사막)가 아닌 한 다 뚫고 에너지를 0으로 만든다(engine.js의 zero).
 */
function resolveHit(ship, attackType, { alreadyReflected = false } = {}) {
  const total = ATTACK_DAMAGE[attackType] ?? 5
  const config = ATTACK_CONFIGS[attackType]
  const r = applyDamage(
    { shields: ship.shields ?? 0, reflect: ship.reflect ?? 0, energy: ship.energy ?? 0 },
    total,
    {
      zero: !!config?.zero,
      blockable: isMissile(attackType),
      /* 되돌아온 것을 또 되돌리면 둘이 반사막을 갖고 있는 동안 미사일 하나가
       * 영영 오간다. 한 번 반사된 미사일은 그냥 도착한다. */
      reflectable: isMissile(attackType) && !alreadyReflected,
    },
  )

  return {
    miss: false,
    patch: {
      energy: r.newEnergy,
      shields: r.newShields,
      reflect: r.newReflect,
      updatedAt: new Date().toISOString(),
    },
    total,
    blocked: r.blocked,
    pierced: r.pierced,
    reflected: r.reflected,
    energyLost: r.energyLost,
    // 에너지가 바닥나면 사실상 멈춘 것이다. 따로 "고장" 상태를 두지 않는다.
    stopped: r.newEnergy <= 0,
  }
}
/**
 * 도착 시각이 지난 미사일을 찾아서 터뜨린다.
 *
 * 화면을 보는 요청마다 불린다(항로맵, 내 배, 공격 기록). 아무도 안 보면 안
 * 터지지만, 누가 보는 순간 밀린 것까지 한꺼번에 정리되므로 결과는 같다.
 *
 * 한 발을 두 요청이 동시에 처리하면 피해가 두 번 들어간다. 트랜잭션 안에서
 * status가 아직 in_flight인지 확인하고 바꾸는 것으로 한 번만 처리되게 한다.
 */
export async function resolveDueAttacks(store) {
  const s = store
  const now = Date.now()

  /* status만 걸고 impactAt은 메모리에서 거른다. 두 필드에 조건을 같이 걸면
   * Firestore가 복합 인덱스를 요구하는데, 날아다니는 미사일은 몇 개 안 된다. */
  const snap = await s.col(COL.attacks).where('status', '==', 'in_flight').get()
  const due = snap.docs.filter((d) => {
    const a = d.data()
    // 요격탄이 마주 오는 미사일은 만나는 시각(interceptAt)이 이 미사일의 끝이다.
    if (a.interceptAt) return new Date(a.interceptAt).getTime() <= now
    return new Date(a.impactAt).getTime() <= now
  })
  if (!due.length) return []

  const names = await s.memberNames()
  const messages = []

  for (const doc of due) {
    const a = doc.data()
    const config = ATTACK_CONFIGS[a.attackType]

    /* 요격탄과 만났다 — 배에 닿는 대신 하늘에서 터진다. 피해는 없다.
     * 표적 미사일은 격추됨으로, 요격탄 기록은 격추 성공으로 닫는다. */
    if (a.interceptedBy && a.interceptAt && new Date(a.interceptAt).getTime() <= now) {
      const done = await s.db.runTransaction(async (tx) => {
        const cur = await tx.get(doc.ref)
        if (!cur.exists || cur.data().status !== 'in_flight') return false
        const at = new Date().toISOString()
        tx.update(doc.ref, { status: 'shot_down', resolvedAt: at, damageDealt: 0 })
        if (a.interceptorAttackId) {
          tx.update(s.col(COL.attacks).doc(a.interceptorAttackId), {
            status: 'intercept_hit',
            resolvedAt: at,
          })
        }
        return true
      })
      if (!done) continue

      const label = config?.label ?? a.attackType
      const interceptorName = names.get(a.interceptedBy) ?? '?'
      messages.push(`🎯 ${interceptorName}, 날아오던 ${label} 요격!`)
      // 쏜 사람에게 알린다. 도착 시각만 기다리다 아무 일도 없으면 영문을 모른다.
      await s.notify(a.attackerUid, {
        title: '🎯 미사일 요격됨',
        body: `날아가던 ${label}이 ${interceptorName}의 요격탄에 요격되었습니다.`,
      })
      continue
    }

    const outcome = await s.db.runTransaction(async (tx) => {
      const [attackSnap, shipSnap, sessionSnap] = await Promise.all([
        tx.get(doc.ref),
        tx.get(s.shipRef(a.targetUid)),
        tx.get(s.sessionRef(a.targetUid)),
      ])
      // 다른 요청이 먼저 처리했으면 그냥 나간다.
      if (!attackSnap.exists || attackSnap.data().status !== 'in_flight') return null
      if (!shipSnap.exists) {
        tx.update(doc.ref, { status: 'miss', resolvedAt: new Date().toISOString(), damageDealt: 0 })
        return { miss: true, reason: '대상 없음' }
      }

      /* 공부 중인 사람을 때렸으면, 맞기 전까지의 진행부터 정산한다.
       * 안 그러면 맞기 전에 벌어둔 시간까지 깎인 에너지로 계산돼서 두 번 손해다. */
      let ship = normalizeShip(shipSnap.data())
      const impactAt = new Date(a.impactAt)
      const settled = sessionSnap.exists ? settleUpTo(ship, sessionSnap.data(), impactAt) : null
      if (settled) {
        ship = { ...ship, ...settled.patch }
        tx.update(s.sessionRef(a.targetUid), { settledAt: settled.settledAt })
      }

      const r = resolveHit(ship, a.attackType, { alreadyReflected: !!a.reflected })
      if (r.miss) {
        tx.update(doc.ref, { status: 'miss', resolvedAt: new Date().toISOString(), damageDealt: 0 })
        return r
      }

      /* 반사막이 받아냈으면 피해를 주는 대신 같은 미사일을 반대로 띄운다.
       * 날아가는 시간은 처음과 같아서, 기본 미사일이면 총 열두 시간이 된다.
       * 되돌아온 것은 받는 쪽이 보통 미사일처럼 막을 수 있다. */
      if (r.reflected) {
        const now = new Date()
        const eta = ATTACK_CONFIGS[a.attackType]?.etaMinutes ?? 360
        tx.update(s.shipRef(a.targetUid), {
          ...(settled ? settled.patch : {}),
          reflect: r.patch.reflect,
          updatedAt: now.toISOString(),
        })
        tx.update(doc.ref, {
          status: 'reflected',
          resolvedAt: now.toISOString(),
          damageDealt: 0,
        })
        tx.set(s.col(COL.attacks).doc(), {
          // 쏜 쪽과 맞는 쪽이 뒤바뀐다. 그게 반사다.
          attackerUid: a.targetUid,
          targetUid: a.attackerUid,
          attackType: a.attackType,
          energyCost: 0,
          // 되돌아오는 건 보인다 — 스텔스도 여기서 정체가 드러난다.
          stealth: false,
          status: 'in_flight',
          damageDealt: 0,
          resolvedAt: null,
          createdAt: now.toISOString(),
          impactAt: new Date(now.getTime() + eta * 60000).toISOString(),
          // 왔던 길을 그대로 되짚는다.
          fromPos: a.toPos ?? 0,
          toPos: a.fromPos ?? 0,
          // 되돌아온 표식. 이게 있으면 도착해도 다시 반사되지 않는다.
          reflected: true,
        })
        return r
      }

      tx.update(s.shipRef(a.targetUid), { ...(settled ? settled.patch : {}), ...r.patch })
      tx.update(doc.ref, {
        status: 'hit',
        resolvedAt: new Date().toISOString(),
        damageDealt: r.total,
      })
      return r
    })

    if (!outcome) continue

    const target = names.get(a.targetUid) ?? '?'
    const label = config?.label ?? a.attackType
    // 스텔스는 착탄해도 누가 쐈는지 안 알린다.
    if (outcome.miss) {
      messages.push(`${label} → ${target} · ${outcome.reason}!`)
    } else {
      messages.push(`${label} 착탄 → ${target} · ${damageText(outcome)}`)
      if (outcome.stopped) messages.push(`💥 ${target} 님의 에너지가 바닥났습니다.`)

      /* 맞은 사람에게 알린다. 미사일은 쏘고 몇 시간 뒤에 떨어지므로, 안 알려주면
       * 앱을 열어봤을 때 에너지만 줄어 있고 영문을 모른다. */
      const from = a.stealth ? '누군가' : (names.get(a.attackerUid) ?? '누군가')
      await s.notify(a.targetUid, {
        title: outcome.stopped ? '💥 에너지 고갈!' : '🚀 미사일 피격!',
        body: outcome.stopped
          ? `${from}의 ${label}에 맞아 에너지가 바닥났습니다. 공부해서 다시 채우세요.`
          : `${from}의 ${label} · ${damageText(outcome)}`,
      })

      /* 반사됐으면 같은 미사일이 쏜 사람에게 되돌아간다 — 새로 발사된 것과
       * 같으니 그쪽에도 발사 알림을 보낸다. */
      if (outcome.reflected) {
        await s.notify(a.attackerUid, {
          title: '🚀 미사일 발사됨!',
          body: `${target}의 반사막이 ${label}을(를) 되돌려 보냈습니다. ${etaText(config?.etaMinutes ?? 360)} 후 도달 — 요격하거나 방어를 준비하세요.`,
        })
      }
    }
  }

  for (const m of messages) await s.addSystemMessage(m, 'attack')
  return messages
}

export function createCombatRoutes({ store, requireMember, requireShip }) {
  const router = asyncRouter()
  const s = store

  /** 쏠 수 있는 무기 목록 + 비용/피해/도달시간. 화면에 숫자를 박지 않으려고. */
  router.get('/catalog', requireMember, (req, res) => {
    res.json(
      Object.entries(ATTACK_CONFIGS)
        .filter(([, c]) => !c.retired)
        .map(([type, c]) => ({
          type,
          label: c.label,
          energyCost: c.energyCost,
          damage: ATTACK_DAMAGE[type] ?? 5,
          etaMinutes: c.etaMinutes ?? 0,
          stealth: !!c.stealth,
          pierce: !!c.pierce,
          desc: ATTACK_DESC[type] ?? '',
        })),
    )
  })

  /** 발사. 미사일은 바로 안 맞고 etaMinutes 뒤에 떨어진다. EMP는 즉시.
   * targetAttackId를 주면 배가 아니라 나에게 날아오는 미사일을 겨눈다 — 요격이다. */
  router.post('/attack', requireMember, requireShip, async (req, res) => {
    const { targetUid, attackType, targetAttackId } = req.body || {}
    const me = req.orbit.uid

    if ((!targetUid && !targetAttackId) || !attackType)
      return res.status(400).json({ error: '대상과 무기를 골라주세요.' })
    if (targetUid === me) return res.status(400).json({ error: '자기 함선은 공격할 수 없습니다.' })

    const config = ATTACK_CONFIGS[attackType]
    if (!config || config.retired) return res.status(400).json({ error: '없는 무기입니다.' })

    const settings = await s.getSettings()
    if (isNoFlyZone(settings)) {
      return res.status(403).json({ error: '항해 금지 시간대입니다. 지금은 공격할 수 없습니다.' })
    }

    /* 요격 — 미사일로 미사일을 맞힌다.
     *
     * 요격탄은 마주 날아가 중간에서 만난다. 그래서 즉시가 아니라 "남은 시간의
     * 절반" 뒤에 격추된다 — 서로 마주 보고 날면 만나는 데 절반이 걸린다.
     * 아무 무기로나 되는 건 아니다 — 피해가 같거나 큰 무기여야 한다. 4E짜리
     * EMP로 Nuclear를 떨구게 두면 15E 주고 2차 방어막을 살 사람이 없다. */
    if (targetAttackId) {
      const now = new Date()
      const cost = config.energyCost
      const ref = s.col(COL.attacks).doc(String(targetAttackId))
      const interceptorRef = s.col(COL.attacks).doc()
      let out
      try {
        out = await s.db.runTransaction(async (tx) => {
          const [aSnap, mineSnap] = await Promise.all([tx.get(ref), tx.get(s.shipRef(me))])
          if (!aSnap.exists) throw new Error('그 미사일은 없습니다.')
          const a = aSnap.data()
          if (a.status !== 'in_flight') throw new Error('이미 끝난 미사일입니다.')
          if (a.targetUid !== me) throw new Error('나에게 오는 미사일만 요격할 수 있습니다.')
          // 스텔스는 맞는 쪽 눈에 안 보인다. 안 보이는 걸 겨눌 수는 없다.
          if (a.stealth) throw new Error('보이지 않는 미사일은 요격할 수 없습니다.')
          if (a.interceptedBy) throw new Error('이미 요격탄이 날아가고 있습니다.')
          const impactMs = new Date(a.impactAt).getTime()
          if (impactMs <= now.getTime()) throw new Error('이미 도착한 미사일입니다.')

          const incoming = ATTACK_DAMAGE[a.attackType] ?? 5
          if ((ATTACK_DAMAGE[attackType] ?? 5) < incoming)
            throw new Error(`피해 ${incoming} 이상인 무기로만 요격할 수 있습니다.`)

          const mine = normalizeShip(mineSnap.data())
          if ((mine.energy ?? 0) < cost) throw new Error('에너지가 부족합니다.')

          const interceptAt = new Date(now.getTime() + (impactMs - now.getTime()) / 2)

          tx.update(s.shipRef(me), {
            energy: clampEnergy((mine.energy ?? 0) - cost),
            updatedAt: now.toISOString(),
          })
          /* 표적 미사일에 "요격탄이 마주 오는 중"을 적는다. 목록·맵이 이 필드로
           * 요격 상황을 그린다. 착탄 처리는 resolveDueAttacks가 interceptAt을
           * 보고 한다 — 그 시각이 지나면 이 미사일은 떨어지는 대신 격추된다. */
          tx.update(ref, {
            interceptedBy: me,
            interceptorType: attackType,
            interceptorAttackId: interceptorRef.id,
            interceptStartAt: now.toISOString(),
            interceptAt: interceptAt.toISOString(),
          })
          /* 요격탄 자체도 발사 기록으로 남긴다. log 탭이 이걸 한 줄로 보여준다.
           * status를 in_flight로 두지 않는 건 착탄 루프가 배를 때리는 것으로
           * 오인하지 않게 하기 위해서다 — 요격탄의 결말은 표적 미사일이 정한다. */
          tx.set(interceptorRef, {
            attackerUid: me,
            targetAttackId: ref.id,
            targetMissileType: a.attackType,
            targetMissileFrom: a.attackerUid,
            attackType,
            energyCost: cost,
            stealth: false,
            status: 'intercepting',
            damageDealt: 0,
            resolvedAt: null,
            createdAt: now.toISOString(),
            impactAt: interceptAt.toISOString(),
          })
          return { attackerUid: a.attackerUid, type: a.attackType, interceptAt }
        })
      } catch (e) {
        return res.status(400).json({ error: e.message })
      }

      const label = ATTACK_CONFIGS[out.type]?.label ?? out.type
      const meName = req.orbit.nickname
      const etaMin = Math.max(1, Math.round((out.interceptAt.getTime() - now.getTime()) / 60000))
      await s.addSystemMessage(
        `🎯 ${meName}, 날아오는 ${label}에 요격탄 발사 (${config.label}, -${cost}E) · ${etaMin}분 후 요격`,
        'attack',
      )
      return res.json({
        ok: true,
        intercepted: true,
        interceptAt: out.interceptAt.toISOString(),
        message: `요격탄 발사! ${etaMin}분 후 요격합니다.`,
      })
    }

    /* 도착할 때가 수업시간이면 아예 못 쏜다. 안 그러면 수업 중에 알림이 울린다. */
    if (config.etaMinutes && willLandInNoFlyZone(settings, config.etaMinutes)) {
      return res
        .status(403)
        .json({ error: '미사일 도착 시각이 항해 금지 시간대입니다. 발사할 수 없습니다.' })
    }

    const now = new Date()
    const impactAt = new Date(now.getTime() + (config.etaMinutes ?? 0) * 60 * 1000)
    const cost = config.energyCost
    const attackRef = s.col(COL.attacks).doc()

    /* 에너지 차감과 (EMP면) 피해 적용을 한 트랜잭션에 묶는다. 연타해도 에너지가
     * 한 번만 빠지고, 잔액이 모자라면 아무 일도 안 일어난다. */
    let result
    try {
      result = await s.db.runTransaction(async (tx) => {
        const mineSnap = await tx.get(s.shipRef(me))
        const targetSnap = await tx.get(s.shipRef(targetUid))
        if (!targetSnap.exists) throw new Error('대상이 참가자가 아닙니다.')

        const mine = normalizeShip(mineSnap.data())
        const target = normalizeShip(targetSnap.data())

        if ((mine.energy ?? 0) < cost) throw new Error('에너지가 부족합니다.')

        tx.update(s.shipRef(me), {
          energy: clampEnergy((mine.energy ?? 0) - cost),
          updatedAt: now.toISOString(),
        })

        const base = {
          attackerUid: me,
          targetUid,
          attackType,
          energyCost: cost,
          stealth: !!config.stealth,
          createdAt: now.toISOString(),
          impactAt: impactAt.toISOString(),
          /* 발사 시점 좌표. 맵에서 미사일 궤적을 그릴 때 쓴다 — 쏜 사람이나
           * 맞는 사람이 순위에서 사라져도 선은 그려져야 한다. */
          fromPos: mine.routePosition ?? 0,
          toPos: target.routePosition ?? 0,
        }

        if (isMissile(attackType)) {
          tx.set(attackRef, { ...base, status: 'in_flight', damageDealt: 0, resolvedAt: null })
          return { inFlight: true }
        }

        // EMP는 즉발이라 여기서 바로 맞힌다.
        // EMP는 즉발이라 발사 시각이 곧 지금이다.
        const hit = resolveHit(target, attackType)
        if (hit.miss) {
          tx.set(attackRef, {
            ...base,
            status: 'miss',
            damageDealt: 0,
            resolvedAt: now.toISOString(),
          })
          return { inFlight: false, miss: true, reason: hit.reason }
        }
        tx.update(s.shipRef(targetUid), hit.patch)
        tx.set(attackRef, {
          ...base,
          status: 'hit',
          damageDealt: hit.total,
          resolvedAt: now.toISOString(),
        })
        return { inFlight: false, ...hit }
      })
    } catch (e) {
      return res.status(400).json({ error: e.message })
    }

    const names = await s.memberNames()
    const targetName = names.get(targetUid) ?? '?'
    const meName = req.orbit.nickname

    // 스텔스는 발사 사실을 알리지 않는다. 그게 스텔스다.
    if (result.inFlight) {
      if (!config.stealth) {
        await s.addSystemMessage(
          `🚀 ${config.label} 발사 (${meName} → ${targetName}) · ${config.etaMinutes}분 후 도달`,
          'attack',
        )
        /* 맞을 사람에게 쏘는 순간 알린다. 착탄 알림만 있으면 요격하거나
         * 방어막을 준비할 몇 시간을 모르는 채로 흘려보낸다. */
        await s.notify(targetUid, {
          title: '🚀 미사일 발사됨!',
          body: `${meName}이(가) 나에게 ${config.label}을(를) 발사했습니다. ${etaText(config.etaMinutes)} 후 도달 — 요격하거나 방어를 준비하세요.`,
        })
      }
      return res.json({
        ok: true,
        inFlight: true,
        stealth: !!config.stealth,
        impactAt: impactAt.toISOString(),
        message: `${config.label} 발사! ${config.etaMinutes}분 후 도달합니다.`,
      })
    }

    if (result.miss) {
      await s.addSystemMessage(`${config.label} → ${targetName} · ${result.reason}!`, 'attack')
      return res.json({ ok: true, inFlight: false, message: `${config.label} — ${result.reason}` })
    }

    await s.addSystemMessage(
      `⚡ ${config.label} (${meName} → ${targetName}) · ${damageText(result)}`,
      'attack',
    )
    if (result.stopped) {
      await s.addSystemMessage(`💥 ${targetName} 님의 에너지가 바닥났습니다.`, 'attack')
    }
    // EMP는 즉발이라 여기서 바로 알린다.
    await s.notify(targetUid, {
      title: result.stopped ? '💥 에너지 고갈!' : '⚡ EMP 피격!',
      body: result.stopped
        ? `${meName}의 ${config.label}에 맞아 에너지가 바닥났습니다. 공부해서 다시 채우세요.`
        : `${meName}의 ${config.label} · ${damageText(result)}`,
    })
    return res.json({
      ok: true,
      inFlight: false,
      message: `${config.label} 명중! ${damageText(result)}`,
    })
  })

  /* 방어막 구매.
   *
   * 세 종류다. 1차·2차는 겹으로 쌓이고(1차 없이 2차만 두를 수는 없다), 반사막은
   * 그 둘과 별개로 하나만 두른다. 사는 순간 에너지가 줄고, 에너지가 곧 속도이므로
   * 방어에는 속도를 내주는 대가가 따른다.
   *
   * kind: 'shield'(겹) | 'reflect'(반사막). 안 주면 예전처럼 겹으로 친다.
   * 공부 중이면 사기 전까지의 진행부터 정산한다. */
  router.post('/shield', requireMember, requireShip, async (req, res) => {
    const kind = req.body?.kind === 'reflect' ? 'reflect' : 'shield'
    const count = Math.floor(Number(req.body?.count ?? 1))
    if (!Number.isFinite(count) || count < 1) {
      return res.status(400).json({ error: '살 개수를 1 이상으로 골라주세요.' })
    }

    try {
      const out = await s.db.runTransaction(async (tx) => {
        const [snap, sessionSnap] = await Promise.all([
          tx.get(s.shipRef(req.orbit.uid)),
          tx.get(s.sessionRef(req.orbit.uid)),
        ])
        let ship = normalizeShip(snap.data())

        const now = new Date()
        const settled = sessionSnap.exists ? settleUpTo(ship, sessionSnap.data(), now) : null
        if (settled) {
          ship = { ...ship, ...settled.patch }
          tx.update(s.sessionRef(req.orbit.uid), { settledAt: settled.settledAt })
        }

        const have = kind === 'reflect' ? (ship.reflect ?? 0) : (ship.shields ?? 0)
        const max = kind === 'reflect' ? MAX_REFLECT : MAX_SHIELDS
        const room = max - have
        if (room <= 0) {
          throw new Error(
            kind === 'reflect' ? '반사막은 이미 두르고 있습니다.' : '방어막이 이미 꽉 찼습니다.',
          )
        }

        const buy = Math.min(count, room)
        const cost = kind === 'reflect' ? buy * REFLECT_PRICE : shieldCostFrom(have, buy)
        if ((ship.energy ?? 0) < cost) throw new Error(`에너지가 부족합니다. (${cost}E 필요)`)

        tx.update(s.shipRef(req.orbit.uid), {
          ...(settled ? settled.patch : {}),
          ...(kind === 'reflect' ? { reflect: have + buy } : { shields: have + buy }),
          energy: clampEnergy((ship.energy ?? 0) - cost),
          updatedAt: now.toISOString(),
        })
        return { bought: buy, cost, kind, level: have + buy }
      })

      const label = out.kind === 'reflect' ? '반사막' : out.level >= 2 ? '2차 방어막' : '1차 방어막'
      await s.addSystemMessage(`🛡 ${req.orbit.nickname} ${label} 구매 (-${out.cost}E)`)
      const ships = await s.allShips()
      const ship = ships.find((x) => x.uid === req.orbit.uid)
      res.json({ ...formatShip(ship, req.orbit.nickname, s.rankOf(ships, req.orbit.uid)), ...out })
    } catch (e) {
      res.status(400).json({ error: e.message })
    }
  })

  /* 지금 무엇을 얼마에 살 수 있는가. 값이 겹수에 따라 달라져서 화면이 혼자
   * 셈하면 어긋난다 — 서버가 한 벌로 내려준다. */
  router.get('/shields', requireMember, requireShip, async (req, res) => {
    const ship = normalizeShip((await s.shipRef(req.orbit.uid).get()).data())
    const shields = ship?.shields ?? 0
    const reflect = ship?.reflect ?? 0
    res.json({
      shields,
      maxShields: MAX_SHIELDS,
      reflect,
      maxReflect: MAX_REFLECT,
      /* 세 종류 전부 늘 내려보낸다. 가진 것도 목록에 떠야 "내가 뭘 두르고
       * 있고 뭘 더 살 수 있나"가 한 판에서 읽힌다 — available/owned가 갈라준다. */
      offers: [
        {
          kind: 'shield',
          level: 1,
          label: '1차 방어막',
          price: shieldTierPrice(0),
          available: shields < 1,
          owned: shields >= 1,
        },
        {
          kind: 'shield',
          level: 2,
          label: '2차 방어막',
          price: shieldTierPrice(1),
          available: shields === 1,
          owned: shields >= 2,
          unavailableReason: shields < 1 ? '1차 방어막이 있어야 살 수 있습니다.' : undefined,
        },
        {
          kind: 'reflect',
          level: 1,
          label: '반사막',
          price: REFLECT_PRICE,
          available: reflect < MAX_REFLECT,
          owned: reflect >= MAX_REFLECT,
          note: '닿은 미사일을 쏜 사람에게 되돌려 보냅니다. Nuclear는 반사하지 못하지만, 1차·2차 방어막과 함께 다 갖추면 막아냅니다.',
        },
      ],
    })
  })

  return router
}
