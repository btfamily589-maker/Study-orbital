import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, ChevronUp, Target } from 'lucide-react'
import { Spaceship } from './Spaceship'
import { WeaponIcon } from './WeaponIcon'
import {
  FULL_SPEED_ENERGY,
  MAX_ENERGY,
  MAX_SHIELDS,
  distanceFor,
  energyFor,
  speedOf,
} from '../../lib/orbitRules'

/* 항로맵 — 원본 Study Orbital의 세로 맵을 그대로 옮겼다.
 *
 * 세로축이 항로다. 아래가 꼴찌, 위가 1위. 좌표는 절대값이 아니라 "꼴찌 기준
 * 상대좌표"다 — 다 같이 앞서 나가도 화면이 안 비고, 격차만 눈에 들어온다.
 *
 * 배는 축을 기준으로 좌우 번갈아 놓는다. 세로로만 세우면 순위가 붙어 있을 때
 * 서로 겹쳐서 이름이 안 보인다.
 *
 * 공부 중인 배는 위치가 계속 앞서 나간다. 서버가 세션 시작 시각부터 흐른 시간을
 * 미리 더해서 주고, 그 다음부터는 여기서 초 단위로 더 밀어준다.
 */

const ENERGY_BAR_MAX = MAX_ENERGY

/* 이만큼 끌고 놓으면 장이 넘어간다. 너무 짧으면 배를 누르려다 넘어가고,
 * 너무 길면 한 손으로는 못 넘긴다. */
const SWIPE_TRIGGER = 56

/* 한 페이지에 세우는 배의 수. 스무 명이 한 화면에 들어가면 이름이 겹치고
 * 격차도 안 보인다. 다섯씩 끊어서 위아래로 넘긴다. */
const PER_PAGE = 5

/* 함선을 감싸는 방어 구역의 반지름. 미사일도 궤도도 이 원 안으로 못 들어온다 —
 * 미사일 앞 끝이 원에 닿는 순간이 곧 공격 종료다.
 * ShipGlyph가 그리는 원과 같은 값이라야 그림이 맞는다. */
const DEFENSE_ZONE_R = 24

/* 미사일이 오가는 구간. 궤적선은 함선 중심끼리 잇지만, 미사일 자체는 양 끝에서
 * 이만큼 안쪽까지만 다닌다.
 *
 * 발사 직후엔 이미 쏜 배 밖에 나와 있고(안 그러면 배에 파묻혀 "방금 쐈다"가 안
 * 보인다), 맞는 배의 중심에서 이 반경 안에 들면 도착으로 친다(중심까지 가면
 * 배 밑에 깔려서 곧 터질 미사일이 안 보인다).
 *
 * 26일 땐 배 글리프(날개 끝 ±16, 이름·에너지 막대는 +36까지)에 겨우 안 겹치는
 * 정도라 미사일이 배에 달라붙어 보였다. 46이면 배와 이름표 바깥으로 확실히
 * 떨어진다. */
const MISSILE_LAUNCH_R = 46
const MISSILE_ARRIVE_R = 46
/* 혜성 꼬리 길이(px). 지나온 길 전체를 진하게 칠하면 맵이 선 뭉치가 되므로,
 * 기체 뒤 이만큼만 밝게 태우고 나머지는 잔광으로 남긴다. */
const MISSILE_TAIL = 54

/* 궤적이 겹칠 때 옆으로 밀어내는 간격. 7px일 땐 세 줄이 한 다발로 보여서
 * 겹친 것과 구분이 안 됐다. */
const MISSILE_LANE_GAP = 13
/* 한 다발이 아무리 두꺼워도 여기까지만 벌린다 — 안 그러면 여러 발이 날아올 때
 * 옆 줄의 배까지 넘어간다. */
const MISSILE_LANE_SPREAD = 40
/* 같은 직선으로 볼 각도 차(사인값)와 거리 차. 배가 같은 세로줄에 서면 좌표가
 * 완전히 같아서 실제로는 0에 가깝다. */
const COLLINEAR_SIN = 0.06
const SEGMENT_OVERLAP = 6

/** a와 b가 화면에서 같은 선처럼 보이는가 — 방향도 같고, 겹치는 구간도 있어야 한다. */
function overlaps(a, b) {
  if (Math.abs(a.ux * b.uy - a.uy * b.ux) > COLLINEAR_SIN) return false
  if (Math.abs(a.off - b.off) > MISSILE_LANE_GAP) return false
  return Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > SEGMENT_OVERLAP
}

/**
 * 미사일마다 궤적을 옆으로 얼마나(px) 밀지 정한다.
 *
 * 예전엔 (쏜 사람 → 맞는 사람) 짝으로만 묶었다. 그런데 배는 세로 몇 줄에 나눠
 * 세우기 때문에 같은 줄에 선 배들끼리는 x가 완전히 같다 — 1위→5위와 3위→7위처럼
 * 짝이 달라도 궤적이 같은 직선 위에 그대로 포개진다. 짝이 아니라 "화면에서 같은
 * 선을 밟는가"로 묶어야 한다.
 *
 * 각 궤적을 직선(방향·원점까지 거리)과 그 위의 구간으로 바꾼 뒤, 같은 직선이면서
 * 구간이 겹치는 것들을 한 다발로 모은다(겹침은 전이된다 — A와 C가 안 겹쳐도 B를
 * 통해 이어지면 한 다발이다). 다발마다 0을 가운데 두고 좌우로 벌린다.
 *
 * id로 정렬해서 매기므로 다시 그려도 줄 순서가 안 바뀐다.
 *
 * 돌려주는 건 레인 번호가 아니라 화면에서 밀 거리(px 벡터)다. 번호만 주면
 * 받는 쪽이 "진행 방향의 왼쪽"으로 밀게 되는데, A→B와 B→A는 진행 방향이
 * 반대라 왼쪽도 반대가 된다 — 번호가 +와 −로 갈려 있어도 둘이 같은 자리에
 * 그려졌다. 방향을 통일한 여기서 벡터까지 정해야 한다.
 *
 * @param missiles  미사일 목록
 * @param coordsOf  m → { x1, y1, x2, y2 } (화면 좌표)
 * @returns Map<id, { ox, oy }>
 */
export function missileLanes(missiles, coordsOf) {
  const items = [...missiles]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((m) => {
      const { x1, y1, x2, y2 } = coordsOf(m)
      const len = Math.hypot(x2 - x1, y2 - y1) || 1
      let ux = (x2 - x1) / len
      let uy = (y2 - y1) / len
      // 방향을 한쪽으로 통일한다. 안 그러면 A→B와 B→A가 다른 직선으로 잡힌다.
      if (ux < 0 || (ux === 0 && uy < 0)) {
        ux = -ux
        uy = -uy
      }
      const s = ux * x1 + uy * y1
      const e = ux * x2 + uy * y2
      return {
        id: m.id,
        ux,
        uy,
        off: -uy * x1 + ux * y1, // 원점에서 이 직선까지의 부호 있는 거리
        lo: Math.min(s, e),
        hi: Math.max(s, e),
      }
    })

  // 겹치는 것끼리 잇는다. 날아다니는 미사일은 많아야 수십 개라 이중 루프면 충분하다.
  const groupOf = items.map((_, i) => i)
  const find = (i) => (groupOf[i] === i ? i : (groupOf[i] = find(groupOf[i])))
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (overlaps(items[i], items[j])) groupOf[find(j)] = find(i)
    }
  }

  const bundles = new Map()
  items.forEach((it, i) => {
    const root = find(i)
    if (!bundles.has(root)) bundles.set(root, [])
    bundles.get(root).push(it)
  })

  const offsets = new Map()
  for (const group of bundles.values()) {
    const gap =
      group.length > 1
        ? Math.min(MISSILE_LANE_GAP, MISSILE_LANE_SPREAD / (group.length - 1))
        : MISSILE_LANE_GAP
    group.forEach((it, i) => {
      const d = (i - (group.length - 1) / 2) * gap
      // 통일한 방향의 수직으로 민다 — 진행 방향이 반대여도 같은 쪽으로 안 몰린다.
      offsets.set(it.id, { ox: -it.uy * d, oy: it.ux * d })
    })
  }
  return offsets
}

/* 궤적이 남의 배(쏜 쪽도 맞는 쪽도 아닌 배) 위를 밟고 지나가면 그 배가 맞는
 * 것처럼 보인다. 배를 세로 몇 줄로 나눠 세우기 때문에 같은 줄의 두 배 사이를
 * 오가는 궤적은 그 사이에 선 배들을 전부 관통한다. 길목에 배가 있으면 궤적을
 * 활처럼 옆으로 휘어서 피해 간다.
 *
 * 얼마나 휘나: 양 끝을 고정하고 가운데 제어점만 수직으로 k만큼 민 이차 곡선은
 * 매개변수 t 지점에서 직선으로부터 2t(1-t)·k 벗어난다. 길목의 배마다 "그
 * 자리에서 이만큼은 비켜야 한다"로 k를 역산해 가장 큰 값을 쓴다. 길 양쪽에 다
 * 배가 있으면 덜 휘어도 되는 쪽으로 휜다. */
const TRAIL_CLEAR = 30
const TRAIL_BOW_MAX = 80

export function missileBow(ax, ay, bx, by, ships) {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len

  const conflicts = []
  for (const s of ships) {
    const rx = s.x - ax
    const ry = s.y - ay
    const t = (rx * ux + ry * uy) / len
    // 끝점 코앞은 방어 구역 잘라내기가 이미 처리한다.
    if (t <= 0.03 || t >= 0.97) continue
    const d = rx * -uy + ry * ux
    if (Math.abs(d) < TRAIL_CLEAR) conflicts.push({ t, d })
  }
  if (!conflicts.length) return 0

  /* dir 쪽으로 휠 때 필요한 k. 배가 휘는 반대편에 있으면 남은 틈만큼만,
   * 같은 편에 있으면 그 배 너머까지 휘어야 한다. */
  const need = (dir) =>
    Math.max(
      ...conflicts.map(({ t, d }) => {
        const gap = dir * d < 0 ? TRAIL_CLEAR - Math.abs(d) : TRAIL_CLEAR + Math.abs(d)
        return gap / (2 * t * (1 - t))
      }),
    )
  const plus = need(1)
  const minus = need(-1)
  return plus <= minus ? Math.min(plus, TRAIL_BOW_MAX) : -Math.min(minus, TRAIL_BOW_MAX)
}

