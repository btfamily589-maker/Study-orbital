/* 응답 모양 맞추기.
 *
 * 함선 상태는 여러 라우트가 돌려준다(참가, 조회, 공부 세션 종료…). 필드 이름이
 * 라우트마다 어긋나면 프론트가 조용히 깨지므로 여기 한 군데서만 만든다.
 *
 * 수치는 에너지 하나뿐이다. 안정성·방어막 내구도·고장 상태는 없앴다 —
 * 속도는 에너지 잔고에서 나오고, 방어막은 장수로 센다(engine.js).
 */
import { MAX_ENERGY, MAX_REFLECT, MAX_SHIELDS, getShipStatus, getSpeedFactor } from './engine.js'

export function formatShip(ship, nickname, rank) {
  const energy = Math.max(0, ship.energy ?? 0)

  return {
    uid: ship.uid,
    nickname,
    energyBalance: energy,
    maxEnergy: MAX_ENERGY,
    shields: ship.shields ?? 0,
    maxShields: MAX_SHIELDS,
    reflect: ship.reflect ?? 0,
    maxReflect: MAX_REFLECT,
    /** 지금 속도(0~1). 화면에선 %로 보여준다. */
    speed: getSpeedFactor(energy),
    status: getShipStatus(energy),
    routePosition: ship.routePosition ?? 0,
    currentRank: rank,
    updatedAt: ship.updatedAt,
  }
}

export function formatLog(log) {
  return { ...log }
}
