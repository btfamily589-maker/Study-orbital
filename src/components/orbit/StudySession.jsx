import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion'
import { Crosshair, Navigation, Shield, Square, Target, Zap } from 'lucide-react'
import { Spaceship } from './Spaceship'
import { IncomingMissiles } from './RouteMap'
import {
  MAX_ENERGY,
  MAX_SESSION_MINUTES,
  MAX_SHIELDS,
  distanceFor,
  energyFor,
  speedOf,
  statusOf,
} from '../../lib/orbitRules'

/* 공부 중 화면 — 원본 study-session.tsx를 옮겼다.
 *
 * 세션이 도는 동안엔 다른 걸 볼 이유가 없으므로 Orbit 탭 전체를 이 화면이
 * 차지한다. 원본도 별도 화면이었다.
 *
 * 화면이 하는 일은 두 가지다.
 * 1) 지금 얼마나 벌고 있는지 실시간으로 보여준다 — 에너지와 나아간 거리.
 * 2) 공부 중이라는 느낌을 준다 — 워프 광선이 흐르고, 엔진 화염이 길어지고,
 *    안정성이 낮으면 그 속도가 눈에 띄게 느려진다.
 *
 * 시간 계산의 최종 판단은 서버가 한다. 여기 타이머는 서버가 준 시작 시각에서
 * 매초 다시 계산한다 — 1씩 더하면 탭이 백그라운드로 갈 때 브라우저가 타이머를
 * 늦춰서 실제보다 적게 나온다.
 */

/** 안정성 1포인트를 올리는 데 드는 에너지. 서버 engine.js와 같은 값. */

/* 밀어서 정지. 누르는 버튼이었을 땐 주머니 속에서 눌리거나 손이 스쳐 세션이
 * 끊기는 일이 있었다 — 손잡이를 오른쪽 끝까지 밀어야 선다. */
const STOP_KNOB = 48

function SlideToStop({ onStop }) {
  const trackRef = useRef(null)
  const [max, setMax] = useState(0)
  const x = useMotionValue(0)
  // 미는 만큼 안내 문구는 사라지고, 지나온 자리엔 물이 차오른다.
  const hintOpacity = useTransform(x, [0, Math.max(1, max * 0.55)], [1, 0])
  const fillWidth = useTransform(x, (v) => v + STOP_KNOB + 8)

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const measure = () => setMax(el.clientWidth - STOP_KNOB - 8)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  return (
    <div
      ref={trackRef}
      className="relative h-14 w-full max-w-xs overflow-hidden rounded-full border border-orbit-cyan/40 bg-orbit-cyan/10"
      style={{ boxShadow: '0 0 30px rgba(0,212,255,0.18)' }}
    >
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full bg-orbit-cyan/20"
        style={{ width: fillWidth }}
      />
      <motion.span
        className="pointer-events-none absolute inset-0 flex items-center justify-center text-[14px] font-bold tracking-widest text-orbit-cyan"
        style={{ opacity: hintOpacity }}
      >
        밀어서 정지 ›››
      </motion.span>
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: Math.max(0, max) }}
        dragElastic={0.02}
        dragMomentum={false}
        dragSnapToOrigin
        style={{ x }}
        onDragEnd={() => {
          if (max > 0 && x.get() >= max * 0.85) onStop()
        }}
        className="absolute top-1 left-1 grid h-12 w-12 cursor-grab place-items-center rounded-full bg-orbit-cyan text-orbit-bg active:cursor-grabbing"
        whileTap={{ scale: 1.05 }}
      >
        <Square className="h-5 w-5 fill-current" />
      </motion.div>
    </div>
  )
}