/** 이차 곡선 (x1,y1)-(mx,my)-(x2,y2) 위의 t 지점. */
function qPoint(x1, y1, mx, my, x2, y2, t) {
  const a = (1 - t) * (1 - t)
  const b = 2 * t * (1 - t)
  const c = t * t
  return [a * x1 + b * mx + c * x2, a * y1 + b * my + c * y2]
}

/** 이차 곡선의 t0~t1 구간을 짧은 직선들로 이은 path 문자열. */
function qPath(x1, y1, mx, my, x2, y2, t0, t1, steps = 18) {
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const [px, py] = qPoint(x1, y1, mx, my, x2, y2, t0 + ((t1 - t0) * i) / steps)
    pts.push(`${px.toFixed(1)},${py.toFixed(1)}`)
  }
  return `M${pts.join(' L')}`
}

const MISSILE_COLORS = {
  missile_basic: '#3b82f6',
  missile_fast: '#22c55e',
  missile_heavy: '#ff6b35',
  missile_stealth: '#a855f7',
  missile_nuke: '#ff0000',
}
const MISSILE_NAMES = {
  missile_basic: 'MISSILE',
  missile_fast: 'FAST',
  missile_heavy: 'HEAVY',
  missile_stealth: 'STEALTH',
  missile_nuke: 'NUCLEAR',
  emp: 'EMP',
}

export const fmtDist = (n) => `${(Math.round(n * 100) / 100).toFixed(2)} ly`

function fmtEta(sec) {
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    return m > 0 ? `${h}시간 ${m}분` : `${h}시간`
  }
  if (sec >= 60) {
    const m = Math.floor(sec / 60)
    const ss = sec % 60
    return ss > 0 ? `${m}분 ${ss}초` : `${m}분`
  }
  return `${sec}초`
}

/* 함선 색.
 *
 * 기본색이 곧 "누구 배냐"다 — 내 배는 파랑, 남의 배는 하양. 여기에 상한 만큼
 * 빨강이 왼쪽부터 차오른다. 체력이 깎이는 것처럼, 얼마나 상했는지가 색이 덮은
 * 넓이로 보인다.
 *
 * 최고속(에너지 30E)이면 한 점도 안 붉고, 0이면 배 전체가 빨갛다. */
const MINE_RGB = [0, 212, 255]
const OTHER_RGB = [255, 255, 255]
const DANGER_RGB = [255, 0, 0]

