/* Orbit 데이터의 Firestore 접근 계층.
 *
 * 원본은 Postgres 24개 표였다. 표끼리 1:1인 것들(ship_states, energy_balance,
 * notification_prefs, chat_read_status)은 문서 하나로 합쳤다 — Firestore에선
 * 조인이 없으니 나눠봐야 읽기 횟수만 늘어난다.
 *
 * 중요: 이 컬렉션들은 firestore.rules의 catch-all에 걸려 클라이언트가 직접
 * 못 읽고 못 쓴다. 전부 여기(Admin SDK)를 거친다 — 안 그러면 브라우저에서
 * 에너지를 999로 고쳐버릴 수 있다.
 */

import { START_ENERGY, MAX_REFLECT, MAX_SHIELDS } from './engine.js'

/** 컬렉션 경로. 나중에 이름을 바꿔도 여기만 고치면 된다. */
export const COL = {
  ships: 'orbitShips',
  logs: 'orbitLogs',
  sessions: 'orbitSessions',
  screentime: 'orbitScreentime',
  attacks: 'orbitAttacks',
  chat: 'orbitChat',
  dm: 'orbitDM',
  sickday: 'orbitSickday',
  schedules: 'orbitSchedules',
  settings: 'orbitSettings',
}

/** 새로 참가한 배의 초기 상태. */
export function newShip(uid) {
  return {
    uid,
    /* 수치는 에너지 하나뿐이다. 속도도 여기서 나온다(engine.js) —
     * 0에서 시작하면 첫날이 기어가기만 해서, 최고속 문턱만큼 들려 보낸다. */
    energy: START_ENERGY,
    /** 방어막 겹수(0~2). 미사일 한 발에 바깥 겹부터 한 겹씩 터진다. */
    shields: 0,
    /** 반사막. 겹과 별개로 하나만 두른다 — 닿은 미사일을 쏜 사람에게 되돌린다. */
    reflect: 0,
    routePosition: 0,
    joinedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/* 예전 함선 문서를 새 규칙으로 읽는다.
 *
 * 안정성·방어막 내구도·고장 상태로 돌던 시절의 문서가 그대로 남아 있다. 문서를
 * 일괄로 고치는 대신 읽을 때 맞춰준다 — 저장은 새 모양으로만 하므로 시간이
 * 지나면 저절로 정리된다.
 *
 * 방어막 내구도(0~100)는 장수로 환산한다: 100이면 3장, 50 이상 2장, 남아 있으면 1장.
 * 고장(수리 대기) 상태는 그냥 풀린다 — 이제 그런 상태 자체가 없다. */
export function normalizeShip(raw) {
  if (!raw) return raw
  if (typeof raw.shields === 'number' && raw.stability === undefined) {
    // 반사막이 생기기 전 문서에는 이 칸이 없다. 없으면 0으로 읽는다.
    return raw.reflect === undefined ? { ...raw, reflect: 0 } : raw
  }

  const durability = Number(raw.shieldDurability ?? 0)
  const shields =
    typeof raw.shields === 'number'
      ? raw.shields
      : durability >= 100
        ? 3
        : durability >= 50
          ? 2
          : durability > 0
            ? 1
            : 0

  return {
    uid: raw.uid,
    energy: Math.max(0, Number(raw.energy ?? 0)),
    shields: Math.max(0, Math.min(MAX_SHIELDS, shields)),
    reflect: Math.max(0, Math.min(MAX_REFLECT, Number(raw.reflect ?? 0))),
    routePosition: Number(raw.routePosition ?? 0),
    joinedAt: raw.joinedAt ?? null,
    updatedAt: raw.updatedAt ?? null,
  }
}

/** 전역 설정 기본값. 노플라이존 = 평일 수업시간엔 항해 금지. */
export const DEFAULT_SETTINGS = {
  nfzEnabled: true,
  nfzStart: '09:00',
  nfzEnd: '17:00',
  /* 공격 금지 시간대 — 꺼진 채 시작한다. 켜면 요일과 무관하게 매일 이 구간엔
   * 발사가 막힌다(요격은 예외). 자정을 걸치는 밤 구간도 된다. */
  nazEnabled: false,
  nazStart: '22:00',
  nazEnd: '07:00',
}

/**
 * 방 하나에 대한 Orbit 저장소. server.js가 db와 방 id를 넘겨준다.
 * Firestore 인스턴스를 모듈 전역에 두지 않는 이유는, server.js가 Admin SDK를
 * 게으르게(첫 요청 때) 초기화하기 때문이다.
 */
export function orbitStore(db, classId, { notify } = {}) {
  const base = db.collection('rooms').doc(classId)
  const col = (name) => base.collection(name)

  const shipRef = (uid) => col(COL.ships).doc(uid)
  const sessionRef = (uid) => col(COL.sessions).doc(uid)
  /* 딴짓시간은 "하루에 한 번"이 규칙이다. 원본은 SQL 유니크 제약으로 막았는데,
   * 여기선 문서 ID를 uid+날짜로 만들어서 애초에 두 개가 존재할 수 없게 한다. */
  const screentimeRef = (uid, date) => col(COL.screentime).doc(`${uid}_${date}`)
  const settingsRef = () => col(COL.settings).doc('config')

  return {
    db,
    base,
    col,
    /* 알림 보내기. 없으면 아무 일도 안 하는 빈 함수 —  Firebase 설정이 없는
     * 배포에서도 게임 로직이 그대로 돌아야 한다. */
    notify: notify ?? (async () => {}),
    shipRef,
    sessionRef,
    screentimeRef,

    async getSettings() {
      const snap = await settingsRef().get()
      return { ...DEFAULT_SETTINGS, ...(snap.exists ? snap.data() : {}) }
    },

    async getShip(uid) {
      const snap = await shipRef(uid).get()
      return snap.exists ? normalizeShip(snap.data()) : null
    },

    /** uid → 이름. 닉네임의 원본은 Sevenly 명부지 배 문서가 아니다. */
    async memberNames() {
      const snap = await base.collection('members').get()
      return new Map(snap.docs.map((d) => [d.id, d.data().name || '이름 없음']))
    },

    /* 참가자 전원. 랭킹 계산에 쓴다 — 인원이 적어서 통째로 읽어도 된다.
     *
     * 명부에 없는 배는 뺀다. 반에서 내보낸 사람의 함선 문서가 남아 있으면
     * 항로맵에 "이름 없음"으로 계속 떠 있고(이름은 명부에서 찾는 값이다) 등수까지
     * 차지한다. 내보낼 때 함선도 같이 지우지만(server.js), 그 전에 나간 사람들과
     * 명부만 지우는 다른 경로까지 여기서 한 번에 걸러진다.
     *
     * 명부를 못 읽으면 거르지 않고 전부 준다 — 걸러내려다 멀쩡한 함대를 통째로
     * 비우는 쪽이 더 나쁘다. */
    async allShips() {
      const [snap, membersSnap] = await Promise.all([
        col(COL.ships).get(),
        base
          .collection('members')
          .get()
          .catch(() => null),
      ])
      const ships = snap.docs.map((d) => normalizeShip(d.data()))
      if (!membersSnap) return ships
      const alive = new Set(membersSnap.docs.map((d) => d.id))
      return ships.filter((x) => alive.has(x.uid))
    },

    /** 항로 위치 내림차순 등수. 1등이 1. */
    rankOf(ships, uid) {
      const sorted = [...ships].sort((a, b) => b.routePosition - a.routePosition)
      const i = sorted.findIndex((s) => s.uid === uid)
      return i < 0 ? 1 : i + 1
    },

    /** 시스템 공지를 채팅에 남긴다. 원본 addSystemMessage. */
    async addSystemMessage(content, messageType = 'system') {
      await col(COL.chat).add({
        uid: null,
        nickname: '🛸 SYSTEM',
        content,
        messageType,
        createdAt: new Date().toISOString(),
      })
    },
  }
}
