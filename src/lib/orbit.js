/* Orbit API 클라이언트.
 *
 * 다른 API(api.js)와 달리 매 요청에 Firebase ID 토큰을 실어 보낸다. 서버가 이걸
 * 검증해서 누구인지 판단한다 — Orbit엔 별도 로그인이 없고, Sevenly에 로그인돼
 * 있으면 그게 곧 Orbit 계정이다.
 */
import { auth, hasFirebase } from './firebase'

/* 토큰은 1시간이면 만료된다. getIdToken()이 알아서 갱신해주므로 우리가 캐시하지
 * 않는다 — 캐시했다가 만료된 걸 계속 보내면 401만 반복된다. */
async function idToken() {
  if (!hasFirebase || !auth?.currentUser) return null
  return auth.currentUser.getIdToken()
}

/* 이 기기의 딱지.
 *
 * 같은 계정으로 폰과 태블릿에 로그인해 두면 세션이 어느 쪽 것인지 서버가 알
 * 방법이 없다. 처음 켤 때 아무 값이나 하나 만들어 두고 계속 같이 보낸다.
 * 신원 확인용이 아니라 "아까 그 기기냐"만 보는 값이다 — 지워지면 새 기기로
 * 보일 뿐이고, 그때는 이어받기로 되찾으면 된다. */
const DEVICE_KEY = 'orbital:device'

export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    // 사생활 보호 모드 등으로 저장이 막히면 기기 구분을 포기한다(예전처럼 동작).
    return ''
  }
}

/* 읽기 요청에만 시간 제한을 건다.
 *
 * 서버가 답을 안 주면 fetch는 영원히 기다린다 — 화면엔 "Loading..."만 계속 떠
 * 있고 고장인지 느린 건지 알 수가 없다. 20초면 충분히 기다린 것이니 끊고 다시
 * 시도할 기회를 준다.
 *
 * 쓰기(POST)에는 안 건다. 서버가 이미 처리한 걸 끊어봐야 화면만 실패로 보이고,
 * 다시 누르면 같은 기록이 두 번 남을 수 있다. */
const READ_TIMEOUT_MS = 20000

/* 서버가 재시작하는 그 몇 초 사이에 들어간 요청은 게이트웨이에서 502·503으로
 * 튕긴다. 진짜 고장이 아니라 타이밍 문제라, 읽기라면 잠깐 쉬었다 한 번 더
 * 두드려본다 — "되다말다"의 절반은 이걸로 조용히 넘어간다. */
const transient = (e) => !!e?.transient

