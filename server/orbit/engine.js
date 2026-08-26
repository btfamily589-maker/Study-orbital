/* Study Orbital 게임 규칙.
 *
 * 원본(Replit/Postgres)의 gameEngine.ts를 그대로 옮겼다. 숫자를 바꾸면 게임
 * 밸런스가 통째로 흔들리므로, 원본과 다른 값을 쓰고 싶으면 여기 한 군데만
 * 고친다 — 라우트 쪽에 숫자를 직접 박지 마라.
 *
 * 여기 있는 함수는 전부 순수 함수다(DB를 안 본다). 그래야 트랜잭션 안에서
 * 마음 놓고 부를 수 있다.
 */

/** 1 에너지를 버는 데 드는 공부 시간(분). 10분에 1, 즉 1시간 = 6E */
export const MINUTES_PER_ENERGY = 10
/* 에너지 1당 항로 거리. 최고속에서 6E × (1/6) = 1광년, 곧 1광년/시간이다.
 *
 * 이 둘은 짝이다. 버는 속도를 바꾸면 여기도 같이 봐야 화면의 ly/h가 계속
 * 참말을 한다 — 그 숫자는 speedOf(0~1)를 그대로 찍은 것이라 "최고속 한 시간이
 * 딱 1광년"일 때만 단위가 맞는다. */
export const DISTANCE_PER_ENERGY = 1 / 6
/** 에너지 상한 */
export const MAX_ENERGY = 60

/* 속도는 남은 에너지에 걸린다.
 *
 * 예전엔 "안정성"이라는 별도 수치가 엔진 효율을 정하고, 맞으면 그게 깎이고,
 * 에너지를 써서 도로 채우는 구조였다. 스탯이 둘이라 화면도 둘로 갈라지고,
 * "왜 느린지"가 한눈에 안 들어왔다. 이제 수치는 에너지 하나다 —
 * 잔고가 넉넉하면 최고속으로 가고, 바닥나면 기어간다.
 *
 * 잔고가 이 값 이상이면 100%. 그 아래로는 비례해서 느려지고, 0이면 멈춘다. */
export const FULL_SPEED_ENERGY = 50

/** 새 함선이 들고 시작하는 에너지. 0이면 첫날이 너무 답답하다.
 * 최고속 문턱(50)과는 별개다 — 시작부터 최고속이면 공부할 이유가 늦게 생긴다. */
export const START_ENERGY = 30

/* 방어막은 세 종류다. 셋을 다 두르면 40E — 여섯 시간 반쯤의 공부다.
 *
 * 1차·2차는 겹으로 쌓인다. 1차를 두른 뒤에만 2차를 덧댈 수 있고, 미사일 한 발에
 * 바깥 겹부터 한 겹씩 터진다.
 *
 * 반사막은 그 둘과 별개다. 1차가 없어도 살 수 있고, 미사일이 닿으면 막는 대신
 * 방향을 돌려 쏜 사람에게 되돌려 보낸다. */
export const SHIELD_PRICE = 10
export const SHIELD2_PRICE = 15
export const REFLECT_PRICE = 20
export const MAX_SHIELDS = 2
export const MAX_REFLECT = 1

/** 겹을 한 장 더 두를 때 드는 값. 지금 몇 겹인지에 따라 다르다. */
export const shieldTierPrice = (have) => (have >= 1 ? SHIELD2_PRICE : SHIELD_PRICE)

/** 지금 have겹에서 count겹을 더 두르는 데 드는 값. */
export function shieldCostFrom(have, count) {
  let cost = 0
  for (let i = 0; i < count; i++) cost += shieldTierPrice(have + i)
  return cost
}

/* 공격이 깎는 에너지. 방어막이 있으면 그 장이 대신 터지고 에너지는 안 깎인다.
 * 뉴클리어만 예외로 다 뚫는다(ATTACK_CONFIGS의 zero) — 여기 적힌 60은 실제
 * 깎는 양이 아니라 "최대 얼마까지"(= MAX_ENERGY)다. 화면의 피해 표시와 요격
 * 문턱(피해가 같거나 큰 무기)이 이 값을 쓴다. */
export const ATTACK_DAMAGE = {
  emp: 2,
  missile_basic: 15,
  missile_stealth: 15,
  missile_nuke: 60,
  /* 무기 목록에서 뺀 것들. 값을 남겨두는 이유는 아래 retired 주석 참고. */
  missile_fast: 7,
  missile_heavy: 12,
}

