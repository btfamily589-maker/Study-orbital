import { useId } from 'react'
import { motion } from 'framer-motion'
import { MAX_SHIELDS, speedOf } from '../../lib/orbitRules'

/* Study Orbital의 시그니처 — 함선 SVG.
 *
 * 원본(TSX)에서 그대로 옮겼다. 병가(Sick Day) 오라만 뺐다 — 그 기능을 안 옮기기로 했다.
 *
 * 상태에 따라 색과 움직임이 바뀐다:
 *   normal(에너지 30E+)  청록, 천천히 위아래로 뜬다 — 최고속
 *   unstable(10~29E)     호박색, 살짝 흔들린다 — 눈에 띄게 느리다
 *   critical(10E 미만)   빨강, 떨린다 — 거의 멈춰 있다
 *
 * 공부 중(isStudying)이면 엔진 불꽃이 길어지고 빨라진다 — 화면만 봐도 지금
 * 누가 달리고 있는지 알 수 있게 하려는 것.
 */
export function Spaceship({
  status,
  isStudying = false,
  shields = 0,
  className = '',
  onClick,
  size = 180,
  destroyed = false,
  /** 에너지 잔고. 주면 항로맵의 배처럼 왼쪽부터 상한 만큼 빨갛게 물든다. */
  energy = null,
}) {
  const actualStatus = destroyed ? 'critical' : status

  const primaryColor = destroyed
    ? '#ff2222'
    : actualStatus === 'normal'
      ? '#00d4ff'
      : actualStatus === 'unstable'
        ? '#ff6b35'
        : '#ff3333'

  const darkColor = destroyed
    ? '#ff0000'
    : actualStatus === 'normal'
      ? '#00aaff'
      : actualStatus === 'unstable'
        ? '#ff4400'
        : '#cc0000'

  const glowColor = destroyed
    ? 'rgba(255,34,34,0.6)'
    : actualStatus === 'normal'
      ? 'rgba(0,212,255,0.6)'
      : actualStatus === 'unstable'
        ? 'rgba(255,107,53,0.6)'
        : 'rgba(255,50,50,0.6)'

  const isBroken = actualStatus === 'critical'
  const isUnstable = actualStatus === 'unstable'

  // 같은 화면에 함선이 여럿 뜨므로 그라디언트 id가 겹치면 안 된다.
  const uid = useId()
  const gradId = `shieldGrad-${uid}`
  const clipId = `shieldClip-${uid}`

  /* 방어막은 장수다. 껍질 두께로 보여주려고 비율로 바꾼다. */
  const shieldRatio = Math.max(0, Math.min(1, shields / MAX_SHIELDS))

  /* 항로맵의 배(ShipGlyph)와 같은 규칙 — 최고속이면 한 점도 안 붉고, 멈추면
   * 전부 빨갛다. 왼쪽부터 상한 만큼 빨강, 나머지는 청록. 홈·공부 화면의 큰
   * 배와 맵의 작은 배가 서로 다른 색으로 말하면 어느 쪽이 진짜인지 헷갈린다.
   * energy를 안 주는 화면(격추 연출 등)은 예전대로 상태색 한 가지로 칠한다. */
  const hurt =
    energy == null || destroyed ? null : Math.max(0, Math.min(1, 1 - speedOf(Math.max(0, energy))))
  const hurtGradId = `hurtGrad-${uid}`
  const paint = hurt == null ? primaryColor : `url(#${hurtGradId})`
  const glow =
    hurt == null
      ? glowColor
      : `rgba(${[0, 212, 255].map((v, i) => Math.round(v + ([255, 0, 0][i] - v) * hurt)).join(',')},0.6)`

  return (
    <motion.div
      onClick={onClick}
      className={`relative select-none ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={{ width: size, height: size }}
      animate={
        destroyed
          ? { x: [0, -2, 2, -1, 0], rotate: [-0.5, 0.5, -0.5, 0] }
          : isBroken
            ? { x: [0, -3, 3, -3, 0], rotate: [-1, 1, -1, 0] }
            : isStudying
              ? { y: [0, -4, 0] }
              : { y: [0, -6, 0], rotate: isUnstable ? [-0.5, 1, -1, 0.5, 0] : 0 }
      }
      transition={
        destroyed
          ? { duration: 2, repeat: Infinity, ease: 'easeInOut' }
          : isBroken
            ? { duration: 1.2, repeat: Infinity }
            : isStudying
              ? { duration: 2, repeat: Infinity, ease: 'easeInOut' }
              : {
                  y: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
                  rotate: { duration: 4, repeat: Infinity, ease: 'linear' },
                }
      }
      whileTap={onClick ? { scale: 0.92 } : undefined}
    >
      {/* 엔진 아래 번지는 빛 */}
      {!destroyed && (
        <motion.div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full blur-2xl"
          style={{ width: size * 0.5, height: size * 0.55, background: glow }}
          animate={{
            opacity: isStudying ? [0.4, 0.7, 0.4] : [0.2, 0.4, 0.2],
            scale: isStudying ? [1, 1.15, 1] : [0.9, 1.05, 0.9],
          }}
          transition={{ duration: isStudying ? 1.5 : 2.5, repeat: Infinity }}
        />
      )}

      {destroyed && (
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{ width: size * 0.6, height: size * 0.6, background: 'rgba(255,34,34,0.3)' }}
          animate={{ opacity: [0.2, 0.5, 0.2], scale: [0.9, 1.1, 0.9] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}

      <svg
        viewBox="0 0 200 230"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative z-10 h-full w-full"
        style={{ filter: `drop-shadow(0 0 12px ${glow})` }}
      >
        {hurt != null && (
          <defs>
            {/* 날개 끝(45~155)까지 걸쳐야 "배의 몇 할이 붉은가"가 눈금대로 읽힌다.
                같은 자리에 두 stop을 놓아 경계를 딱 끊는 것도 맵과 같다. */}
            <linearGradient
              id={hurtGradId}
              gradientUnits="userSpaceOnUse"
              x1="45"
              y1="0"
              x2="155"
              y2="0"
            >
              <stop offset="0%" stopColor="#ff0000" />
              <stop offset={`${hurt * 100}%`} stopColor="#ff0000" />
              <stop offset={`${hurt * 100}%`} stopColor="#00d4ff" />
              <stop offset="100%" stopColor="#00d4ff" />
            </linearGradient>
          </defs>
        )}
        {/* 동체 */}
        <path
          d="M100 15 L122 80 L128 145 L100 158 L72 145 L78 80 Z"
          fill={destroyed ? '#1a0808' : '#0d1b2a'}
          stroke={paint}
          strokeWidth={destroyed ? 1.5 : 2}
          strokeLinejoin="round"
          strokeDasharray={destroyed ? '6 3' : 'none'}
        />

        {/* 조종석 */}
        <path
          d="M100 38 L112 68 L100 85 L88 68 Z"
          fill={paint}
          fillOpacity={destroyed ? 0.05 : 0.15}
          stroke={paint}
          strokeWidth={destroyed ? 0.8 : 1.5}
        />
        <path
          d="M100 50 L106 66 L100 75 L94 66 Z"
          fill={paint}
          fillOpacity={destroyed ? 0.15 : 0.5}
        />
        {!destroyed && (
          <line
            x1="96"
            y1="62"
            x2="100"
            y2="58"
            stroke="white"
            strokeWidth="1"
            strokeOpacity="0.6"
            strokeLinecap="round"
          />
        )}

        {/* 날개 */}
        <path
          d="M78 100 L45 132 L45 148 L78 132 Z"
          fill={destroyed ? '#120606' : '#0a1628'}
          stroke={paint}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M122 100 L155 132 L155 148 L122 132 Z"
          fill={destroyed ? '#120606' : '#0a1628'}
          stroke={paint}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />

        {!destroyed && (
          <>
            <line
              x1="85"
              y1="126"
              x2="55"
              y2="140"
              stroke={paint}
              strokeWidth="0.7"
              strokeOpacity="0.4"
            />
            <line
              x1="115"
              y1="126"
              x2="145"
              y2="140"
              stroke={paint}
              strokeWidth="0.7"
              strokeOpacity="0.4"
            />
          </>
        )}

        {/* 엔진 노즐 */}
        <path
          d="M87 150 L96 153 L96 166 L87 162 Z"
          fill="#060e1a"
          stroke={paint}
          strokeWidth="1.2"
        />
        <path
          d="M113 150 L104 153 L104 166 L113 162 Z"
          fill="#060e1a"
          stroke={paint}
          strokeWidth="1.2"
        />

        <line
          x1="95"
          y1="85"
          x2="105"
          y2="85"
          stroke={paint}
          strokeWidth="0.8"
          strokeOpacity={destroyed ? 0.15 : 0.5}
        />
        <line
          x1="90"
          y1="110"
          x2="110"
          y2="110"
          stroke={paint}
          strokeWidth="0.8"
          strokeOpacity={destroyed ? 0.1 : 0.3}
        />

        {/* 엔진 불꽃. 공부 중이면 길고 빠르게. */}
        {!destroyed && !isBroken && (
          <motion.g>
            <motion.path
              d={isStudying ? 'M90 166 L100 215 L110 166 Z' : 'M93 166 L100 195 L107 166 Z'}
              fill={paint}
              animate={{
                scaleY: isStudying ? [1, 1.3, 0.9, 1.2, 1] : [1, 1.2, 0.85, 1.1, 1],
                opacity: [0.9, 1, 0.7, 1, 0.9],
              }}
              transition={{ duration: isStudying ? 0.8 : 0.6, repeat: Infinity }}
              style={{ originY: '166px', originX: '100px' }}
            />
            <motion.path
              d={isStudying ? 'M94 166 L100 200 L106 166 Z' : 'M95 166 L100 185 L105 166 Z'}
              fill="white"
              animate={{ scaleY: [1, 1.3, 0.9, 1.2, 1] }}
              transition={{ duration: isStudying ? 0.8 : 0.6, repeat: Infinity, delay: 0.04 }}
              style={{ originY: '166px', originX: '100px' }}
            />
            {isStudying && (
              <>
                <motion.path
                  d="M88 166 L84 190 L92 166 Z"
                  fill={darkColor}
                  fillOpacity="0.6"
                  animate={{ scaleY: [1, 1.2, 0.8, 1], opacity: [0.6, 0.9, 0.4, 0.7] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  style={{ originY: '166px', originX: '88px' }}
                />
                <motion.path
                  d="M112 166 L116 190 L108 166 Z"
                  fill={darkColor}
                  fillOpacity="0.6"
                  animate={{ scaleY: [1, 1.2, 0.8, 1], opacity: [0.6, 0.9, 0.4, 0.7] }}
                  transition={{ duration: 1, repeat: Infinity, delay: 0.06 }}
                  style={{ originY: '166px', originX: '112px' }}
                />
              </>
            )}
          </motion.g>
        )}

        {destroyed && (
          <motion.path
            d="M93 166 L100 180 L107 166 Z"
            fill="#ff2222"
            fillOpacity="0.3"
            animate={{ opacity: [0.1, 0.3, 0.1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}

        {/* 방어막. 남은 양에 따라 진해지고, 육각 격자가 켜진다. */}
        {shields > 0 && !destroyed && (
          <>
            <defs>
              <radialGradient id={gradId} cx="50%" cy="50%" r="50%">
                {/* 같은 자리에 두 stop을 겹쳐 띠를 또렷하게 끊는다. 부드럽게
                    번지면 방어막이 어디까지인지 안 보였다. */}
                <stop offset="0%" stopColor="#00d4ff" stopOpacity="0" />
                <stop offset="62%" stopColor="#00d4ff" stopOpacity="0" />
                <stop offset="62%" stopColor="#00d4ff" stopOpacity={0.02 + shieldRatio * 0.06} />
                <stop offset="86%" stopColor="#00d4ff" stopOpacity={0.02 + shieldRatio * 0.06} />
                <stop offset="86%" stopColor="#00d4ff" stopOpacity={0.05 + shieldRatio * 0.18} />
                <stop offset="100%" stopColor="#00d4ff" stopOpacity={0.05 + shieldRatio * 0.18} />
              </radialGradient>
              <clipPath id={clipId}>
                <ellipse cx="100" cy="100" rx="90" ry="95" />
              </clipPath>
            </defs>

            <motion.ellipse
              cx="100"
              cy="100"
              rx="90"
              ry="95"
              fill={`url(#${gradId})`}
              stroke="#00d4ff"
              strokeWidth={0.8 + shieldRatio * 1.2}
              strokeOpacity={0.15 + shieldRatio * 0.4}
              animate={{
                strokeOpacity: [
                  0.15 + shieldRatio * 0.4,
                  0.25 + shieldRatio * 0.55,
                  0.15 + shieldRatio * 0.4,
                ],
                scale: [1, 1.008, 1],
              }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              style={{ originX: '100px', originY: '100px' }}
            />

            <g clipPath={`url(#${clipId})`} opacity={0.15 + shieldRatio * 0.35}>
              {Array.from({ length: 12 }).map((_, i) => {
                const angle = (i * 30 * Math.PI) / 180
                const cx = 100 + Math.cos(angle) * 52
                const cy = 100 + Math.sin(angle) * 55
                const pts = hexPoints(cx, cy, 18)
                return (
                  <motion.polygon
                    key={i}
                    points={pts}
                    fill="none"
                    stroke="#00d4ff"
                    strokeWidth={0.6}
                    animate={{ strokeOpacity: [0.2, 0.5, 0.2] }}
                    transition={{ duration: 2 + (i % 3) * 0.5, repeat: Infinity, delay: i * 0.15 }}
                  />
                )
              })}
              {Array.from({ length: 6 }).map((_, i) => {
                const angle = ((i * 60 + 15) * Math.PI) / 180
                const cx = 100 + Math.cos(angle) * 28
                const cy = 100 + Math.sin(angle) * 30
                const pts = hexPoints(cx, cy, 14)
                return (
                  <motion.polygon
                    key={`inner-${i}`}
                    points={pts}
                    fill="none"
                    stroke="#00d4ff"
                    strokeWidth={0.4}
                    animate={{ strokeOpacity: [0.15, 0.4, 0.15] }}
                    transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.25 + 0.5 }}
                  />
                )
              })}
            </g>

            {/* 방어막이 넉넉할 때만 도는 바깥 링 */}
            {shields >= 2 && (
              <motion.ellipse
                cx="100"
                cy="100"
                rx="83"
                ry="88"
                fill="none"
                stroke="#00d4ff"
                strokeWidth={0.4 + shieldRatio * 0.6}
                strokeDasharray="4 8"
                animate={{
                  strokeDashoffset: [0, -24],
                  strokeOpacity: [
                    0.05 + shieldRatio * 0.15,
                    0.1 + shieldRatio * 0.2,
                    0.05 + shieldRatio * 0.15,
                  ],
                }}
                transition={{
                  strokeDashoffset: { duration: 10, repeat: Infinity, ease: 'linear' },
                  strokeOpacity: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
                }}
              />
            )}
          </>
        )}

        {/* 격추 — 파편과 경고 */}
        {destroyed && (
          <>
            <motion.line
              x1="80"
              y1="85"
              x2="92"
              y2="100"
              stroke="#ff2222"
              strokeWidth="1.5"
              strokeOpacity="0.6"
              animate={{ opacity: [0, 0.6, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <motion.line
              x1="115"
              y1="95"
              x2="128"
              y2="115"
              stroke="#ff2222"
              strokeWidth="1"
              strokeOpacity="0.5"
              animate={{ opacity: [0, 0.5, 0] }}
              transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
            />
            <motion.line
              x1="88"
              y1="130"
              x2="96"
              y2="145"
              stroke="#ff4444"
              strokeWidth="1.2"
              strokeOpacity="0.4"
              animate={{ opacity: [0, 0.4, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, delay: 1 }}
            />
            <motion.circle
              cx="82"
              cy="95"
              r="2"
              fill="#ff4400"
              animate={{ opacity: [0, 1, 0], scale: [0.5, 1.5, 0.5] }}
              transition={{ duration: 0.8, repeat: Infinity, delay: 0.2 }}
            />
            <motion.circle
              cx="120"
              cy="110"
              r="1.5"
              fill="#ff6600"
              animate={{ opacity: [0, 1, 0], scale: [0.5, 1.5, 0.5] }}
              transition={{ duration: 1, repeat: Infinity, delay: 0.6 }}
            />
            <motion.circle
              cx="95"
              cy="140"
              r="1.8"
              fill="#ff2222"
              animate={{ opacity: [0, 0.8, 0], scale: [0.5, 1.5, 0.5] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: 1.2 }}
            />
            <motion.path
              d="M100 115 L114 140 L86 140 Z"
              fill="#ff2222"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 0.6, repeat: Infinity }}
            />
            <text
              x="100"
              y="133"
              textAnchor="middle"
              fontSize="10"
              fill="white"
              fontWeight="bold"
              opacity="0.9"
            >
              !
            </text>
          </>
        )}

        {/* 위험(격추 직전) */}
        {isBroken && !destroyed && (
          <>
            <motion.line
              x1="82"
              y1="80"
              x2="92"
              y2="92"
              stroke="#ff2222"
              strokeWidth="1"
              strokeOpacity="0.5"
              animate={{ opacity: [0, 0.5, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <motion.line
              x1="110"
              y1="95"
              x2="120"
              y2="110"
              stroke="#ff4444"
              strokeWidth="0.8"
              strokeOpacity="0.4"
              animate={{ opacity: [0, 0.4, 0] }}
              transition={{ duration: 2, repeat: Infinity, delay: 0.7 }}
            />
            <motion.path
              d="M100 115 L114 140 L86 140 Z"
              fill="#ff3333"
              animate={{ opacity: [1, 0.2, 1] }}
              transition={{ duration: 0.4, repeat: Infinity }}
            />
          </>
        )}

        {/* 불안정 — 튀는 불꽃 */}
        {isUnstable && !destroyed && (
          <>
            <motion.circle
              cx="82"
              cy="118"
              r="2"
              fill="#ff6b35"
              animate={{ opacity: [0, 1, 0], scale: [0.5, 1.5, 0.5] }}
              transition={{ duration: 0.6, repeat: Infinity, delay: 0.1 }}
            />
            <motion.circle
              cx="120"
              cy="130"
              r="1.5"
              fill="#ff6b35"
              animate={{ opacity: [0, 1, 0], scale: [0.5, 1.5, 0.5] }}
              transition={{ duration: 0.8, repeat: Infinity, delay: 0.3 }}
            />
          </>
        )}
      </svg>
    </motion.div>
  )
}

/** 중심 (cx,cy), 반지름 r인 정육각형의 points 문자열 */
function hexPoints(cx, cy, r) {
  return Array.from({ length: 6 })
    .map((_, j) => {
      const a = ((j * 60 - 30) * Math.PI) / 180
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
    })
    .join(' ')
}