async function callOnce(path, { method = 'GET', body } = {}) {
  const token = await idToken()
  if (!token) throw new Error('로그인이 필요합니다.')

  let res
  try {
    res = await fetch(`/api/orbit${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Device-Id': deviceId(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(method === 'GET' && AbortSignal.timeout
        ? { signal: AbortSignal.timeout(READ_TIMEOUT_MS) }
        : {}),
    })
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw Object.assign(new Error('서버가 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.'), {
        transient: true,
      })
    }
    throw Object.assign(new Error('서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.'), {
      transient: true,
    })
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // 502·504는 우리 서버가 아니라 그 앞의 게이트웨이가 낸 소리다 — 대부분
    // 서버가 재시작하는 중이라는 뜻이라, 문구도 그렇게 말해준다.
    const gateway = [502, 503, 504].includes(res.status)
    // notJoined는 에러가 아니라 "아직 참가 안 함" 상태라 화면에서 갈라 써야 한다.
    throw Object.assign(
      new Error(
        data.error ||
          (gateway
            ? '서버가 재시작 중입니다. 잠시 뒤 다시 시도해 주세요.'
            : '요청에 실패했습니다.'),
      ),
      {
        status: res.status,
        transient: gateway,
        notJoined: !!data.notJoined,
        // 다른 기기가 이미 공부 중 — 에러가 아니라 "이어받을래?"를 물을 상황이다.
        otherDevice: !!data.otherDevice,
        startedAt: data.startedAt,
        /* 너무 길어서 무효가 된 세션. 서버가 이미 지웠으므로 화면도 세션을
         * 놓아주고 안내만 띄우면 된다 — 붙잡고 있으면 정지가 계속 실패한다. */
        voided: !!data.voided,
      },
    )
  }
  return data
}

async function call(path, opts = {}) {
  try {
    return await callOnce(path, opts)
  } catch (e) {
    // 읽기만 한 번 더. 쓰기를 자동으로 다시 보내면 기록·공격이 두 번 나간다.
    if ((opts.method ?? 'GET') !== 'GET' || !transient(e)) throw e
    await new Promise((r) => setTimeout(r, 1500))
    return callOnce(path, opts)
  }
}

/* 첫 화면에 필요한 것 전부를 한 번에.
 *
 * 예전엔 status를 먼저 받고, 그게 끝나야 배·함대·세션·랭킹·미사일 다섯을 따로
 * 불렀다. 요청 여섯 번에 왕복이 두 겹이라 그만큼 느렸다. 지금은 서버가 한 번
 * 읽어 다 조립해 준다. */
export const bootOrbit = (today) => call(`/boot?today=${encodeURIComponent(today ?? '')}`)

/** 참가 여부·항해 금지 시간만. 홈 화면의 "공부하기" 버튼이 쓴다. */
export const getOrbitStatus = () => call('/status')

/** 참가하기 (이미 참가했으면 그대로 현재 배 상태를 준다) */
export const joinOrbit = () => call('/join', { method: 'POST' })

/** 내 배 상태 */
export const getMyShip = () => call('/ship')

/** 참가자 전원 (항로 순위대로) */
export const getFleet = () => call('/fleet')

/* ---------------- 공부 세션 ----------------
 * 타이머는 화면에서 돌지만 시간 계산의 최종 판단은 서버가 한다. 세션 시작 시각을
 * 서버가 기억해뒀다가, 끝낼 때 클라이언트가 보낸 값과 비교해 더 큰 쪽을 쓴다. */

/** 진행 중인 세션 (앱을 껐다 켜도 타이머를 이어가려고 확인) */
export const getActiveSession = () => call('/study/session/active')

/** 세션 시작. 항해 금지 시간대면 403. */
/** 세션 시작. takeover면 다른 기기가 돌리던 세션을 이 기기로 넘겨받는다. */
export const startSession = (takeover = false) =>
  call('/study/session/start', { method: 'POST', body: { takeover } })

/** 세션 취소 (기록을 남기지 않고 버린다) */
export const cancelSession = () => call('/study/session/cancel', { method: 'POST' })

/* 세션 종료 → 기록 저장 + 에너지 획득 + 전진.
 * 무엇을 공부했는지는 안 받는다 — 끝낼 때마다 적게 하면 귀찮아서 타이머를
 * 안 쓰게 된다. 이 게임은 "얼마나 오래 했나"만 있으면 돌아간다. */
export const endSession = ({ sessionId, durationMinutes }) =>
  call('/study/session/end', {
    method: 'POST',
    body: { sessionId, durationMinutes },
  })

/* ---------------- 공부 기록 ---------------- */

/** 기록 목록. uid를 주면 그 사람 것만. */
export const getLogs = ({ uid, limit } = {}) => {
  const q = new URLSearchParams()
  if (uid) q.set('uid', uid)
  if (limit) q.set('limit', String(limit))
  const qs = q.toString()
  return call(`/study/logs${qs ? `?${qs}` : ''}`)
}

/** 타이머 없이 직접 입력. 시간만 적는다. */
export const addLog = ({ durationMinutes }) =>
  call('/study/logs', { method: 'POST', body: { durationMinutes } })

/** 기록 시간 수정 (본인 것만). 에너지·항로 위치가 차액만큼 다시 계산된다. */
export const editLog = (id, { durationMinutes, reason }) =>
  call(`/study/logs/${id}`, { method: 'PATCH', body: { durationMinutes, reason } })

/* ---------------- 항로맵 · 랭킹 ---------------- */

/** 함대 전체 + 순위. 공부 중인 사람은 위치가 실시간으로 앞서 나간다. */
export const getLeaderboard = () => call('/route/leaderboard')

/** 오늘·이번주 공부 시간 순위. today는 새벽 5시 기준 오늘 날짜(YYYY-MM-DD). */
export const getStudyRanking = (today) =>
  call(`/route/study-ranking${today ? `?today=${today}` : ''}`)

/** 지금 날아다니는 미사일. 스텔스는 쏜 본인에게만 보인다. */
export const getMissiles = () => call('/route/missiles')

/* ---------------- 전투 ----------------
 * 미사일은 쏘는 즉시 맞지 않는다. 도착 시각이 지나야 터지고, 그 처리는 누군가
 * 항로맵이나 피격 기록을 열어볼 때 서버가 한꺼번에 한다. */

/** 무기 목록 (비용·피해·도달시간). 화면에 숫자를 박지 않으려고 서버에서 받는다. */
export const getWeapons = () => call('/combat/catalog')

/** 발사. targetAttackId를 주면 나에게 날아오는 그 미사일을 겨눈다(요격). */
export const fireAttack = ({ targetUid, attackType, targetAttackId }) =>
  call('/combat/attack', { method: 'POST', body: { targetUid, attackType, targetAttackId } })

/** 방어막 구매. 한 장이 미사일 한 발을 통째로 막는다(뉴클리어 제외). */
export const buyShield = ({ kind = 'shield', count = 1 } = {}) =>
  call('/combat/shield', { method: 'POST', body: { kind, count } })

/** 지금 무엇을 얼마에 살 수 있는가. 값이 겹수에 따라 달라져서 서버가 셈한다. */
export const getShieldOffers = () => call('/combat/shields')

/** 지금까지 발사된 것 전부(OPER의 log 탭). */
export const getAttackLog = (limit = 120) => call(`/route/attacks?limit=${limit}`)

/* ---------------- 운영자 ----------------
 * 전부 Sevenly 명부의 role이 admin인 사람만 부를 수 있다. 서버가 판정한다. */

/** 항해 금지 시간대 설정 (읽기는 참가자 누구나) */
export const getOrbitSettings = () => call('/admin/settings')

/** 항해 금지 시간대 저장 */
export const saveOrbitSettings = (patch) => call('/admin/settings', { method: 'PUT', body: patch })

/** 반원 전체 + 참가 여부·현재 상태 */
export const getOrbitMembers = () => call('/admin/members')

/** 함선 상태 직접 수정 (에너지 주기 등). 준 값만 바뀐다. */
export const patchOrbitShip = (uid, patch) =>
  call(`/admin/ship/${uid}`, { method: 'PATCH', body: patch })

/** 복잡한 상황 한 번에 깔기 — 화면 확인용 */
export const simulateOrbit = () => call('/admin/simulate', { method: 'POST' })

/** 게임 상태 전체 초기화 (반원 명부는 그대로) */
export const resetOrbit = () => call('/admin/reset', { method: 'POST' })

/** 참가 취소 — 이 사람 배만 없앤다 */
export const removeOrbitMember = (uid) => call(`/admin/member/${uid}`, { method: 'DELETE' })