export function shipBaseColor(isMe) {
  const c = isMe ? MINE_RGB : OTHER_RGB
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export const DANGER_COLOR = `rgb(${DANGER_RGB[0]},${DANGER_RGB[1]},${DANGER_RGB[2]})`

/** 얼마나 상했나(0~1). 최고속이면 0, 멈췄으면 1. */
export const damageOf = (energy) => 1 - speedOf(energy)

/* 네온 빛 색. 배가 반쯤 붉으면 빛도 그만큼 붉어야 따로 놀지 않는다. */
function glowColor(energy, isMe) {
  const base = isMe ? MINE_RGB : OTHER_RGB
  const t = damageOf(energy)
  const c = base.map((v, i) => Math.round(v + (DANGER_RGB[i] - v) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/* 방어막 돔 크기. 배(날개 끝 ±16)를 넉넉히 감싸되 방어 구역(24)은 안 넘는다. */
const SHIELD_RX = 21
const SHIELD_RY = 22

/** 육각형 한 개의 꼭짓점. Spaceship.jsx가 쓰는 것과 같은 모양이다. */
function hexPoints(cx, cy, r) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (i * 60 * Math.PI) / 180
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
  }).join(' ')
}

/* OPER. 방어막 탭의 보유 배너가 쓰는 돔 아이콘.
 * 맵의 배가 두르는 돔과 같은 그림이어야, 산 것이 맵에서 뭐로 보일지 알아본다.
 * tier는 맵에서의 겹 순서(0=1차, 1=2차, 2=반사) — 크기·육각 고리 위치가 이걸 따른다. */
export function ShieldDomeIcon({ color, tier = 0, className }) {
  const uid = useId().replace(/:/g, '')
  const pad = [0, 3.5, 7][tier] ?? 0
  const rx = SHIELD_RX + pad
  const ry = SHIELD_RY + pad
  const cx = 30
  const cy = 31
  const domeStrength = 0.8
  const ring = 0.58 + tier * 0.16
  return (
    <svg viewBox="0 0 60 62" className={className}>
      <defs>
        <radialGradient id={`sdg-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="0" />
          <stop offset="62%" stopColor={color} stopOpacity="0" />
          <stop offset="62%" stopColor={color} stopOpacity={0.02 + domeStrength * 0.06} />
          <stop offset="86%" stopColor={color} stopOpacity={0.02 + domeStrength * 0.06} />
          <stop offset="86%" stopColor={color} stopOpacity={0.05 + domeStrength * 0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0.05 + domeStrength * 0.18} />
        </radialGradient>
        <clipPath id={`sdc-${uid}`}>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />
        </clipPath>
      </defs>
      <motion.ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill={`url(#sdg-${uid})`}
        stroke={color}
        strokeWidth={0.5 + domeStrength * 0.8}
        animate={{
          strokeOpacity: [
            0.15 + domeStrength * 0.4,
            0.25 + domeStrength * 0.55,
            0.15 + domeStrength * 0.4,
          ],
        }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />
      <g clipPath={`url(#sdc-${uid})`} opacity={0.15 + domeStrength * 0.35}>
        {Array.from({ length: 6 }, (_, i) => {
          const angle = (i * 60 * Math.PI) / 180
          const hx = cx + Math.cos(angle) * (rx * ring)
          const hy = cy + Math.sin(angle) * (ry * ring)
          return (
            <motion.polygon
              key={i}
              points={hexPoints(hx, hy, 6)}
              fill="none"
              stroke={color}
              strokeWidth={0.5}
              animate={{ strokeOpacity: [0.2, 0.5, 0.2] }}
              transition={{ duration: 2 + (i % 3) * 0.5, repeat: Infinity, delay: i * 0.15 }}
            />
          )
        })}
      </g>
    </svg>
  )
}

/** 상세 패널의 숫자 색. 값이 먼저 눈에 들어와야 해서 한 색으로 못 박는다. */
const STAT_AMBER = 'hsl(28 100% 58%)'

/** 에너지 막대 색. 최고속이면 청록, 절반 아래면 주황, 바닥이면 빨강. */
const barColor = (e) => (speedOf(e) >= 1 ? '#00d4ff' : speedOf(e) >= 0.34 ? '#ff6b35' : '#ff3333')

/** 맵 위의 배 한 대. 등수 배지 · 이름 · 에너지 막대가 한 덩어리로 움직인다. */
function ShipGlyph({
  x,
  y,
  color,
  baseColor,
  /** 0~1. 왼쪽부터 이만큼 빨갛게 덮인다. */
  damage = 0,
  rank,
  isMe,
  nickname,
  /** 프사(data URL). 있으면 등수 배지 반대편에 동그랗게 띄운다. */
  photo,
  energy,
  shields = 0,
  reflect = 0,
  hasIncoming,
  onClick,
}) {
  /* 배는 한 색으로 칠하지 않는다. 대칭축을 기준으로 왼쪽은 기본색(누구 배인지 —
   * 내 배면 파랑, 남의 배면 하양), 오른쪽은 상태색(맞을수록 빨개진다).
   * 그래야 "누구 배인가"와 "지금 얼마나 상했나"가 한 번에 보인다.
   * 왼쪽 기본색은 안 변하고, 오른쪽만 물든다.
   *
   * userSpaceOnUse로 좌표를 못 박는다. 기본값(objectBoundingBox)이면 날개·본체가
   * 저마다 제 폭에 맞춰 그라데이션을 다시 그려서 이어지지 않는다. */
  const gradId = `ship-${String(x).replace('.', '_')}-${String(y).replace('.', '_')}`
  const paint = `url(#${gradId})`
  // 방어막 돔이 쓰는 id. 한 화면에 배가 여럿이라 겹치면 안 된다.
  const shieldGradId = `shieldGrad-${gradId}`
  const shieldClipId = `shieldClip-${gradId}`
  /* 돔 하나의 짙기. 예전엔 겹수 비율을 썼는데, 반사막만 두른 배(겹 0)가
   * 거의 안 보였다. 겹이 몇인지는 돔 개수가 이미 말해 주므로 고정한다. */
  const domeStrength = 0.8
  const hurt = Math.max(0, Math.min(1, damage))

  const barW = 20
  const barH = 2.5
  const barX = x - barW / 2
  const barY = y + 36
  const fillW = Math.max(0, Math.min(1, Math.max(0, energy) / ENERGY_BAR_MAX)) * barW

  return (
    <g
      onClick={(e) => {
        // 여기서 안 끊으면 맵 전체의 "닫기"가 같이 걸려 열자마자 닫힌다.
        e.stopPropagation()
        onClick()
      }}
      style={{ cursor: 'pointer' }}
    >
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          /* 날개 끝(±16)까지 걸쳐야 "배의 몇 할이 붉은가"가 눈금대로 읽힌다.
             ±12로 잡으면 날개는 늘 기본색이라 다 깎여도 다 붉지 않았다. */
          x1={x - 16}
          y1={y}
          x2={x + 16}
          y2={y}
        >
          {/* 왼쪽부터 상한 만큼 빨강, 나머지는 기본색. 같은 자리에 두 stop을
              놓으면 섞이지 않고 딱 끊겨서 경계가 눈금처럼 읽힌다. */}
          <stop offset="0%" stopColor={DANGER_COLOR} />
          <stop offset={`${hurt * 100}%`} stopColor={DANGER_COLOR} />
          <stop offset={`${hurt * 100}%`} stopColor={baseColor} />
          <stop offset="100%" stopColor={baseColor} />
        </linearGradient>
      </defs>
      {/* 미사일이 날아오는 중이면 빨간 경보가 퍼진다.
          경계선은 따로 안 그린다 — 궤적이 이미 그 자리에서 끊기므로 구역이
          어디까지인지는 저절로 보인다. */}
      {hasIncoming && (
        <motion.circle
          cx={x}
          cy={y}
          r={DEFENSE_ZONE_R}
          fill="none"
          stroke="#ff2222"
          strokeWidth={1.5}
          animate={{
            r: [DEFENSE_ZONE_R, DEFENSE_ZONE_R + 7, DEFENSE_ZONE_R],
            strokeOpacity: [0.7, 0, 0.7],
          }}
          transition={{ duration: 0.9, repeat: Infinity }}
        />
      )}

      <motion.g
        animate={isMe ? { y: [0, -1.5, 0] } : {}}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        /* 에너지가 바닥난 배는 통째로 살짝 죽인다 — 멈춰 있다는 표시다. */
        opacity={energy > 0 ? 1 : 0.55}
      >
        {/* 선체. 예전엔 꼭짓점 네 개짜리 다각형이라 종이비행기처럼 보였다.
            콧날에서 꼬리까지 곡선으로 흘려 실루엣을 매끈하게 하고, 전체를
            1.5배쯤 키웠다 — 맵에서 배가 너무 작아 무슨 모양인지 안 보였다. */}
        <path
          d={
            `M${x},${y - 15} ` +
            `C${x + 3.5},${y - 8} ${x + 6},${y - 1} ${x + 6.5},${y + 7} ` +
            `L${x + 3},${y + 10} L${x - 3},${y + 10} L${x - 6.5},${y + 7} ` +
            `C${x - 6},${y - 1} ${x - 3.5},${y - 8} ${x},${y - 15} Z`
          }
          fill="#0d1b2a"
          stroke={paint}
          strokeWidth={isMe ? 2 : 1.5}
          strokeLinejoin="round"
          style={{
            // 고장이면 네온을 끈다. 빛나는 배는 살아 있어 보인다.
            filter: energy > 0 ? `drop-shadow(0 0 ${isMe ? 6 : 4}px ${color})` : undefined,
          }}
        />
        {/* 조종석. 콧날 아래 물방울 하나면 앞뒤가 단번에 읽힌다. */}
        <ellipse cx={x} cy={y - 5} rx={2.6} ry={4.4} fill={paint} fillOpacity={0.45} />

        {/* 날개. 뒤로 젖힌 삼각날개 — 아래로 처진 사각 날개보다 빠르게 보인다. */}
        <path
          d={`M${x - 5.5},${y - 1} L${x - 16},${y + 9} L${x - 15},${y + 12.5} L${x - 6},${y + 8} Z`}
          fill="#0a1628"
          stroke={paint}
          strokeWidth={0.9}
          strokeLinejoin="round"
        />
        <path
          d={`M${x + 5.5},${y - 1} L${x + 16},${y + 9} L${x + 15},${y + 12.5} L${x + 6},${y + 8} Z`}
          fill="#0a1628"
          stroke={paint}
          strokeWidth={0.9}
          strokeLinejoin="round"
        />
        {/* 꼬리날개 */}
        <path
          d={`M${x},${y - 2} L${x - 1.6},${y + 10} L${x + 1.6},${y + 10} Z`}
          fill={paint}
          fillOpacity={0.28}
        />

        {/* 엔진 화염. 멈춘 배는 안 뿜는다. */}
        {energy > 0 && (
          <motion.path
            d={`M${x - 2.6},${y + 10} L${x},${y + (isMe ? 20 : 16)} L${x + 2.6},${y + 10} Z`}
            fill={paint}
            animate={
              isMe
                ? { scaleY: [1, 1.5, 0.8, 1.3, 1], opacity: [0.8, 1, 0.5, 0.9, 0.8] }
                : { opacity: [0.3, 0.6, 0.3] }
            }
            transition={{ duration: isMe ? 0.25 : 1.5, repeat: Infinity }}
            style={{ transformOrigin: `${x}px ${y + 10}px` }}
          />
        )}

        {/* 방어막. 겹마다 같은 돔이 하나씩 더 씌워진다 — 모양은 똑같고 색과
            크기만 다르다. 안쪽 파랑이 1차, 그 위 보라가 2차, 제일 바깥 초록이
            반사막이다. 큰 돔일수록 비싼 것이라 크기만 봐도 읽힌다.
            HUD의 함선에 씌워지는 것과 같은 물건이다 — 같은 모양이어야 알아본다. */}
        {[
          { on: shields >= 1, color: '#00d4ff', pad: 0 },
          { on: shields >= 2, color: '#c084fc', pad: 3.5 },
          { on: reflect >= 1, color: '#34d399', pad: 7 },
        ].map(
          (d, di) =>
            d.on && (
              <g key={di} style={{ pointerEvents: 'none' }}>
                <defs>
                  <radialGradient id={`${shieldGradId}-${di}`} cx="50%" cy="50%" r="50%">
                    {/* 같은 자리에 두 stop을 겹쳐 띠를 또렷하게 끊는다. */}
                    <stop offset="0%" stopColor={d.color} stopOpacity="0" />
                    <stop offset="62%" stopColor={d.color} stopOpacity="0" />
                    <stop
                      offset="62%"
                      stopColor={d.color}
                      stopOpacity={0.02 + domeStrength * 0.06}
                    />
                    <stop
                      offset="86%"
                      stopColor={d.color}
                      stopOpacity={0.02 + domeStrength * 0.06}
                    />
                    <stop
                      offset="86%"
                      stopColor={d.color}
                      stopOpacity={0.05 + domeStrength * 0.18}
                    />
                    <stop
                      offset="100%"
                      stopColor={d.color}
                      stopOpacity={0.05 + domeStrength * 0.18}
                    />
                  </radialGradient>
                  <clipPath id={`${shieldClipId}-${di}`}>
                    <ellipse cx={x} cy={y} rx={SHIELD_RX + d.pad} ry={SHIELD_RY + d.pad} />
                  </clipPath>
                </defs>

                <motion.ellipse
                  cx={x}
                  cy={y}
                  rx={SHIELD_RX + d.pad}
                  ry={SHIELD_RY + d.pad}
                  fill={`url(#${shieldGradId}-${di})`}
                  stroke={d.color}
                  strokeWidth={0.5 + domeStrength * 0.8}
                  strokeOpacity={0.15 + domeStrength * 0.4}
                  animate={{
                    strokeOpacity: [
                      0.15 + domeStrength * 0.4,
                      0.25 + domeStrength * 0.55,
                      0.15 + domeStrength * 0.4,
                    ],
                  }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                />

                {/* 육각 격자. 겹칠 때 안쪽 것이 다 가려지지 않게 바깥 돔일수록
                    더 바깥쪽 고리에만 그린다. */}
                <g clipPath={`url(#${shieldClipId}-${di})`} opacity={0.15 + domeStrength * 0.35}>
                  {Array.from({ length: 6 }, (_, i) => {
                    const angle = (i * 60 * Math.PI) / 180
                    const ring = 0.58 + di * 0.16
                    const hx = x + Math.cos(angle) * ((SHIELD_RX + d.pad) * ring)
                    const hy = y + Math.sin(angle) * ((SHIELD_RY + d.pad) * ring)
                    return (
                      <motion.polygon
                        key={i}
                        points={hexPoints(hx, hy, 6)}
                        fill="none"
                        stroke={d.color}
                        strokeWidth={0.5}
                        animate={{ strokeOpacity: [0.2, 0.5, 0.2] }}
                        transition={{
                          duration: 2 + (i % 3) * 0.5,
                          repeat: Infinity,
                          delay: i * 0.15,
                        }}
                      />
                    )
                  })}
                </g>
              </g>
            ),
        )}

        {/* 좌우를 가르는 자리. 색이 딱 끊기는 것만으로 경계가 보이므로 선 자체는
            안 보이게 둔다 — 검은 줄이 배 한가운데를 갈라놓아 오히려 지저분했다. */}
        <line x1={x} y1={y - 15} x2={x} y2={y + 10} stroke="transparent" strokeWidth={0.8} />

        {/* 프사. 등수 배지의 반대편(왼쪽 위)에 동그랗게 — 배지와 짝을 이룬다. */}
        {photo && (
          <>
            <clipPath id={`avatar-${gradId}`}>
              <circle cx={x - 15} cy={y - 11} r={7} />
            </clipPath>
            <image
              href={photo}
              x={x - 22}
              y={y - 18}
              width={14}
              height={14}
              clipPath={`url(#avatar-${gradId})`}
              preserveAspectRatio="xMidYMid slice"
            />
            <circle
              cx={x - 15}
              cy={y - 11}
              r={7}
              fill="none"
              stroke={isMe ? '#00d4ff' : 'rgba(255,255,255,0.75)'}
              strokeWidth={1}
            />
          </>
        )}

        {/* 등수 배지. 1등만 금색. */}
        <circle
          cx={x + 15}
          cy={y - 11}
          r={6.5}
          fill="#0d1b2a"
          stroke={rank === 1 ? '#f59e0b' : 'rgba(255,255,255,0.75)'}
          strokeWidth={1}
        />
        <text
          x={x + 15}
          y={y - 8.4}
          textAnchor="middle"
          fontSize={9.5}
          fontWeight="bold"
          fill={rank === 1 ? '#f59e0b' : 'rgba(255,255,255,0.95)'}
          fontFamily="monospace"
        >
          {rank}
        </text>

        <text
          x={x}
          y={y + 30}
          textAnchor="middle"
          fontSize={isMe ? 12.5 : 11.5}
          /* 이름은 함선 색을 따라가지 않는다. 배가 빨개지든 파랗든 이름은 늘
             하양이라야 읽힌다 — 색은 배가 말하고, 이름은 이름만 말한다. */
          fill="#ffffff"
          fontFamily="monospace"
          style={{ fontWeight: 700 }}
        >
          {nickname.slice(0, 8)}
        </text>

        <rect x={barX} y={barY} width={barW} height={barH} rx={1} fill="rgba(255,255,255,0.08)" />
        <rect
          x={barX}
          y={barY}
          width={fillW}
          height={barH}
          rx={1}
          fill={barColor(energy)}
          style={{ filter: `drop-shadow(0 0 2px ${barColor(energy)})` }}
        />
        <text
          x={x + barW / 2 + 3}
          y={barY + barH - 0.2}
          fontSize={7.5}
          fill={barColor(energy)}
          fontFamily="monospace"
        >
          {Math.round(energy)}E
        </text>
      </motion.g>
    </g>
  )
}

/** 배를 누르면 옆에 붙는 상세 패널. 맵 안(SVG)에 그려서 좌표가 안 어긋난다. */
function Callout({ ship, x, y, mapW, mapH, onClose }) {
  const w = 140
  const h = 112
  const offset = 56

  /* 배의 오른쪽에 붙이되 자리가 모자라면 왼쪽으로 넘긴다. 그러고도 맵을 벗어나면
   * 안쪽으로 밀어 넣는다 — 예전엔 밀어 넣지 않아서 가장자리 줄에 선 배를 누르면
   * 패널이 맵 밖으로 잘려 나갔다. 위아래도 마찬가지다. */
  const toLeft = x + offset + w > mapW
  const px = Math.max(4, Math.min(mapW - w - 4, toLeft ? x - offset - w : x + offset))
  const py = Math.max(4, Math.min(mapH - h - 4, y - h / 2))
  const lineFromX = toLeft ? x - 14 : x + 14
  const lineToX = px + w < x ? px + w : px

  const energy = Math.max(0, ship.energy ?? 0)
  const speed = speedOf(energy)
  const shields = ship.shields ?? 0
  const reflect = ship.reflect ?? 0

  const barX = px + 7
  const barW = w - 14

  /* 값 한 줄. 에너지와 속도는 막대를 한 줄 깔아서 숫자를 안 읽어도 대충 어느
   * 정도인지 보이게 한다 — 옆의 함선끼리 견주는 게 이 패널의 일이다.
   * 숫자는 둘 다 주황이다. 배 색깔(위험도)은 맵의 배가 이미 말하고 있으므로,
   * 여기서까지 색을 바꾸면 같은 말을 두 번 하면서 읽기만 어려워진다. */
  const stat = (topY, label, value, ratio, fill, tick) => (
    <>
      <text x={px + 7} y={topY} fontSize={9} fill="rgba(255,255,255,0.85)" fontFamily="monospace">
        {label}
      </text>
      <text
        x={px + w - 7}
        y={topY}
        fontSize={10.5}
        fill={STAT_AMBER}
        fontFamily="monospace"
        fontWeight="bold"
        textAnchor="end"
      >
        {value}
      </text>
      <rect x={barX} y={topY + 4} width={barW} height={3} rx={1.5} fill="rgba(255,255,255,0.1)" />
      <rect
        x={barX}
        y={topY + 4}
        width={Math.max(0, Math.min(1, ratio)) * barW}
        height={3}
        rx={1.5}
        fill={fill}
      />
      {/* 최고속 문턱 눈금 — "얼마나 더 채우면 제 속도가 나오는지" */}
      {tick != null && (
        <line
          x1={barX + barW * tick}
          y1={topY + 2.5}
          x2={barX + barW * tick}
          y2={topY + 8.5}
          stroke="rgba(255,255,255,0.5)"
          strokeWidth={0.8}
        />
      )}
    </>
  )

  return (
    <g onClick={(e) => e.stopPropagation()}>
      <line
        x1={lineFromX}
        y1={y}
        x2={lineToX}
        y2={py + h / 2}
        stroke="rgba(0,212,255,0.35)"
        strokeWidth={0.8}
        strokeDasharray="3 2"
      />
      <circle cx={lineFromX} cy={y} r={1.5} fill="#00d4ff" opacity={0.5} />

      <rect
        x={px}
        y={py}
        width={w}
        height={h}
        rx={5}
        fill="rgba(8,15,30,0.92)"
        stroke="rgba(0,212,255,0.3)"
        strokeWidth={0.8}
      />

      <text
        x={px + 7}
        y={py + 17}
        fontSize={11.5}
        fontFamily="monospace"
        fontWeight="bold"
        fill="white"
      >
        {ship.nickname}
      </text>
      {/* 상태는 할 말이 있을 때만 적는다. "대기 중"은 아무 일도 없다는 뜻이라
          자리만 차지했고, 그 자리를 닫기 버튼에 내줬다. */}
      {(energy <= 0 || ship.isStudying) && (
        <text
          x={px + w - 26}
          y={py + 17}
          textAnchor="end"
          fontSize={9}
          fontFamily="monospace"
          fontWeight="bold"
          fill={energy <= 0 ? '#ff6b35' : '#4ade80'}
        >
          {energy <= 0 ? '에너지 없음' : '공부 중'}
        </text>
      )}

      <line
        x1={px + 5}
        y1={py + 24}
        x2={px + w - 5}
        y2={py + 24}
        stroke="rgba(0,212,255,0.15)"
        strokeWidth={0.5}
      />

      {/* 위치는 숫자 하나로 끝난다 — 막대로 그릴 만한 상한이 없다. */}
      <text
        x={px + 7}
        y={py + 38}
        fontSize={9}
        fill="rgba(255,255,255,0.85)"
        fontFamily="monospace"
      >
        위치
      </text>
      <text
        x={px + w - 7}
        y={py + 38}
        fontSize={10.5}
        fill="white"
        fontFamily="monospace"
        fontWeight="bold"
        textAnchor="end"
      >
        {fmtDist(ship.routePosition)}
      </text>

      {stat(
        py + 57,
        '에너지',
        `${Math.round(energy)}E`,
        energy / MAX_ENERGY,
        barColor(energy),
        FULL_SPEED_ENERGY / MAX_ENERGY,
      )}
      {stat(py + 79, '속도', `${Math.round(speed * 100)}%`, speed, '#00d4ff')}

      {/* 방어막. 겹은 파랑·보라, 반사막은 초록 — 맵의 원과 같은 색이다. */}
      {Array.from({ length: shields }, (_, i) => (
        <circle
          key={i}
          cx={px + 11 + i * 8}
          cy={py + 100}
          r={2.8}
          fill={i === 0 ? '#00d4ff' : '#c084fc'}
          opacity={0.9}
        />
      ))}
      {reflect > 0 && (
        <circle cx={px + 11 + shields * 8} cy={py + 100} r={2.8} fill="#34d399" opacity={0.9} />
      )}
      {shields === 0 && reflect === 0 && (
        <text
          x={px + 7}
          y={py + 103}
          fontSize={8.5}
          fill="rgba(255,255,255,0.4)"
          fontFamily="monospace"
        >
          방어막 없음
        </text>
      )}

      {/* 닫기. 손가락으로 누르는 것이라 글자보다 누를 자리를 먼저 넉넉히 잡는다. */}
      <rect
        x={px + w - 21}
        y={py + 1}
        width={20}
        height={20}
        rx={4}
        fill="transparent"
        onClick={onClose}
        style={{ cursor: 'pointer' }}
      />
      <text
        x={px + w - 11}
        y={py + 15.5}
        textAnchor="middle"
        fontSize={16}
        fontWeight="bold"
        fill="rgba(255,255,255,0.85)"
        style={{ cursor: 'pointer', pointerEvents: 'none' }}
      >
        ×
      </text>
    </g>
  )
}

/* 날아가는 미사일 한 발.
 *
 * 예전엔 지나온 길을 굵은 실선, 남은 길을 점선으로 긋고 만화 삼각형에 주황
 * 불꽃 타원을 깜빡였다 — 선 세 종류가 다 진해서 장난감처럼 보였다.
 * 이제 층을 나눈다: 남은 길은 있는 듯 없는 듯한 예고선, 지나온 길은 잔광,
 * 기체 뒤 30px만 혜성 꼬리로 밝게 태운다. 기체는 가늘고 긴 다트 하나에
 * 백열 코어 점 하나 — 불꽃 애니메이션 없이 꼬리가 속도감을 다 말해준다. */
function MissileTrail({ missile, fromX, fromY, toX, toY, now, offset, bow = 0 }) {
  const total = missile.impactAt - missile.launchedAt
  const t = total > 0 ? Math.min(1, Math.max(0, (now - missile.launchedAt) / total)) : 1

  /* 선과 미사일의 범위가 다르다.
   *
   *   ● 쏜 배 ├──────────────────────────────┤ ● 맞는 배   ← 선(중심~중심)
   *            └ 0분일 때 여기      여기 닿으면 도착 ┘        ← 미사일이 다니는 구간
   */
  const dx = toX - fromX
  const dy = toY - fromY
  const dist = Math.hypot(dx, dy) || 1
  const ux = dx / dist
  const uy = dy / dist

  /* 같은 선을 밟는 궤적이 여럿이면 수직으로 조금씩 떼어 놓는다(missileLanes에서
   * 밀 거리를 벡터로 받는다). 수직으로만 밀기 때문에 대상까지의 거리는 오히려
   * 멀어진다 — √(경계² + 옆으로 민 거리²) ≥ 경계. 방어 구역을 침범할 일이 없다. */
  const sx = fromX + (offset?.ox ?? 0)
  const sy = fromY + (offset?.oy ?? 0)

  /* 궤적선은 함선 중심에서 중심까지 그대로 잇는다. 예전엔 양 끝을 방어 구역
   * 반지름만큼 잘라냈는데, 그러면 선이 허공에서 시작해 허공에서 끝나서 누가
   * 누구를 쏜 건지 눈으로 따라가기 어려웠다. */
  const span = dist
  const beginX = sx
  const beginY = sy
  const edgeX = sx + ux * dist
  const edgeY = sy + uy * dist

  /* 길목에 남의 배가 있으면 활처럼 휜다(휠 양은 missileBow가 잰다). 양 끝은
   * 그대로 두고 가운데 제어점만 수직으로 미는 이차 곡선이다. bow가 0이면 직선. */
  const bendX = (beginX + edgeX) / 2 - uy * bow
  const bendY = (beginY + edgeY) / 2 + ux * bow

  /* 선은 중심까지 잇지만 미사일 자체는 그 안쪽 구간만 오간다.
   *
   * 출발: 쏜 배의 글리프에 파묻힌 채로 시작하면 "방금 쐈다"가 안 보인다.
   *       0분일 때 이미 배 밖으로 나와 있게 한다.
   * 도착: 중심에 닿을 때까지 가면 맞는 배 밑에 깔려서 곧 터질 미사일이 안 보인다.
   *       중심에서 이 반경 안에 들면 도착으로 친다.
   *
   * 두 배가 붙어 있으면 반지름을 다 뺄 수 없으므로 각각 거리의 35%까지만 쓴다
   * (0.35 + 0.35 < 1이라 출발점이 도착점을 넘지 않는다). 가까운 두 배 사이에서는
   * 미사일이 다니는 구간이 그만큼 짧아지지만, 배에 겹치는 것보다는 낫다. */
  const launchAt = Math.min(MISSILE_LAUNCH_R, dist * 0.35)
  const arriveAt = dist - Math.min(MISSILE_ARRIVE_R, dist * 0.35)
  const tLaunch = launchAt / span
  const tArrive = arriveAt / span
  const tNow = tLaunch + (tArrive - tLaunch) * t
  // 꼬리는 쏜 배의 중심 너머로는 안 뻗는다.
  const tTail = Math.max(0, tNow - MISSILE_TAIL / span)

  const curve = (t0, t1, steps) => qPath(beginX, beginY, bendX, bendY, edgeX, edgeY, t0, t1, steps)
  const [cx, cy] = qPoint(beginX, beginY, bendX, bendY, edgeX, edgeY, tNow)
  const [tx, ty] = qPoint(beginX, beginY, bendX, bendY, edgeX, edgeY, tTail)

  const color = MISSILE_COLORS[missile.type] || '#ff2222'
  // 기체는 곡선의 접선 방향을 본다 — 휜 길에서도 코가 가는 쪽을 향한다.
  const angle =
    (Math.atan2(
      2 * (1 - tNow) * (bendY - beginY) + 2 * tNow * (edgeY - bendY),
      2 * (1 - tNow) * (bendX - beginX) + 2 * tNow * (edgeX - bendX),
    ) *
      180) /
    Math.PI
  const ghost = !!missile.stealth
  // 꼬리 그라디언트 id. 한 화면에 여러 발이라 겹치면 안 된다.
  const gid = `mtail-${String(missile.id).replace(/[^\w-]/g, '')}`

  return (
    <g style={{ pointerEvents: 'none' }} opacity={ghost ? 0.8 : 1}>
      <defs>
        {/* 꼬리는 뒤로 갈수록 투명해진다. 좌표를 못 박아야(userSpaceOnUse)
            기울어진 선에서도 그라디언트가 진행 방향을 따라간다. */}
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={tx} y1={ty} x2={cx} y2={cy}>
          <stop offset="0%" stopColor={color} stopOpacity="0" />
          <stop offset="55%" stopColor={color} stopOpacity="0.55" />
          <stop offset="100%" stopColor={color} stopOpacity="1" />
        </linearGradient>
        {/* 불꽃 심지. 바깥은 미사일 색이라도 안쪽은 하얗게 타야 불처럼 보인다. */}
        <linearGradient
          id={`${gid}-core`}
          gradientUnits="userSpaceOnUse"
          x1={tx}
          y1={ty}
          x2={cx}
          y2={cy}
        >
          <stop offset="0%" stopColor={color} stopOpacity="0" />
          <stop offset="70%" stopColor={color} stopOpacity="0.8" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.95" />
        </linearGradient>
      </defs>

      {/* 지나온 길·남은 길을 잇던 실선은 뺐다. 배 다섯 대에 미사일이 몇 발만
          떠도 맵이 선 뭉치가 돼서 정작 배가 안 보였다. 날아가는 미사일 자체(불꽃
          꼬리를 단 기체)는 그대로 있고, 그 꼬리가 어디서 오는 중인지도 말해준다.
          길 자체는 여전히 계산한다 — 미사일이 그 길을 따라 움직인다. */}

      {/* 엔진 화염. 세 겹이다 — 바깥으로 번지는 열, 몸통, 하얗게 타는 심지.
          한 겹짜리 가는 선일 땐 궤적선과 굵기가 비슷해서 "불꽃"으로 안 읽히고
          그냥 진한 선 토막처럼 보였다. */}
      <motion.g
        animate={{ opacity: [0.85, 1, 0.85] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path
          d={curve(tTail, tNow, 8)}
          fill="none"
          stroke={color}
          strokeOpacity={0.28}
          strokeWidth={11}
          strokeLinecap="round"
          style={{ filter: `blur(2.5px)` }}
        />
        <path
          d={curve(tTail, tNow, 8)}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={5.5}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 5px ${color})` }}
        />
        <path
          d={curve(tTail + (tNow - tTail) * 0.45, tNow, 6)}
          fill="none"
          stroke={`url(#${gid}-core)`}
          strokeWidth={2.2}
          strokeLinecap="round"
        />
      </motion.g>

      {/* 기체 — 가늘고 긴 다트. 뒤가 살짝 파여서(제비꼬리) 방향이 읽힌다. */}
      <g transform={`translate(${cx},${cy}) rotate(${angle})`}>
        <path
          d="M 9 0 L -4.8 -2.6 L -2.4 0 L -4.8 2.6 Z"
          fill={color}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
        <circle cx={1.8} cy={0} r={1.4} fill="#ffffff" opacity={0.9} />
      </g>

      {/* 요격탄. 표적(맞을 뻔한 배)에서 미사일을 향해 마주 날아간다.
          경로는 표적 배에서 미사일의 지금 위치까지 — 미사일이 움직이면 끝점도
          따라가서, 만나는 순간 둘이 한 점에 모인다. 직선이 아니라 활처럼 휘어
          미사일 궤적과 같은 말씨로 그린다. 색·굵기·깜빡임은 타겟팅 경보원
          (ShipGlyph의 빨간 원)과 같은 디자인이다. */}
      {missile.interceptedBy &&
        (() => {
          const idx = cx - toX
          const idy = cy - toY
          const idist = Math.hypot(idx, idy) || 1
          const iux = idx / idist
          const iuy = idy / idist
          // 가운데 제어점만 수직으로 민 이차 곡선. 미사일 길과 같은 문법이다.
          const ibx = (toX + cx) / 2 - iuy * (idist * 0.22)
          const iby = (toY + cy) / 2 + iux * (idist * 0.22)
          const tot = (missile.interceptAt ?? 0) - (missile.interceptStartAt ?? 0)
          const p = tot > 0 ? Math.min(1, Math.max(0, (now - missile.interceptStartAt) / tot)) : 0
          const pTail = Math.max(0, p - MISSILE_TAIL / idist)
          const iCurve = (t0, t1, steps) => qPath(toX, toY, ibx, iby, cx, cy, t0, t1, steps)
          const [ix, iy] = qPoint(toX, toY, ibx, iby, cx, cy, p)
          const [itx, ity] = qPoint(toX, toY, ibx, iby, cx, cy, pTail)
          const iang =
            (Math.atan2(
              2 * (1 - p) * (iby - toY) + 2 * p * (cy - iby),
              2 * (1 - p) * (ibx - toX) + 2 * p * (cx - ibx),
            ) *
              180) /
            Math.PI
          const iColor = '#ff2222'
          return (
            <g>
              <defs>
                {/* 여느 미사일 꼬리와 같은 그라디언트. 좌표는 요격탄 구간을 따른다. */}
                <linearGradient
                  id={`${gid}-i`}
                  gradientUnits="userSpaceOnUse"
                  x1={itx}
                  y1={ity}
                  x2={ix}
                  y2={iy}
                >
                  <stop offset="0%" stopColor={iColor} stopOpacity="0" />
                  <stop offset="55%" stopColor={iColor} stopOpacity="0.55" />
                  <stop offset="100%" stopColor={iColor} stopOpacity="1" />
                </linearGradient>
                <linearGradient
                  id={`${gid}-i-core`}
                  gradientUnits="userSpaceOnUse"
                  x1={itx}
                  y1={ity}
                  x2={ix}
                  y2={iy}
                >
                  <stop offset="0%" stopColor={iColor} stopOpacity="0" />
                  <stop offset="70%" stopColor={iColor} stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0.95" />
                </linearGradient>
              </defs>

              {/* 경보원과 같은 색·굵기·박동. 다만 0까지는 안 꺼진다 — 원은 배
                  옆에서 깜빡여도 자리를 알지만, 선은 꺼진 반 박자 동안 길이
                  통째로 사라져서 어디로 가는 중인지 놓친다. */}
              <motion.path
                d={iCurve(0, 1, 12)}
                fill="none"
                stroke={iColor}
                strokeWidth={1.5}
                animate={{ strokeOpacity: [0.7, 0.25, 0.7] }}
                transition={{ duration: 0.9, repeat: Infinity }}
              />

              {/* 요격탄도 미사일이다 — 불꽃 세 겹과 다트 기체를 여느 미사일과
                  똑같이 그린다. 색만 경보 빨강이다. */}
              <motion.g
                animate={{ opacity: [0.85, 1, 0.85] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              >
                <path
                  d={iCurve(pTail, p, 8)}
                  fill="none"
                  stroke={iColor}
                  strokeOpacity={0.28}
                  strokeWidth={11}
                  strokeLinecap="round"
                  style={{ filter: `blur(2.5px)` }}
                />
                <path
                  d={iCurve(pTail, p, 8)}
                  fill="none"
                  stroke={`url(#${gid}-i)`}
                  strokeWidth={5.5}
                  strokeLinecap="round"
                  style={{ filter: `drop-shadow(0 0 5px ${iColor})` }}
                />
                <path
                  d={iCurve(pTail + (p - pTail) * 0.45, p, 6)}
                  fill="none"
                  stroke={`url(#${gid}-i-core)`}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                />
              </motion.g>

              <g transform={`translate(${ix},${iy}) rotate(${iang})`}>
                <path
                  d="M 9 0 L -4.8 -2.6 L -2.4 0 L -4.8 2.6 Z"
                  fill={iColor}
                  style={{ filter: `drop-shadow(0 0 6px ${iColor})` }}
                />
                <circle cx={1.8} cy={0} r={1.4} fill="#ffffff" opacity={0.9} />
              </g>
            </g>
          )
        })()}
    </g>
  )
}

/* 나에게 날아오는 미사일. HUD의 격차 막대 바로 위에 붙는다.
 *
 * 예전엔 NAV 맵 아래에 있었다. 그런데 이건 지도를 보다가 알게 될 일이 아니라
 * 들어오자마자 알아야 하는 일이다 — 방어막을 살지 말지가 여기서 갈린다.
 * HUD 맨 위 함선 카드 다음, 순위 막대 앞이 그 자리다.
 *
 * 남들끼리 주고받는 건 안 싣는다. 내가 손쓸 게 없고, 맵에서 날아가는 걸 보면 된다. */
/* 미사일 내역. NAV 맨 위에 놓는다.
 *
 * 지금 날아가고 있는 것만 올린다 — 이미 끝난 건 안 올린다. 결과를 같이 두면
 * 줄마다 다른 종류의 말("막아냄", "-15")이 뜨는데, 정작 "빗나감"은 게임에
 * 없는 개념이었다(명중 판정 자체가 없다. combat.js resolveHit이 miss를 늘
 * false로 돌려준다 — status가 miss가 되는 건 착탄 순간에 대상 배가 사라졌을
 * 때뿐이다). 지금 하늘에 뭐가 떠 있는지만 말하는 판으로 둔다.
 *
 * 길어지면 이 상자 안에서만 스크롤한다 — 페이지가 통째로 길어지면 아래 맵이
 * 화면 밖으로 밀려서, "NAV 한 탭이 딱 들어가게" 재둔 계산(RouteMap의 fit)이
 * 무너진다. overscroll-contain은 상자 끝까지 굴렸을 때 그 힘이 페이지로
 * 넘어가는 걸 막는다. */
const MISSILE_LOG_MAX_H = 132

export function MissileLog({ missiles = [], fleet = [] }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const myUid = fleet.find((p) => p.isMe)?.uid ?? null

  /* 나에게 오고 있는 것부터 맨 위로. 그 안에서든 밖에서든 먼저 떨어질 것이
   * 위다 — 손을 써야 하는 순서가 그 순서다.
   *
   * 스텔스는 날아오는 동안 아예 목록에 없다(서버가 뺀다). 여기 뜨는 건 전부
   * "온다는 걸 알고 있는" 것들이다. */
  const ordered = useMemo(() => {
    const toMe = (m) => m.toUid === myUid
    return [...missiles].sort(
      (a, b) => Number(toMe(b)) - Number(toMe(a)) || a.impactAt - b.impactAt,
    )
  }, [missiles, myUid])
  const incomingCount = ordered.filter((m) => m.toUid === myUid).length

  if (!missiles.length) return null

  return (
    <div className="panel mb-2 overflow-hidden">
      <div className="flex items-baseline justify-between border-b border-white/8 px-3 py-2">
        <span className="text-[13px] font-bold tracking-wider text-orbit-cyan uppercase">
          미사일 내역
        </span>
        {/* 나에게 오는 게 있으면 그걸 먼저 말한다 — 총 몇 발인지보다 급하다. */}
        {incomingCount > 0 ? (
          <span className="num text-[11px] font-bold text-orbit-red">
            나에게 {incomingCount}발 오는 중
          </span>
        ) : (
          <span className="num text-[11px] text-orbit-dim">{missiles.length}발 날아가는 중</span>
        )}
      </div>
      <div
        className="divide-y divide-white/6 overflow-y-auto overscroll-contain"
        style={{ maxHeight: MISSILE_LOG_MAX_H }}
      >
        {ordered.map((m) => {
          const toMe = m.toUid === myUid
          const left = Math.max(0, Math.round((m.impactAt - now) / 1000))
          return (
            <div
              key={m.id}
              className={`flex items-center gap-2 px-3 py-1.5 text-[13px] ${
                toMe ? 'bg-orbit-red/10' : m.isMine ? '' : 'opacity-55'
              }`}
            >
              <span
                className="w-16 shrink-0 truncate text-[11px] font-bold"
                style={{ color: MISSILE_COLORS[m.type] ?? 'var(--color-orbit-cyan)' }}
              >
                {MISSILE_NAMES[m.type] ?? m.type}
              </span>
              <span className="min-w-0 flex-1 truncate text-orbit-text">
                {m.isMine ? '나' : m.fromNickname}
                <span className="mx-1 text-orbit-dim">→</span>
                {toMe ? '나' : m.toNickname}
                {m.interceptedBy && (
                  <span className="ml-1.5 text-[11px] font-bold text-emerald-400">요격 중</span>
                )}
              </span>
              {/* 요격탄이 마주 오는 미사일은 도착이 아니라 격추 시각이 끝이다. */}
              {m.interceptedBy ? (
                <span className="num shrink-0 whitespace-nowrap text-emerald-400">
                  {Math.max(0, Math.round((m.interceptAt - now) / 1000))
                    ? `${fmtEta(Math.max(0, Math.round((m.interceptAt - now) / 1000)))} 뒤 요격`
                    : '곧 요격'}
                </span>
              ) : (
                <span
                  className={`num shrink-0 whitespace-nowrap ${toMe ? 'text-orbit-red' : 'text-orbit-cyan'}`}
                >
                  {left ? `${fmtEta(left)} 뒤` : '곧 도착'}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function IncomingMissiles({ missiles = [], fleet = [] }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const me = fleet.find((p) => p.isMe)
  const incoming = me ? missiles.filter((m) => m.toUid === me.uid) : []
  if (!incoming.length) return null

  return (
    <div className="overflow-hidden rounded-control border-2 border-orbit-red/45 bg-orbit-red/8">
      <div className="flex items-center gap-2 border-b border-orbit-red/25 px-3 py-2">
        <Target className="h-4 w-4 text-orbit-red" />
        {/* 여기만 uppercase를 안 건다. 다른 제목은 전부 대문자로 세우지만
            APPROACHING은 덩어리가 너무 길어서 읽히기보다 소리치는 것처럼 보인다. */}
        <span className="text-[15px] font-bold tracking-wider text-orbit-red">
          Approaching {incoming.length}
        </span>
      </div>
      <div className="max-h-36 overflow-y-auto">
        {incoming.map((m) => {
          const eta = Math.max(0, Math.floor((m.impactAt - now) / 1000))
          const color = MISSILE_COLORS[m.type] || '#ff2222'
          return (
            <div
              key={m.id}
              className="flex items-center gap-2 border-b border-white/5 px-3 py-2 last:border-0"
            >
              <WeaponIcon
                type={m.type}
                className="h-5 w-5 shrink-0"
                style={{ color, filter: `drop-shadow(0 0 3px ${color})` }}
              />
              <span className="code shrink-0 text-[14px] font-bold" style={{ color }}>
                {MISSILE_NAMES[m.type] || m.type}
              </span>
              {/* 받는 쪽은 늘 나이므로 안 적는다. 누가 쐈는지만 적으면 된다. */}
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-orbit-text">
                {m.fromNickname}
                {m.interceptedBy && (
                  <span className="ml-1.5 text-[11px] font-bold text-emerald-400">요격 중</span>
                )}
              </span>
              {m.interceptedBy ? (
                <span className="code shrink-0 text-[14px] font-bold text-emerald-400">
                  {fmtEta(Math.max(0, Math.floor((m.interceptAt - now) / 1000)))} 뒤 요격
                </span>
              ) : (
                <span className="code shrink-0 text-[14px] font-bold text-orbit-red">
                  {fmtEta(eta)} 남음
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function RouteMap({ fleet, missiles = [], photos = {} }) {
  const [selectedUid, setSelectedUid] = useState(null)
  /* 지금 보고 있는 페이지. null이면 "아직 안 넘겨봤다"는 뜻이고, 그동안은 내
   * 배가 있는 페이지를 따라간다 — 열자마자 내가 안 보이면 소용이 없다. */
  const [pickedPage, setPickedPage] = useState(null)
  const [now, setNow] = useState(Date.now())
  /* 손가락을 따라 맵이 밀린 거리(px). 놓으면 0으로 돌아간다. */
  const [dragY, setDragY] = useState(0)
  const dragFrom = useRef(null)
  const dragged = useRef(false)

  /* 맵이 실제로 쓸 수 있는 세로 픽셀.
   *
   * 예전엔 폭 대비 고정 비율(360:600)로 높이를 잡았다. 그래서 세로로 긴 폰에선
   * 맵만으로 화면을 넘겨 페이지 전체가 스크롤됐고, 짧은 기기에선 아래가 비었다.
   * 남은 자리를 재서 그만큼만 쓴다 — 화면비가 어떻든 NAV 한 탭이 딱 들어간다. */
  const boxRef = useRef(null)
  const belowRef = useRef(null)
  /* 맵 위에 놓인 미사일 내역. 높이가 변하면 맵도 다시 재야 한다 — 안 그러면
   * 내역이 늘어난 만큼 맵이 화면 밖으로 밀린다. */
  const aboveRef = useRef(null)
  const [boxPx, setBoxPx] = useState(null)

  useLayoutEffect(() => {
    const fit = () => {
      const box = boxRef.current
      if (!box) return
      /* 문서 기준 위치로 잰다. 화면 기준(rect.top)으로 재면 스크롤이 생겼다
       * 없어질 때마다 값이 흔들려 높이가 요동친다. */
      const top = box.getBoundingClientRect().top + window.scrollY
      const below = belowRef.current?.offsetHeight ?? 0
      // 하단 탭바는 맵 아래에 자리를 차지한다. 본문의 아래 여백도 빼야 한다.
      const nav = document.querySelector('nav')?.offsetHeight ?? 0
      const main = box.closest('main')
      const padB = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0
      const gap = below ? 8 : 0
      /* 바닥값은 아주 낮게 둔다. 여기서 넉넉히 잡으면 가로로 누운 폰처럼 자리가
       * 정말 없는 기기에서 그만큼 넘쳐 다시 스크롤이 생긴다 — 좁으면 좁은 대로
       * 줄어들되 화면 밖으로는 안 나가는 쪽을 택했다. */
      setBoxPx(Math.max(120, Math.round(window.innerHeight - top - below - nav - padB - gap)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (belowRef.current) ro.observe(belowRef.current)
    if (aboveRef.current) ro.observe(aboveRef.current)
    window.addEventListener('resize', fit)
    window.addEventListener('orientationchange', fit)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', fit)
      window.removeEventListener('orientationchange', fit)
    }
  }, [])

  /* 서버 응답이 언제 것인지 기억해둔다. 그 이후로 흐른 시간만큼 공부 중인 배를
   * 더 밀어줘야 폴링 간격(20초) 동안 맵이 멈춰 보이지 않는다. */
  const fetchedAt = useRef(Date.now())
  useEffect(() => {
    fetchedAt.current = Date.now()
  }, [fleet])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const sorted = useMemo(() => {
    const secs = Math.max(0, (now - fetchedAt.current) / 1000)
    return [...fleet]
      .map((p) => {
        if (!p.isStudying) return p
        /* 공부하는 동안 잔고가 차오르면서 속도도 같이 오른다 — 서버와 같은 식으로
         * 구간 적분한다(orbitRules.js). */
        const gained = energyFor(secs / 60)
        return {
          ...p,
          energy: Math.min(MAX_ENERGY, (p.energy ?? 0) + gained),
          routePosition: p.routePosition + distanceFor(p.energy ?? 0, gained),
        }
      })
      .sort((a, b) => b.routePosition - a.routePosition)
  }, [fleet, now])

  if (!sorted.length) {
    return (
      <div className="panel flex flex-col items-center gap-3 p-10 text-center">
        <Target className="h-10 w-10 text-orbit-dim opacity-30" />
        <p className="text-[14px] tracking-widest text-orbit-dim">항해 중인 함선이 없습니다</p>
      </div>
    )
  }

  const myIdx = sorted.findIndex((p) => p.isMe)
  const me = myIdx >= 0 ? sorted[myIdx] : null

  // 맵 좌표계.
  const W = 360
  const PAD_X = 16
  /* 위아래 여백. 배 도형이 위로 얼마나 솟고 아래로 얼마나 늘어지는지에만 맞춘다.
   * 위쪽은 뱃머리(-15)와 등수 배지(-18)까지, 아래쪽은 이름(+30)과 에너지
   * 막대(+36)까지. */
  const TOP_PAD = 22
  const BOT_PAD = 46
  /* 한 장의 좌표 높이. 상자의 실제 가로세로비를 그대로 좌표로 옮겨서, 지도가
   * 상자를 여백 없이 꽉 채우게 한다(viewBox 비율 = 상자 비율이면 여백이 안 남는다).
   * 너무 납작해지면 배와 이름이 겹치므로 아래로는 W(정사각)까지만 줄인다 —
   * 가로로 누운 기기에선 대신 좌우에 여백이 조금 남는다. */
  const boxW = boxRef.current?.clientWidth || W
  const mapH = boxPx ? Math.max(W, Math.round((W * boxPx) / boxW)) : 600

  const trackTop = TOP_PAD
  const trackBot = mapH - BOT_PAD
  const trackLen = trackBot - trackTop

  const pageCount = Math.max(1, Math.ceil(sorted.length / PER_PAGE))
  const pageOf = (rank) => Math.floor(rank / PER_PAGE)
  const myPage = myIdx >= 0 ? pageOf(myIdx) : 0
  const page = Math.min(Math.max(0, pickedPage ?? myPage), pageCount - 1)

  /* 페이지마다 그 안의 1위·꼴찌를 위아래 끝에 세운다. 페이지가 달라도 높이가
   * 같아야 "쭉 이어진 한 줄"로 읽힌다 — 페이지 경계는 벽이 아니라 종잇장이다. */
  const pageRanges = Array.from({ length: pageCount }, (_, pg) => {
    const inPage = sorted.slice(pg * PER_PAGE, (pg + 1) * PER_PAGE)
    const ps = inPage.map((p) => p.routePosition)
    return { min: Math.min(...ps), max: Math.max(...ps) }
  })

  /** 페이지 안에서의 세로 좌표(겹침을 풀기 전). 전원이 같은 자리면 다 같이 꼭대기. */
  const yRaw = (rank) => {
    const { min, max } = pageRanges[pageOf(rank)]
    const sp = max - min
    return sp > 0 ? trackBot - ((sorted[rank].routePosition - min) / sp) * trackLen : trackTop
  }

  /* 배를 세로로만 세우면 순위가 붙어 있을 때 겹친다. 페이지 안에서 몇 줄로
   * 나눠 번갈아 놓는다. */
  const cols = Math.min(3, Math.max(2, Math.min(PER_PAGE, sorted.length)))
  const laneW = (W - PAD_X * 2) / cols
  const laneOf = (rank) => (rank % PER_PAGE) % cols
  const xPos = (rank) => PAD_X + laneW * laneOf(rank) + laneW / 2

  /* 배 한 척이 세로로 차지하는 자리. 위로는 등수 배지(-18), 아래로는 에너지
   * 막대(+36)까지가 한 몸이라 그만큼은 떨어져야 글자가 안 겹친다. */
  const MIN_GAP = 58

  /* 겹침 풀기.
   *
   * 줄(lane)이 셋뿐이라 한 장에 다섯 척이 오면 네 번째부터는 앞사람과 같은
   * 줄이다. 자리가 서로 다르면 높이로 갈리니 괜찮은데, 자리가 같으면 높이도
   * 같아져서 완전히 포개진다 — 초기화 직후가 딱 그 상황이다(전원 출발선).
   *
   * 줄마다 위에서부터 훑으며 최소 간격만큼 아래로 밀고, 밀다가 트랙 밖으로
   * 나가면 그 줄을 통째로 위로 끌어올려 담는다. 미는 순서가 원래 높이 순서라
   * 등수 순서는 그대로 남는다. */
  const yFixed = sorted.map((_, r) => yRaw(r))
  for (let pg = 0; pg < pageCount; pg++) {
    const last = Math.min((pg + 1) * PER_PAGE, sorted.length)
    for (let lane = 0; lane < cols; lane++) {
      const ranks = []
      for (let r = pg * PER_PAGE; r < last; r++) if (laneOf(r) === lane) ranks.push(r)
      if (ranks.length < 2) continue
      ranks.sort((a, b) => yFixed[a] - yFixed[b])
      for (let i = 1; i < ranks.length; i++) {
        yFixed[ranks[i]] = Math.max(yFixed[ranks[i]], yFixed[ranks[i - 1]] + MIN_GAP)
      }
      const over = yFixed[ranks[ranks.length - 1]] - trackBot
      if (over > 0) {
        const shift = Math.min(over, yFixed[ranks[0]] - trackTop)
        if (shift > 0) for (const r of ranks) yFixed[r] -= shift
      }
    }
  }
  const yInPage = (rank) => yFixed[rank]

  /* 긴 그림(전 페이지를 세로로 이은 캔버스) 위의 좌표. 배도 미사일도 전부
   * 여기에 한 번에 그리고, 화면은 지금 장만큼 밀어올려 창문으로 보여준다. */
  const gy = (rank) => pageOf(rank) * mapH + yInPage(rank)
  // 순위에서 사라진 배의 미사일이 드나드는 기준점(지금 장 한가운데).
  const viewTop = page * mapH

  const incomingUids = new Set(missiles.map((m) => m.toUid))

  /* 미사일 한 발이 그려질 두 끝점(가상 좌표). 순위에서 사라진 배는 지금 페이지
   * 한가운데에서 나가고 들어오는 것으로 친다 — 어디 있는지 알 수 없어서다. */
  const missileEnds = (m) => {
    const fi = sorted.findIndex((p) => p.uid === m.fromUid)
    const ti = sorted.findIndex((p) => p.uid === m.toUid)
    return {
      fi,
      ti,
      x1: fi >= 0 ? xPos(fi) : W / 2,
      y1: fi >= 0 ? gy(fi) : viewTop + mapH / 2,
      x2: ti >= 0 ? xPos(ti) : W / 2,
      y2: ti >= 0 ? gy(ti) : viewTop + mapH / 2,
    }
  }

  // 같은 선을 밟는 궤적끼리 옆으로 떼어 놓는다.
  const offsets = missileLanes(missiles, missileEnds)

  /* 궤적마다 길목의 배를 피해 얼마나 휠지. 옆으로 떼어 놓은(offsets) 뒤의
   * 자리에서 재야 실제로 그려지는 선 기준이 된다. 배 좌표는 가상 좌표 — 궤적은
   * 페이지를 넘어 날아가므로 모든 페이지의 배가 길목이 될 수 있다. */
  const shipPts = sorted.map((p, r) => ({ uid: p.uid, x: xPos(r), y: gy(r) }))
  const bows = new Map()
  for (const m of missiles) {
    const { fi, ti, x1, y1, x2, y2 } = missileEnds(m)
    if (fi < 0 && ti < 0) continue
    const o = offsets.get(m.id) ?? { ox: 0, oy: 0 }
    const others = shipPts.filter((s) => s.uid !== m.fromUid && s.uid !== m.toUid)
    bows.set(m.id, missileBow(x1 + o.ox, y1 + o.oy, x2 + o.ox, y2 + o.oy, others))
  }

  const selectedIdx = selectedUid ? sorted.findIndex((p) => p.uid === selectedUid) : -1

  /* 위아래로 쓸어 장 넘기기.
   *
   * 아이패드 홈화면처럼 맵이 손가락을 따라오다가, 놓을 때 충분히 끌었으면 다음
   * 장으로 넘어가고 아니면 제자리로 돌아온다. 방향은 화면을 미는 쪽이다 —
   * 위로 밀면 아래(다음) 장이 올라온다.
   *
   * 첫 장에서 더 위로, 끝 장에서 더 아래로는 갈 데가 없으므로 고무줄처럼 조금만
   * 끌린다. 갈 수 있는지 없는지가 손끝으로 먼저 느껴진다. */
  const onDragStart = (e) => {
    if (pageCount < 2) return
    dragFrom.current = { y: e.clientY, dy: 0, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onDragMove = (e) => {
    const from = dragFrom.current
    if (!from) return
    const raw = e.clientY - from.y
    // 손 떨림까지 드래그로 치면 배를 누를 수가 없다.
    if (!from.moved && Math.abs(raw) < 6) return
    from.moved = true
    const stuck = (page === 0 && raw > 0) || (page >= pageCount - 1 && raw < 0)
    from.dy = stuck ? raw * 0.25 : raw
    setDragY(from.dy)
  }

  const onDragEnd = () => {
    const from = dragFrom.current
    dragFrom.current = null
    setDragY(0)
    if (!from?.moved) return
    // 끌고 나서 손을 뗀 것이므로, 뒤따라오는 click은 "빈 곳 눌러 닫기"가 아니다.
    dragged.current = true
    if (from.dy <= -SWIPE_TRIGGER) setPickedPage(Math.min(pageCount - 1, page + 1))
    else if (from.dy >= SWIPE_TRIGGER) setPickedPage(Math.max(0, page - 1))
  }

  return (
    <div className="flex flex-col">
      <div ref={aboveRef}>
        <MissileLog missiles={missiles} fleet={fleet} />
      </div>
      {/* 손가락으로 위아래로 쓸어 페이지를 넘긴다(아이패드 홈화면처럼). 끄는
          동안 맵이 손가락을 따라오고, 충분히 끌었으면 놓을 때 다음 장으로 넘어간다.
          touch-action: none이라 이 안에서의 드래그는 브라우저가 안 가져간다 —
          안 그러면 페이지 스크롤과 장 넘기기가 동시에 일어나 둘 다 어정쩡해진다. */}
      <div
        /* select-none: 끌 때 이름·에너지 글자가 파랗게 잡히면 장을 넘긴 게 아니라
           글자를 긁은 것처럼 보인다. */
        ref={boxRef}
        className="relative touch-none overflow-hidden rounded-card border-2 border-orbit-cyan/35 bg-black/70 select-none"
        /* 재기 전 첫 그림에서만 옛 비율을 쓴다. 재고 나면 픽셀 높이로 못 박는다. */
        style={boxPx ? { height: boxPx } : { aspectRatio: `${W} / 600` }}
        onClick={() => {
          if (dragged.current) return void (dragged.current = false)
          setSelectedUid(null)
        }}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        {/* 별 배경. 좌표는 고정 계산이라 렌더마다 안 흔들린다.
              성기게 뿌리면 검은 판때기에 점 몇 개가 떠 있는 것처럼 보여서, 촘촘히
              깔고 크기·밝기를 흩는다. 몇 개는 크고 밝게 둬서 깊이가 생긴다. */}
        <div className="pointer-events-none absolute inset-0">
          {Array.from({ length: 120 }, (_, i) => {
            const big = i % 17 === 0
            const mid = !big && i % 5 === 0
            const size = big ? 2.5 : mid ? 1.5 : 1
            return (
              <div
                key={i}
                className="absolute rounded-full bg-white"
                style={{
                  width: size,
                  height: size,
                  left: `${(i * 37 + 13) % 100}%`,
                  top: `${(i * 61 + 7) % 100}%`,
                  opacity: big ? 0.5 : mid ? 0.28 : 0.08 + (i % 6) * 0.03,
                  boxShadow: big ? '0 0 3px rgba(255,255,255,0.7)' : undefined,
                }}
              />
            )
          })}
        </div>

        {/* 맵 아무 데나 누르면 열려 있던 상세가 닫힌다. 예전엔 × 를 정확히
              누르거나 같은 배를 다시 눌러야만 닫혀서, 빈 곳을 눌러도 안 닫혔다.
              배와 상세 패널은 아래에서 전파를 끊는다. */}
        {/* 맵은 페이지 수만큼 세로로 긴 그림 하나다. 뷰포트(위 상자)는 딱 한 장
            높이고, 이 긴 그림을 지금 장만큼 밀어올려 놓는다. 손으로 끌면 그림
            전체가 손가락을 따라오므로 옆 장의 배들이 실제로 딸려 들어온다 —
            장이 바뀌는 게 아니라 한 장짜리 창문으로 긴 그림을 옮겨 보는 것이다.
            translateY의 %는 자기 자신(긴 그림) 높이 기준이라 한 장 = 100/pageCount%. */}
        <div
          style={{
            transform: `translateY(calc(${(-page * 100) / pageCount}% + ${dragY}px))`,
            // 끌고 있는 동안은 즉각 따라오고, 놓으면 미끄러지듯 다음 장에 안착한다.
            transition: dragFrom.current ? 'none' : 'transform 300ms cubic-bezier(0.2,0.8,0.2,1)',
          }}
        >
          <svg
            viewBox={`0 0 ${W} ${mapH * pageCount}`}
            className="block w-full"
            /* 높이는 "한 장 × 장수"만큼. 상자는 한 장 높이라 나머지 장은 상자
               밖으로 나가 있다가 밀어올릴 때 들어온다. */
            style={{ height: boxPx ? boxPx * pageCount : undefined }}
            preserveAspectRatio="xMidYMid meet"
          >
            {/* 배는 전원 다 세운다. 긴 그림에 미리 다 그려져 있어야 끌다가
                옆 장이 들어올 때 배가 이미 거기 있다. */}
            {sorted.map((p, rank) => {
              return (
                <ShipGlyph
                  key={p.uid}
                  x={xPos(rank)}
                  y={gy(rank)}
                  color={glowColor(Math.max(0, p.energy ?? 0), p.isMe)}
                  baseColor={shipBaseColor(p.isMe)}
                  damage={damageOf(Math.max(0, p.energy ?? 0))}
                  rank={rank + 1}
                  isMe={p.isMe}
                  nickname={p.nickname}
                  photo={photos[p.uid]}
                  energy={p.energy ?? 0}
                  shields={p.shields ?? 0}
                  reflect={p.reflect ?? 0}
                  hasIncoming={incomingUids.has(p.uid)}
                  onClick={() => setSelectedUid(selectedUid === p.uid ? null : p.uid)}
                />
              )
            })}

            {selectedIdx >= 0 && (
              /* 패널은 그 배가 선 장 안에 가둔다(translate + 장 높이 클램프).
                 장 경계에 걸치게 두면 반쯤 잘린 채 보인다. */
              <g transform={`translate(0,${pageOf(selectedIdx) * mapH})`}>
                <Callout
                  ship={sorted[selectedIdx]}
                  x={xPos(selectedIdx)}
                  y={yInPage(selectedIdx)}
                  mapW={W}
                  mapH={mapH}
                  onClose={() => setSelectedUid(null)}
                />
              </g>
            )}

            {/* 미사일도 같은 긴 그림 위를 난다 — 다른 장 사람에게 가는 미사일은
                끌어 보면 실제로 그 장까지 이어져 날아가고 있다. */}
            <g>
              {missiles.map((m) => {
                const { fi, ti, x1, y1, x2, y2 } = missileEnds(m)
                if (fi < 0 && ti < 0) return null
                return (
                  <MissileTrail
                    key={m.id}
                    missile={m}
                    fromX={x1}
                    fromY={y1}
                    toX={x2}
                    toY={y2}
                    now={now}
                    offset={offsets.get(m.id)}
                    bow={bows.get(m.id) ?? 0}
                  />
                )
              })}
            </g>
          </svg>
        </div>
      </div>

      {/* 맵 아래에 오는 것들. 이 묶음의 높이를 재서 맵이 쓸 자리를 정한다. */}
      <div ref={belowRef}>
        {/* 페이지 넘기기.
         *
         * 아이콘 버튼으로 헤더에 끼워 넣었더니 손가락으로 누르기도 어렵고 눈에도
         * 안 띄었다. 맵 바로 아래에 큼직하게 둔다 — 어느 등수 구간으로 가는지도
         * 같이 적어서, 누르기 전에 어디로 가는지 알 수 있게 한다. */}
        {pageCount > 1 && (
          <div className="mt-2 flex items-stretch gap-2">
            <button
              onClick={() => setPickedPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-control border border-white/12 bg-white/5 text-orbit-text transition disabled:opacity-25"
            >
              <ChevronUp className="h-6 w-6" />
              <span className="num text-[15px] font-bold">
                {page === 0 ? '맨 위' : `${(page - 1) * PER_PAGE + 1}–${page * PER_PAGE}위`}
              </span>
            </button>

            <button
              onClick={() => me && setPickedPage(myPage)}
              className={`flex h-14 w-24 shrink-0 flex-col items-center justify-center rounded-control border transition ${
                page === myPage || !me
                  ? 'border-white/12 bg-black/50'
                  : 'border-orbit-cyan/40 bg-orbit-cyan/10'
              }`}
            >
              <span className="num text-[19px] leading-none font-extrabold text-orbit-cyan">
                {page + 1}
                <span className="text-[14px] font-bold text-orbit-dim">/{pageCount}</span>
              </span>
              <span className="mt-1 text-[12px] text-orbit-dim">
                {page === myPage || !me
                  ? `${page * PER_PAGE + 1}–${page * PER_PAGE + PER_PAGE}위`
                  : '내 위치로'}
              </span>
            </button>

            <button
              onClick={() => setPickedPage(Math.min(pageCount - 1, page + 1))}
              disabled={page >= pageCount - 1}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-control border border-white/12 bg-white/5 text-orbit-text transition disabled:opacity-25"
            >
              <span className="num text-[15px] font-bold">
                {page >= pageCount - 1
                  ? '맨 아래'
                  : `${(page + 1) * PER_PAGE + 1}–${Math.min((page + 2) * PER_PAGE, sorted.length)}위`}
              </span>
              <ChevronDown className="h-6 w-6" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 내 함선을 크게 보여주는 카드. HUD 맨 위에 온다. */
export function ShipHero({ ship, isStudying }) {
  const energy = Math.max(0, ship.energyBalance ?? 0)
  const speed = speedOf(energy)

  return (
    <div className="panel panel-cyan relative flex flex-col items-center overflow-hidden py-5">
      <Spaceship
        status={ship.status}
        isStudying={isStudying}
        shields={ship.shields ?? 0}
        energy={energy}
        size={150}
      />
      {/* 거리·속도·순위를 같은 크기·같은 파란색으로 나란히 둔다. 예전엔 순위만
          아래에 작은 회색 글씨로 따로 적혀 있어서 곁다리처럼 보였는데, 셋 다
          "내가 지금 어떤 상태인가"를 말하는 같은 급의 숫자다.

          1시간이면 3E, 에너지 1당 1/3광년이므로 최고속에서 정확히 1광년/시간이다.
          즉 ly/h가 곧 지금 속도다. 에너지가 바닥나면 0. */}
      <div className="mt-1 flex items-end justify-center gap-4 text-center">
        <div>
          <div className="num text-[30px] leading-none font-extrabold text-orbit-cyan neon">
            {Math.round(ship.routePosition * 100) / 100}
            <span className="ml-1 text-[15px] font-semibold text-orbit-cyan/70">ly</span>
          </div>
          <div className="mt-1 text-[13px] text-orbit-dim">이동 거리</div>
        </div>
        <div className="mb-[3px] h-8 w-px bg-white/12" />
        <div>
          <div className="num text-[30px] leading-none font-extrabold text-orbit-cyan neon">
            {speed.toFixed(2)}
            <span className="ml-1 text-[15px] font-semibold text-orbit-cyan/70">ly/h</span>
          </div>
          <div className="mt-1 text-[13px] text-orbit-dim">이동 속도</div>
        </div>
        <div className="mb-[3px] h-8 w-px bg-white/12" />
        <div>
          <div className="num text-[30px] leading-none font-extrabold text-orbit-cyan neon">
            {ship.currentRank}
            <span className="ml-1 text-[15px] font-semibold text-orbit-cyan/70">위</span>
          </div>
          <div className="mt-1 text-[13px] text-orbit-dim">순위</div>
        </div>
      </div>
    </div>
  )
}