/* 공격 종류별 비용·도달시간. etaMinutes가 없으면 즉시 적중(EMP).
 *
 * retired는 "더 못 쏘지만 이미 날아가는 건 떨어져야 하는" 무기다. 목록에서 빼도
 * 하늘에 떠 있는 미사일은 남아 있어서, 설정을 지워버리면 착탄할 때 이름도
 * 피해량도 못 찾는다. */
export const ATTACK_CONFIGS = {
  emp: { energyCost: 4, windowMinutes: 30, label: 'EMP' },
  missile_basic: { energyCost: 6, windowMinutes: 30, label: 'Missile', etaMinutes: 360 },
  missile_stealth: {
    energyCost: 10,
    windowMinutes: 30,
    label: 'Stealth',
    etaMinutes: 360,
    stealth: true,
    retired: true,
  },
  /* 뉴클리어는 아무것도 못 막는다(zero). 방어막도 반사막도 전부 부수고
   * 에너지를 통째로 0으로 만든다 — 값이 50E나 하는 물건이 "막히면 끝"이어선
   * 곤란하다. pierce는 화면이 설명 글씨를 빨갛게 칠하는 표식으로만 남았다. */
  missile_nuke: {
    energyCost: 50,
    windowMinutes: 30,
    label: 'Nuclear',
    etaMinutes: 360,
    pierce: true,
    zero: true,
  },
  missile_fast: { energyCost: 10, windowMinutes: 30, label: 'Fast', etaMinutes: 60, retired: true },
  missile_heavy: {
    energyCost: 10,
    windowMinutes: 30,
    label: 'Heavy',
    etaMinutes: 360,
    retired: true,
  },
}

/* 무기 설명.
 *
 * 값·피해·도달시간은 어차피 카드에 숫자로 적힌다. 설명이 필요한 건 숫자로
 * 안 드러나는 두 가지뿐이다 — 안 보인다는 것, 못 막는다는 것. */
export const ATTACK_DESC = {
  emp: '방어막을 무시합니다.',
  missile_stealth: '도착할 때까지 상대에게 안 보입니다.',
  missile_nuke:
    'Nuclear는 방어막과 반사막을 전부 부수고 상대 에너지를 0으로 만듭니다. 1차·2차 방어막과 반사막을 모두 갖춘 경우에만 막을 수 있습니다.',
}

/* 노플라이존(수업시간)에서 빼주는 공휴일. MM-DD는 매년, YYYY-MM-DD는 그 해만. */
const KOREAN_HOLIDAYS = new Set([
  '01-01',
  '03-01',
  '05-05',
  '06-06',
  '08-15',
  '10-03',
  '10-09',
  '12-25',
  '2026-01-28',
  '2026-01-29',
  '2026-01-30',
  '2026-05-24',
  '2026-09-24',
  '2026-09-25',
  '2026-09-26',
  '2026-05-01',
])

/** UTC 시각을 한국시간 기준으로 옮긴 Date. getUTC*로 읽으면 한국 시각이 나온다. */
export function toKst(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
}

function isKoreanHoliday(kst) {
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(kst.getUTCDate()).padStart(2, '0')
  const yyyy = kst.getUTCFullYear()
  return KOREAN_HOLIDAYS.has(`${mm}-${dd}`) || KOREAN_HOLIDAYS.has(`${yyyy}-${mm}-${dd}`)
}

/** HH:MM 구간 판정. start > end면 자정을 걸치는 밤 구간(예: 22:00~07:00)이다. */
function inTimeWindow(start, end, kst) {
  const hh = String(kst.getUTCHours()).padStart(2, '0')
  const mm = String(kst.getUTCMinutes()).padStart(2, '0')
  const now = `${hh}:${mm}`
  return start <= end ? now >= start && now < end : now >= start || now < end
}

/** 수업시간엔 항해 금지. settings는 orbitSettings/config 문서 내용. */
export function isNoFlyZone(settings, date) {
  if (!settings?.nfzEnabled) return false

  const kst = toKst(date || new Date())
  const day = kst.getUTCDay()
  if (day === 0 || day === 6) return false // 주말
  if (isKoreanHoliday(kst)) return false

  return inTimeWindow(settings.nfzStart, settings.nfzEnd, kst)
}