const fmtClock = (sec) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(Math.floor(sec / 3600))}:${p(Math.floor((sec % 3600) / 60))}:${p(sec % 60)}`
}

/* 워프 광선. 안정성이 낮으면 느리고 짧게 흐른다 — 엔진이 시원찮다는 걸
 * 숫자 말고 움직임으로 보여준다. */
function WarpStreaks({ speed }) {
  const streaks = useRef(null)
  if (!streaks.current) {
    streaks.current = Array.from({ length: 22 }, (_, i) => ({
      id: i,
      left: (i * 4.6 + 2) % 100,
      base: 0.4 + (i % 5) * 0.15,
      len: 40 + (i % 4) * 25,
      cyan: i % 3 === 0,
      delay: (i * 0.12) % 1.2,
    }))
  }
  const f = Math.max(0.15, speed)

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {streaks.current.map((s) => (
        <motion.div
          key={s.id}
          className="absolute rounded-full"
          style={{
            width: 1,
            height: s.len * Math.max(0.3, f),
            left: `${s.left}%`,
            top: -120,
            background: s.cyan
              ? `rgba(0,212,255,${0.3 + f * 0.4})`
              : `rgba(255,255,255,${0.12 + f * 0.2})`,
          }}
          animate={{ y: '130vh' }}
          transition={{
            duration: s.base / f,
            repeat: Infinity,
            ease: 'linear',
            delay: s.delay,
          }}
        />
      ))}
    </div>
  )
}

/* 계기판. 지금 상태(에너지·속도·방어막)와 이번 세션에 번 것(에너지·거리)을
 * 한 상자에 담는다. 따로 떼어 놓으면 화면이 위아래로 길어지기만 하고, 둘 다
 * "지금 어떻게 가고 있나"를 말하는 숫자라 같이 봐야 뜻이 산다. */
function StatusPanel({ energy, speed, shields, gainedEnergy, gainedDistance }) {
  const tone = (ratio) =>
    ratio >= 1
      ? 'var(--color-orbit-cyan)'
      : ratio >= 0.34
        ? 'var(--color-orbit-amber)'
        : 'var(--color-orbit-red)'

  const cell = (label, Icon, value, suffix, color, bar) => (
    <div className="px-1 text-center">
      <div className="mb-1 flex items-center justify-center gap-1">
        <Icon className="h-3.5 w-3.5" style={{ color }} />
        <span className="text-[12px] font-bold text-orbit-dim">{label}</span>
      </div>
      <div className="num text-[21px] leading-none font-extrabold" style={{ color }}>
        {value}
        {suffix && (
          <span className="ml-0.5 text-[12px] font-semibold text-orbit-dim">{suffix}</span>
        )}
      </div>
      {bar !== null && bar !== undefined && (
        <div className="mx-auto mt-1.5 h-1 max-w-[64px] overflow-hidden rounded-full bg-black">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.max(0, Math.min(100, bar))}%`, background: color }}
          />
        </div>
      )}
    </div>
  )

  const cyan = 'var(--color-orbit-cyan)'
  const color = tone(speed)

  return (
    <div
      className="w-full max-w-xs rounded-control border-2 border-orbit-cyan/45 bg-black/70 py-4"
      style={{ boxShadow: '0 0 14px rgba(0,212,255,0.18)' }}
    >
      {/* 지금 상태. 속도는 에너지에서 나온다 — 두 칸이 같은 색으로 움직인다. */}
      <div className="grid grid-cols-3">
        {cell('에너지', Zap, Math.round(energy), 'E', color, (energy / MAX_ENERGY) * 100)}
        {cell('속도', Navigation, speed.toFixed(2), 'ly/h', color, speed * 100)}
        {cell('방어막', Shield, shields, `/${MAX_SHIELDS}`, cyan, null)}
      </div>

      {/* 위(지금 상태)와 아래(이번에 번 것)를 가르는 선. 상자 폭을 꽉 채워
          그어야 두 덩어리로 읽힌다. */}
      <div className="my-3.5 h-px bg-orbit-cyan/35" />

      {/* 이번 세션에 번 것 */}
      <div className="grid grid-cols-2">
        {cell(
          '에너지',
          Zap,
          `+${gainedEnergy < 1 ? gainedEnergy.toFixed(2) : gainedEnergy.toFixed(1)}`,
          'E',
          cyan,
          null,
        )}
        {cell(
          '거리',
          Target,
          `+${gainedDistance < 1 ? gainedDistance.toFixed(2) : gainedDistance.toFixed(1)}`,
          'ly',
          cyan,
          null,
        )}
      </div>
    </div>
  )
}

