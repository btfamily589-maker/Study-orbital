/* 화면이 쓰는 게임 규칙. 서버(server/orbit/engine.js)와 같은 값·같은 식이다.
 *
 * 화면은 서버 응답을 그대로 그리기만 하면 좋겠지만, 공부 중에는 초 단위로
 * 늘어나는 걸 보여줘야 해서(20초마다 물어볼 수는 없다) 같은 계산을 여기서도
 * 한다. 두 곳의 숫자가 어긋나면 화면이 거짓말을 하게 되므로, 바꿀 땐 반드시
 * 양쪽을 같이 고친다.
 */

/** 에너지 상한 */
export const MAX_ENERGY = 60
/** 이 잔고 이상이면 최고속. 아래로는 비례해서 느려지고 0이면 멈춘다. */
export const FULL_SPEED_ENERGY = 30
/** 에너지 1당 항로 거리(최고속 기준). 6E × (1/6) = 1광년/시간 */
export const DIST_PER_ENERGY = 1 / 6
/* 방어막 세 종류(서버 engine.js와 같은 값).
 * 1차·2차는 겹으로 쌓이고, 반사막은 별개로 하나만 두른다. */
export const SHIELD_PRICE = 10
export const SHIELD2_PRICE = 15
export const REFLECT_PRICE = 20
export const MAX_SHIELDS = 2
export const MAX_REFLECT = 1

/** 겹을 한 장 더 두를 때 드는 값 */
export const shieldTierPrice = (have) => (have >= 1 ? SHIELD2_PRICE : SHIELD_PRICE)

/** 1 에너지를 버는 데 드는 공부 시간(분) */
export const MINUTES_PER_ENERGY = 10

/* 한 세션이 이보다 길면 무효다(서버 engine.js와 같은 값).
 * 정지를 안 누르고 잠든 것을 공부로 쳐주면, 오래 켜두는 쪽이 이기는 게임이 된다. */
export const MAX_SESSION_MINUTES = 5 * 60
/** 공부 시간(분) → 에너지. 10분에 1. */
export const energyFor = (minutes) => minutes / MINUTES_PER_ENERGY

/** 지금 속도(0~1) */
export const speedOf = (energy) => (energy > 0 ? Math.min(1, energy / FULL_SPEED_ENERGY) : 0)

/**
 * 잔고 startEnergy에서 gained만큼 벌면서 나아가는 거리.
 * 공부하는 동안 잔고가 차오르면 속도도 같이 오르므로 구간을 적분한다.
 */
export function distanceFor(startEnergy, gained) {
  const F = FULL_SPEED_ENERGY
  const a = Math.max(0, startEnergy)
  const b = a + Math.max(0, gained)
  const slowTop = Math.min(b, F)
  const slow = slowTop > a ? (slowTop * slowTop - a * a) / (2 * F) : 0
  const fast = b > F ? b - Math.max(a, F) : 0
  return (slow + fast) * DIST_PER_ENERGY
}

/** 상태 이름. 색과 문구가 여기서 갈린다. */
export function statusOf(energy) {
  if (energy >= FULL_SPEED_ENERGY) return 'normal'
  if (energy >= FULL_SPEED_ENERGY / 3) return 'unstable'
  return 'critical'
}

export const STATUS_TEXT = { normal: '최고속', unstable: '감속 중', critical: '거의 정지' }