/** 미사일이 도착할 시점이 노플라이존인지 */
export function willLandInNoFlyZone(settings, etaMinutes) {
  return isNoFlyZone(settings, new Date(Date.now() + etaMinutes * 60 * 1000))
}

/** 공격 금지 시간대 — 항해 금지와 달리 요일·공휴일을 가리지 않고 매일
 * 적용되고, 자정을 걸칠 수 있다. 잠자는 시간에 미사일 알림이 울리지 않게
 * 만든 개념이라 밤 구간(예: 22:00~07:00)이 기본 꼴이다. */
export function isNoAttackZone(settings, date) {
  if (!settings?.nazEnabled) return false
  return inTimeWindow(settings.nazStart, settings.nazEnd, toKst(date || new Date()))
}

/** 미사일이 도착할 시점이 공격 금지 시간대인지 */
export function willLandInNoAttackZone(settings, etaMinutes) {
  return isNoAttackZone(settings, new Date(Date.now() + etaMinutes * 60 * 1000))
}

/* 상태 이름. 에너지가 얼마나 남았느냐로만 정한다.
 *   normal    최고속으로 간다
 *   unstable  눈에 띄게 느리다
 *   critical  거의 멈춰 있다 */
export function getShipStatus(energy) {
  if (energy >= FULL_SPEED_ENERGY) return 'normal'
  if (energy >= FULL_SPEED_ENERGY / 3) return 'unstable'
  return 'critical'
}

/** 지금 속도(0~1). 잔고가 FULL_SPEED_ENERGY 이상이면 1, 0이면 0. */
export function getSpeedFactor(energy) {
  if (!(energy > 0)) return 0
  return Math.min(1, energy / FULL_SPEED_ENERGY)
}

/**
 * 잔고가 startEnergy일 때 gainedEnergy만큼 벌면서 나아가는 거리.
 *
 * 공부하는 동안 잔고가 계속 차오르므로 속도도 같이 오른다. 그래서 "번 에너지 ×
 * 속도"로 한 번에 곱하면 안 되고, 잔고 구간을 따라 적분해야 한다 —
 * 0에서 시작한 사람이 3E를 벌면 내내 최고속인 사람의 20분의 1만 간다.
 *
 *   거리 = ∫ min(1, E/F) dE × (거리/에너지)
 */
export function distanceFor(startEnergy, gainedEnergy) {
  const F = FULL_SPEED_ENERGY
  const a = Math.max(0, startEnergy)
  const b = a + Math.max(0, gainedEnergy)
  // 느린 구간(0~F)은 삼각형, 최고속 구간(F 위)은 직사각형.
  const slowTop = Math.min(b, F)
  const slow = slowTop > a ? (slowTop * slowTop - a * a) / (2 * F) : 0
  const fast = b > F ? b - Math.max(a, F) : 0
  return (slow + fast) * DISTANCE_PER_ENERGY
}

/* 피격. 한 발이 배에 닿았을 때 무엇이 어떻게 되는가.
 *
 * 아래 순서가 곧 규칙이다. 위에서 걸리면 아래는 안 본다.
 *
 *  1) 뉴클리어 풀 방어(1차·2차 방어막 + 반사막)를 다 갖춘 배만 받아낸다 —
 *             세 장이 한꺼번에 터지고 에너지는 지킨다. 하나라도 빠지면
 *             전부 부서지고 에너지까지 통째로 0이 된다.
 *  2) 반사막  미사일이면 막는 대신 방향을 돌려보낸다. 방어막·에너지는 그대로.
 *  3) EMP     방어막이 상관하지 않는다. 막이 있든 없든 에너지를 깎는다 —
 *             미사일 막으라고 두른 물건이 즉발 전자 공격까지 받아주면, 한 장
 *             사두는 것만으로 모든 공격이 무의미해진다.
 *  4) 미사일  바깥 겹 하나가 대신 터지고 에너지는 그대로다.
 *
 * 에너지는 0 아래로 안 내려간다.
 *
 * @param opts.zero        다 뚫고 에너지를 0으로 만드는가 (뉴클리어)
 * @param opts.blockable   방어막이 막을 수 있는 공격인가 (미사일이면 true)
 * @param opts.reflectable 반사막이 되돌릴 수 있는가 (이미 반사된 것은 false)
 */
