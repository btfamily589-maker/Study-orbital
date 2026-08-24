/* 공부 세션을 "지금까지" 정산하는 계산.
 *
 * 예전엔 세션이 끝날 때 한 번만 계산했다. 그런데 속도가 에너지 잔고에 걸리면서
 * 그 방식이 틀리게 됐다 — 공부하는 동안 잔고가 차오르니 속도도 같이 오르고,
 * 중간에 미사일을 맞으면 그 순간부터 느려져야 한다. 끝나고 한 번에 계산하면
 * 세션 전체가 마지막 잔고 하나로 매겨진다(맞았으면 맞기 전 시간까지 같이 손해).
 *
 * 그래서 "정산 시점"을 세션 문서에 남기고, 잔고가 바뀌는 사건마다 그 시점까지
 * 끊어서 정산한다 — 세션 종료, 피격, 방어막 구매. 각 구간은 잔고가 연속으로
 * 차오르는 구간이므로 distanceFor()가 정확히 적분한다.
 *
 * 순수 함수만 둔다. 트랜잭션 안에서 마음 놓고 부를 수 있어야 한다.
 */
import { clampEnergy, distanceFor, MINUTES_PER_ENERGY } from './engine.js'

/** 공부 시간(분) → 에너지. 10분에 1. */
export const energyFor = (minutes) => minutes / MINUTES_PER_ENERGY

/** 이 세션이 어디까지 정산됐나. 옛 세션 문서엔 settledAt이 없다 — 시작 시각으로 본다. */
export const settledAtOf = (session) => new Date(session?.settledAt ?? session?.startedAt ?? 0)

/**
 * 세션을 until 시점까지 정산한 결과. 아직 정산할 게 없으면 null.
 *
 * @param ship    지금 함선 상태(에너지·위치)
 * @param session 세션 문서
 * @param until   여기까지 정산한다(피격이면 착탄 시각, 종료면 종료 시각)
 */
export function settleUpTo(ship, session, until = new Date()) {
  if (!session?.startedAt) return null

  const from = settledAtOf(session)
  const minutes = (until.getTime() - from.getTime()) / 60000
  if (!(minutes > 0)) return null

  const energyGained = energyFor(minutes)
  const startEnergy = ship?.energy ?? 0
  const distance = distanceFor(startEnergy, energyGained)

  return {
    minutes,
    energyGained,
    distance,
    settledAt: until.toISOString(),
    patch: {
      // 잔고는 상한을 넘지 않지만, 거리는 번 만큼 다 쳐준다.
      energy: clampEnergy(startEnergy + energyGained),
      routePosition: (ship?.routePosition ?? 0) + distance,
      updatedAt: until.toISOString(),
    },
  }
}