export function StudySession({
  session,
  ship,
  fleet = [],
  missiles = [],
  onCancel,
  onFinish,
  onStop,
  finishing,
  busy,
  error,
  /** 화면 전환 연출이 도는 중 — 계기는 빠지고 함선만 남는다. */
  dim = false,
}) {
  const [now, setNow] = useState(Date.now())
  const [confirmCancel, setConfirmCancel] = useState(false)
  /* 정지 순간의 시각. 정지하면 시계·수치·함선이 그 자리에서 멈춘다 —
   * 별도 화면으로 넘어가지 않는다. 다시 항해하면 실제 경과 시간으로 돌아온다. */
  const [pausedAt, setPausedAt] = useState(null)
  useEffect(() => {
    setPausedAt(finishing ? Date.now() : null)
  }, [finishing])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const seconds = Math.max(
    0,
    Math.floor(((pausedAt ?? now) - new Date(session.startedAt).getTime()) / 1000),
  )
  const minutes = Math.max(1, Math.floor(seconds / 60))

  /* 다섯 시간이 넘으면 이 세션은 무효다(서버가 판정한다). 넘기 전부터 알려줘야
   * 손을 쓸 수 있으므로 30분 전부터 띄운다 — 넘고 나서 알려주는 건 통보지
   * 경고가 아니다. */
  const overlong = minutes > MAX_SESSION_MINUTES
  const nearingCap = !overlong && minutes > MAX_SESSION_MINUTES - 30

  /* 공부하는 동안 잔고가 차오르고, 속도도 같이 오른다. 미사일을 맞으면 서버가
   * 잔고를 깎으므로(다음 폴링 때 내려온다) 화면의 속도도 곧바로 떨어진다. */
  const baseEnergy = Math.max(0, ship.energyBalance ?? 0)
  // 무효가 된 세션은 아무것도 안 준다 — 화면에도 그렇게 보여야 한다.
  const gainedEnergy = overlong ? 0 : energyFor(seconds / 60)
  const energy = Math.min(MAX_ENERGY, baseEnergy + gainedEnergy)
  const speed = speedOf(energy)
  const shields = ship.shields ?? 0
  const gainedDistance = distanceFor(baseEnergy, gainedEnergy)

  const energyFull = (ship.energyBalance ?? 0) >= (ship.maxEnergy ?? 50)

  /* 앞뒤 사람과의 격차. 이게 있어야 "조금만 더 하면 제친다"가 보인다. */
  const neighbours = useMemo(() => {
    const sorted = [...fleet].sort((a, b) => b.routePosition - a.routePosition)
    const i = sorted.findIndex((p) => p.isMe)
    if (i < 0) return { ahead: null, behind: null }
    const mine = sorted[i].routePosition
    const mk = (p, d) => (p ? { nickname: p.nickname, gap: Math.abs(d).toFixed(2) } : null)
    return {
      ahead: mk(sorted[i - 1], sorted[i - 1] ? sorted[i - 1].routePosition - mine : 0),
      behind: mk(sorted[i + 1], sorted[i + 1] ? mine - sorted[i + 1].routePosition : 0),
    }
  }, [fleet])

  const accent = 'var(--color-orbit-cyan)'

  /* ── 항해 중 화면 ── */
  return (
    <div className="relative -mx-5 min-h-[calc(100vh-12rem)] overflow-hidden px-5 pt-6 pb-12">
      {/* 정지하면 워프가 뚝 꺼지지 않고 1초쯤에 걸쳐 잦아든다 — 배도 배경도
          같이 멈추는 느낌을 준다. 재개하면 다시 차오른다. */}
      <AnimatePresence>
        {speed > 0 && !finishing && (
          <motion.div
            key="warp"
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.0, ease: 'easeOut' }}
          >
            <WarpStreaks speed={speed} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 요소 사이 간격(gap-7)과 화면 위아래 여백을 넉넉히 잡는다. 시계·배·수치·
          정지 버튼이 서로 붙어 있으면 계기판이 아니라 목록처럼 보인다. */}
      <div className="relative flex flex-col items-center gap-7">
        {/* 공부하는 동안에도 미사일은 날아온다. 맞으면 그때부터 느려지므로,
            방어막을 살지 지금 접을지 정하려면 여기서 보여야 한다 — 예전엔 맵으로
            나가야만 보였고, 나가면 타이머 화면을 떠나야 했다. */}
        <motion.div
          className="flex w-full flex-col items-center gap-7"
          initial={false}
          animate={{ opacity: dim ? 0 : 1 }}
          transition={{ duration: dim ? 0.42 : 0.45, ease: 'easeOut' }}
        >
          <div className="w-full">
            <IncomingMissiles missiles={missiles} fleet={fleet} />
          </div>

          {/* 에너지가 다 찼다는 건 지금 화면에서 제일 중요한 소식이다 — 더 해봐야
            안 쌓이므로 맨 위에서 알린다. */}
          {energyFull && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-xs rounded-control border border-orbit-amber/40 bg-orbit-amber/10 p-3 text-center"
            >
              <div className="flex items-center justify-center gap-2">
                <Zap className="h-4 w-4 text-orbit-amber" />
                <span className="text-[15px] font-bold text-orbit-amber">에너지가 다 찼습니다</span>
              </div>
              <p className="mt-1 text-[13px] text-orbit-dim">
                {ship.maxEnergy}/{ship.maxEnergy}E — 더 모아도 저장되지 않습니다
              </p>
            </motion.div>
          )}

          <div className="text-center">
            {/* 라벨은 뺐다. 큰 숫자가 00:42:31 모양이면 시계라는 건 보면 안다. */}
            <div
              className="code text-[46px] leading-none tracking-wider text-orbit-text"
              style={{
                textShadow: '0 0 30px rgba(0,212,255,0.5)',
              }}
            >
              {fmtClock(seconds)}
            </div>
          </div>

          {/* 다섯 시간이 넘으면 이 세션은 통째로 버려진다. 넘고 나서 알려주면
            통보라, 30분 전부터 띄운다. */}
          {(nearingCap || overlong) && (
            <div
              className={`w-full max-w-xs rounded-control border px-3 py-2.5 text-center text-[13px] leading-relaxed ${
                overlong
                  ? 'border-orbit-amber/40 bg-orbit-amber/10 text-orbit-amber'
                  : 'border-white/15 bg-white/5 text-orbit-dim'
              }`}
            >
              {overlong ? (
                <>
                  <b>{MAX_SESSION_MINUTES / 60}시간이 넘어 이 세션은 기록되지 않습니다.</b>
                  <br />
                  정지를 누르고 다시 시작해 주세요.
                </>
              ) : (
                <>
                  {MAX_SESSION_MINUTES / 60}시간이 넘으면 이 세션은 기록되지 않습니다 (
                  <span className="num">{MAX_SESSION_MINUTES - minutes}분</span> 남음)
                </>
              )}
            </div>
          )}
        </motion.div>

        {/* 홈 계기판의 함선과 같은 layoutId — 화면이 바뀌면 이 자리로 날아온다.
            연출 중에도 사라지지 않으므로 함선은 한 마리가 계속 이어진다. */}
        <motion.div
          layoutId="my-ship-transit"
          transition={{ layout: { type: 'tween', duration: 1.0, ease: [0.3, 0, 0.2, 1] } }}
        >
          <Spaceship
            status={statusOf(energy)}
            isStudying={energy > 0 && !finishing}
            shields={shields}
            energy={energy}
            size={140}
          />
        </motion.div>

        <motion.div
          className="flex w-full flex-col items-center gap-7"
          initial={false}
          animate={{ opacity: dim ? 0 : 1 }}
          transition={{ duration: dim ? 0.42 : 0.45, ease: 'easeOut' }}
        >
          {/* 앞뒤 사람과의 격차 */}
          {(neighbours.ahead || neighbours.behind) && (
            <div className="flex w-full max-w-xs items-center justify-between text-[14px]">
              {neighbours.ahead ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-orbit-dim">▲</span>
                  <span className="font-bold text-orbit-text">{neighbours.ahead.nickname}</span>
                  <span className="num font-bold text-orbit-cyan">+{neighbours.ahead.gap}</span>
                </div>
              ) : (
                <div />
              )}
              {neighbours.behind ? (
                <div className="flex items-center gap-1.5">
                  <span className="num font-bold text-orbit-amber">−{neighbours.behind.gap}</span>
                  <span className="font-bold text-orbit-text">{neighbours.behind.nickname}</span>
                  <span className="text-orbit-dim">▼</span>
                </div>
              ) : (
                <div />
              )}
            </div>
          )}

          <StatusPanel
            energy={energy}
            speed={speed}
            shields={shields}
            gainedEnergy={gainedEnergy}
            gainedDistance={gainedDistance}
          />

          {finishing ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-xs space-y-3"
            >
              {error && <p className="text-center text-[14px] text-orbit-red">{error}</p>}
              <div className="flex gap-3">
                <button
                  onClick={onStop}
                  className="h-12 flex-1 rounded-control border border-white/15 text-[15px] font-bold text-orbit-text"
                >
                  계속 항해
                </button>
                <button
                  onClick={onFinish}
                  disabled={busy}
                  className="h-12 flex-1 rounded-control text-[15px] font-bold text-orbit-bg disabled:opacity-40"
                  style={{ background: accent }}
                >
                  {busy ? '저장하는 중…' : '기록하기'}
                </button>
              </div>
              <button
                onClick={() => setConfirmCancel(true)}
                className="w-full text-center text-[13px] font-bold text-orbit-red/70 hover:text-orbit-red"
              >
                기록하지 않고 버리기
              </button>
            </motion.div>
          ) : (
            <SlideToStop onStop={onStop} />
          )}
        </motion.div>

        <AnimatePresence>
          {confirmCancel && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
              onClick={() => setConfirmCancel(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="mx-6 w-full max-w-sm rounded-card border border-orbit-red/30 bg-orbit-panel p-6"
              >
                <div className="space-y-3 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-orbit-red/30 bg-orbit-red/15">
                    <Crosshair className="h-5 w-5 text-orbit-red" />
                  </div>
                  <h3 className="text-[16px] font-bold text-orbit-text">항해 기록을 취소할까요?</h3>
                  <p className="text-[14px] leading-relaxed text-orbit-dim">
                    지금까지 {fmtClock(seconds)} 공부한 게 기록되지 않고 사라집니다.
                  </p>
                </div>
                <div className="mt-5 flex gap-3">
                  <button
                    onClick={() => setConfirmCancel(false)}
                    className="h-11 flex-1 rounded-control border border-orbit-cyan/25 bg-orbit-cyan/10 text-[14px] font-bold text-orbit-cyan"
                  >
                    계속 항해
                  </button>
                  <button
                    onClick={onCancel}
                    className="h-11 flex-1 rounded-control border border-orbit-red/30 bg-orbit-red/20 text-[14px] font-bold text-orbit-red"
                  >
                    기록 취소
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