export function applyDamage(
  { shields = 0, reflect = 0, energy = 0 },
  damage,
  { zero = false, blockable = true, reflectable = false } = {},
) {
  const hit = (over) => ({
    newShields: 0,
    newReflect: reflect,
    newEnergy: Math.max(0, energy - damage),
    blocked: false,
    pierced: false,
    reflected: false,
    shieldsLost: 0,
    energyLost: Math.min(Math.max(0, energy), damage),
    ...over,
  })
  const keep = (over) => hit({ newShields: shields, newEnergy: energy, energyLost: 0, ...over })

  /* 1) 뉴클리어가 제일 먼저다. 아래 어떤 규칙도 이걸 가로챌 수 없어야 한다.
   *    풀 방어 — 1차·2차 방어막과 반사막을 다 갖춘 배만 받아낸다. 세 장이
   *    한꺼번에 터지고 에너지는 지킨다. 하나라도 빠지면 두른 것 전부가
   *    부서지고 에너지까지 0이 된다. */
  if (zero) {
    if (shields >= MAX_SHIELDS && reflect >= MAX_REFLECT) {
      return keep({ newShields: 0, newReflect: 0, blocked: true, shieldsLost: shields })
    }
    return hit({
      newShields: 0,
      newReflect: 0,
      newEnergy: 0,
      pierced: shields > 0 || reflect > 0,
      shieldsLost: shields,
      energyLost: Math.max(0, energy),
    })
  }

  /* 2) 반사막. 막는 게 아니라 되돌려 보내는 것이라, 방어막도
   *    에너지도 건드리지 않는다. 반사막 한 장이 사라질 뿐이다. */
  if (reflectable && reflect > 0) {
    return keep({ newReflect: reflect - 1, reflected: true })
  }

  // 3) 방어막이 상관하지 않는 공격(EMP). 막은 그대로 남는다.
  if (!blockable) return hit({ newShields: shields, shieldsLost: 0 })

  // 4) 그 밖의 미사일. 바깥 겹 하나가 대신 터진다.
  if (shields > 0) return keep({ newShields: shields - 1, blocked: true, shieldsLost: 1 })

  return hit({})
}

/** 방어막 n겹 값. 아무것도 없는 상태에서 셈한다. */
export const shieldPrice = (n) => shieldCostFrom(0, n)

/* 한 세션이 이보다 길면 무효다.
 *
 * 다섯 시간. 실제로 다섯 시간을 내리 앉아 있는 일은 거의 없고, 이만큼 넘어간
 * 세션은 대개 정지를 안 누르고 잠들었거나 앱을 덮어둔 것이다. 그런 걸 그대로
 * 인정하면 하루 종일 켜두는 쪽이 제일 앞서 나가게 된다 — 공부한 만큼 가는
 * 게임이 아니라 앱을 오래 켜둔 만큼 가는 게임이 된다.
 *
 * 자르지 않고 통째로 버린다. 다섯 시간까지만 인정해 주면 "일단 켜두면 최소
 * 다섯 시간"이 되어 오히려 켜두는 걸 부추긴다. */
export const MAX_SESSION_MINUTES = 5 * 60

/** 이 세션은 무효인가. */
export const isOverlongSession = (minutes) => Number(minutes) > MAX_SESSION_MINUTES

export const clampEnergy = (n) => Math.max(0, Math.min(MAX_ENERGY, n))

/* 하루의 경계는 자정이 아니라 새벽 5시다 — 새벽 2시에 한 공부는 전날 몫으로
 * 친다. 랭킹·로그 묶기가 전부 이 기준을 쓴다.
 *
 * 넣을 날은 세션이 "끝난" 시각이 아니라 "시작한" 시각으로 정한다(부르는 쪽 참고).
 * 새벽 2시에 앉아 6시까지 했다면 그건 전날 밤의 연장이지 새 날의 공부가 아닌데,
 * 끝난 시각으로 재면 그 네 시간이 통째로 다음 날 몫으로 넘어간다. */
export function studyDayOf(date = new Date()) {
  const kst = toKst(date)
  if (kst.getUTCHours() < 5) kst.setUTCDate(kst.getUTCDate() - 1)
  return kst.toISOString().slice(0, 10)
}
