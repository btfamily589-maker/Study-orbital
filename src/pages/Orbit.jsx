import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, Smartphone } from 'lucide-react'
import { hasFirebase } from '../lib/firebase'
import {
  bootOrbit,
  joinOrbit,
  startSession,
  cancelSession,
  endSession,
  getWeapons,
  fireAttack,
  buyShield,
  getShieldOffers,
  getAttackLog,
  getLogs,
  editLog,
} from '../lib/orbit'
import { Sheet } from '../components/ui'
import { OrbitButton } from '../components/OrbitButton'
import { prettyDate, ymd } from '../lib/date'
import { fetchRoomPhotos } from '../lib/rooms'
import { IncomingMissiles, RouteMap, ShieldDomeIcon, ShipHero } from '../components/orbit/RouteMap'
import { StudySession } from '../components/orbit/StudySession'
import { Spaceship } from '../components/orbit/Spaceship'
import { WeaponIcon } from '../components/orbit/WeaponIcon'
import { MAX_ENERGY, MAX_SHIELDS, SHIELD_PRICE, speedOf } from '../lib/orbitRules'

/* Study Orbital — 공부한 만큼 우주선이 항로를 전진하는 경쟁형 시뮬레이션.
 *
 * 이 탭에 들어오면 앱 전체가 어두운 콕핏이 된다(App.jsx가 루트에 .orbit을 건다).
 * 상·하단 바까지 같이 어두워지고, 나가면 원래 밝은 테마로 돌아온다.
 *
 * 여기 숫자(에너지·속도·위치)는 전부 서버가 계산한 결과를 받아 그리기만 한다 —
 * 클라이언트에서 계산하면 콘솔로 조작할 수 있다. 타이머도 화면에서만 돌고,
 * 실제 공부 시간은 서버가 기억해둔 시작 시각으로 판정한다. */

const STATUS_LABEL = { normal: '정상', unstable: '불안정', critical: '위험' }
const STATUS_COLOR = {
  normal: 'text-orbit-cyan',
  unstable: 'text-orbit-amber',
  critical: 'text-orbit-red',
}

/* 한 시간이 안 되면 "0시간 40분"이 아니라 그냥 "40분"이라고 쓴다.
 * 줄줄이 늘어놓는 목록에서는 앞의 0이 눈에 먼저 걸린다.
 *
 * 순위 목록만 예전에 따로 쓰던 함수(fmtHm)가 남아 있어서, 같은 52분이
 * 순위에서는 "0시간 52분", 바로 아래 오늘의 공부에서는 "52분"으로 갈렸다.
 * 한 벌만 둔다 — 두 벌이면 또 갈라진다. */
const fmtDuration = (min) => {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (!h) return `${m}분`
  return m ? `${h}시간 ${m}분` : `${h}시간`
}

/** 최근 공격 대상. 이 기기에만 남는다. */
const RECENT_TARGET_KEY = 'orbital:recent-targets'

const fmtEtaMin = (m) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}시간` : `${m}분`)

/* 기록 제목. 공부 내용은 이제 안 받지만 예전 기록엔 남아 있다. 수리 로그는
 * 내용이 없으면 '[수리]' 접두사만 저장되므로, 그건 제목으로 안 친다 —
 * 옆에 '수리' 배지가 따로 붙는다. */
function logTitle(log) {
  const c = (log.content ?? '').replace(/^\[수리\]\s*/, '').trim()
  return c || null
}

/** 몇 시부터 몇 시까지 공부했는지. 내용이 없을 때 그 자리를 채운다. */
function fmtTimeRange(log) {
  const hm = (v) => {
    if (!v) return null
    const d = new Date(v)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const a = hm(log.startedAt)
  const b = hm(log.endedAt)
  return a && b ? `${a} – ${b}` : (a ?? '')
}

/* 시트 안 입력칸. 시트도 어두우므로 밝은 테마 입력칸을 쓰면 안 된다. */
const sheetInput =
  'w-full rounded-control border border-white/12 bg-white/5 px-3.5 py-3 text-[16px] text-orbit-text placeholder:text-orbit-dim focus:border-orbit-cyan/60 focus:outline-none'

/* ---------------- 공용 조각 ---------------- */

function Meter({ label, value, max = 100, color = 'cyan', suffix = '%' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const bar = {
    cyan: 'bg-orbit-cyan',
    red: 'bg-orbit-red',
    amber: 'bg-orbit-amber',
  }[color]
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span className="num text-[15px] font-bold">
          {Math.round(value * 10) / 10}
          <span className="ml-0.5 text-[13px] font-semibold text-orbit-dim">{suffix}</span>
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/8">
        <div className={`h-full rounded-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/* ---------------- 참가 전 ---------------- */

function JoinCard({ onJoined }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function join() {
    setBusy(true)
    setErr(null)
    try {
      await joinOrbit()
      onJoined()
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="panel panel-cyan scanline space-y-4 p-6">
      {/* 규칙 설명은 걷어냈다. 들어오기 전에 읽는 규칙은 어차피 안 읽히고,
          한 번 눌러보면 HUD가 그대로 다 보여준다. 자세한 건 게시판에 있다. */}
      <h2 className="text-[18px] font-bold text-orbit-cyan neon">Study Orbital</h2>
      {err && <p className="text-[14px] text-orbit-red">{err}</p>}
      <OrbitButton className="w-full" onClick={join} disabled={busy}>
        {busy ? '함선 배정 중…' : 'STUDY ORBITAL 사용해보기'}
      </OrbitButton>
    </div>
  )
}

/* ---------------- 엔진 점화 ---------------- */

/* 화면이 바뀌는 연출의 세 박자. 계기가 빠지고(OUT) → 함선만 남아 자리를
 * 옮기고(MOVE) → 도착한 곳의 계기가 뜬다. 기록을 마치면 이 순서 그대로 거꾸로.
 *
 * 어느 박자에서도 화면을 덮지 않는다 — 덮는 순간이 곧 암전이고, 암전이 곧
 * "끊겼다"로 보인다. 배경(별밭)은 App이 깔아 둔 것이 내내 그대로 있고,
 * 함선은 layoutId로 두 화면을 가로질러 한 마리가 계속 난다. */
export const TRANSIT_OUT_MS = 420
export const TRANSIT_MOVE_MS = 1050

/* 계기 한 덩어리. 연출이 돌면 살짝 밀려나며 빠졌다가, 도착하면 아래에서
 * 떠오른다. delay를 주면 여러 덩어리가 순서대로 뜬다(계기 부팅 느낌).
 * initial={false}라 화면이 새로 붙을 때는 애니메이션 없이 곧장 그 값이다 —
 * 새 화면의 계기는 '숨은 채' 붙었다가 연출이 끝나면 뜬다. */
function Fading({ dim, delay = 0, className, children }) {
  return (
    <motion.div
      className={className}
      initial={false}
      animate={{ opacity: dim ? 0 : 1, y: dim ? 14 : 0 }}
      transition={{
        duration: dim ? TRANSIT_OUT_MS / 1000 : 0.5,
        ease: 'easeOut',
        delay: dim ? 0 : delay,
      }}
    >
      {children}
    </motion.div>
  )
}

/** 함선이 나는 동안에만 흐르는 워프. 배경을 칠하지 않는다 — 광선·잔별·
 * 가장자리 비네트가 별밭 위에 겹칠 뿐이라 화면이 어두워지는 순간이 없다.
 * 발사는 위로, 귀환은 아래로 흐른다(감속해 내려앉는 느낌). */
function WarpTrails({ dir = 'launch' }) {
  const up = dir === 'launch'
  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'linear' }}
    >
      {/* 가장자리만 살짝 물드는 시안 비네트 — 속도감. 중앙은 투명하다. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 52%, rgba(0,212,255,0.12) 100%)',
        }}
      />

      {/* 광선. 다섯에 하나는 굵고 밝은 코어 광선 — 빛무리를 단다. */}
      {Array.from({ length: 26 }, (_, i) => {
        const bright = i % 5 === 0
        return (
          <motion.span
            key={i}
            className="absolute rounded-full"
            style={{
              width: bright ? 3 : i % 3 === 0 ? 2 : 1,
              left: `${(i * 47 + 11) % 100}%`,
              height: (60 + (i % 6) * 30) * (bright ? 1.4 : 1),
              background:
                i % 4 === 3
                  ? 'rgba(143,107,255,0.75)'
                  : bright
                    ? 'rgba(170,238,255,0.95)'
                    : 'rgba(0,212,255,0.6)',
              boxShadow: bright ? '0 0 8px rgba(0,212,255,0.9)' : 'none',
            }}
            initial={{ top: up ? '112%' : '-45%', opacity: 0 }}
            animate={{ top: up ? '-45%' : '112%', opacity: [0, 1, 0.9, 0] }}
            transition={{
              duration: (bright ? 0.5 : 0.62) + (i % 5) * 0.12,
              repeat: Infinity,
              ease: 'linear',
              delay: (i % 8) * 0.08,
            }}
          />
        )
      })}

      {/* 흐르는 잔별 — 광선보다 느리게 지나가 원근이 생긴다. */}
      {Array.from({ length: 18 }, (_, i) => (
        <motion.span
          key={`s${i}`}
          className="absolute rounded-full bg-white"
          style={{ width: 1.5, height: 1.5, left: `${(i * 59 + 23) % 100}%`, opacity: 0.55 }}
          initial={{ top: up ? '105%' : '-5%' }}
          animate={{ top: up ? '-5%' : '105%' }}
          transition={{
            duration: 1.1 + (i % 4) * 0.3,
            repeat: Infinity,
            ease: 'linear',
            delay: (i % 6) * 0.15,
          }}
        />
      ))}
    </motion.div>
  )
}

/* 세션이 도는 동안엔 이 카드가 아니라 StudySession 화면이 탭 전체를 차지한다.
 * 여기는 시작 버튼만 맡는다. */
function EngineStart({ noFlyZone, onStart }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  return (
    <div className="panel space-y-3 p-5">
      {noFlyZone && (
        <p className="text-[15px] leading-relaxed text-orbit-amber">
          항해 금지 시간대입니다(평일 수업시간).
        </p>
      )}
      {err && <p className="text-[15px] text-orbit-red">{err}</p>}
      <OrbitButton
        className="w-full"
        disabled={busy || noFlyZone}
        onClick={async () => {
          setBusy(true)
          setErr(null)
          try {
            await onStart()
          } catch (e) {
            setErr(e.message)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? '점화 중…' : '공부 시작'}
      </OrbitButton>
    </div>
  )
}

/* ---------------- 함선 상태 ---------------- */

/* 방어막 상점. HUD와 Oper. 탭 양쪽에서 쓴다 — 공격하러 들어간 김에 방어도
 * 챙기게 된다. 한 장이 미사일 한 발을 통째로 막고, 최대 한 장만 가진다. */
/* 방어막 세 종류의 색. 맵의 원, 방어막 탭, 목록이 전부 이 표를 본다 —
 * 색이 곧 종류라서 한 군데만 어긋나도 딴 물건처럼 보인다. */
const SHIELD_TONE = {
  first: { text: 'text-orbit-cyan', border: 'border-orbit-cyan', hex: '#00d4ff' },
  second: { text: 'text-purple-400', border: 'border-purple-400', hex: '#c084fc' },
  reflect: { text: 'text-emerald-400', border: 'border-emerald-400', hex: '#34d399' },
}

function ShieldPanel({ ship, onChanged }) {
  const [offers, setOffers] = useState(null)
  const [pick, setPick] = useState(null) // 고른 offer
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    try {
      setOffers(await getShieldOffers())
      setErr(null)
    } catch (e) {
      setErr(e.message)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const energy = Math.max(0, ship.energyBalance ?? 0)

  async function buy() {
    setBusy(true)
    setErr(null)
    try {
      await buyShield({ kind: pick.kind })
      setPick(null)
      await load()
      onChanged()
    } catch (e) {
      setErr(e.message)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const after = pick ? Math.max(0, energy - pick.price) : energy

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between px-1">
        <span className="text-[17px] font-bold text-orbit-dim">보유 에너지</span>
        <span className="num text-[22px] font-extrabold text-orbit-amber neon">
          {Math.round(energy * 10) / 10}
          <span className="ml-0.5 text-[14px] font-semibold text-orbit-amber/70">E</span>
        </span>
      </div>

      {err && <p className="text-[14px] text-orbit-red">{err}</p>}

      {/* 보유 배너는 따로 안 둔다 — 목록에 세 종류가 전부 뜨고 가진 건 "보유 중"
          으로 표시되므로, 무엇을 두르고 있는지도 이 목록이 같이 말해준다. */}
      <section className="space-y-2">
        <div className="px-1 label">방어막 구매</div>
        {(offers?.offers ?? []).map((o) => {
          const on = pick?.kind === o.kind && pick?.level === o.level
          const afford = energy >= o.price
          /* 색은 조립하지 않고 통째로 고른다 — Tailwind는 만들어 붙인 클래스
           * 이름을 못 읽어서, `text-${tone}`으로 쓰면 그 색이 아예 안 나온다. */
          const tone =
            SHIELD_TONE[o.kind === 'reflect' ? 'reflect' : o.level >= 2 ? 'second' : 'first']
          return (
            <div key={`${o.kind}-${o.level}`}>
              <button
                disabled={!o.available || !afford}
                onClick={() => setPick(on ? null : o)}
                className={`flex w-full items-center gap-3 rounded-control border-2 px-3 py-2.5 text-left transition disabled:opacity-35 ${
                  on ? `${tone.border} bg-white/10` : 'border-white/22 bg-white/5'
                }`}
              >
                {/* 아이콘은 맵의 돔 그대로다 — 색도 크기 차이도 같아야, 여기서
                    산 것이 맵에서 뭐로 보일지 그림만 보고 알아본다. */}
                <ShieldDomeIcon
                  color={tone.hex}
                  tier={o.kind === 'reflect' ? 2 : o.level >= 2 ? 1 : 0}
                  className="h-11 w-11 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <span className="text-[15px] font-bold">{o.label}</span>
                  {!o.available && (
                    <div className="text-[12px] leading-snug text-orbit-dim">
                      {o.owned ? '보유 중' : (o.unavailableReason ?? '지금은 살 수 없습니다')}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[11px] font-semibold text-orbit-dim">필요</div>
                  <div className="num text-[20px] leading-none font-extrabold text-orbit-amber">
                    {o.price}
                    <span className="ml-0.5 text-[11px] font-bold text-orbit-amber/70">E</span>
                  </div>
                </div>
              </button>
              {/* 설명은 칸 밖 — 무기 카드와 같은 규칙이다. 칸 안에 넣으면
                  값 숫자를 밀어내고 두 줄로 접힌다. 보유 중이어도 보여준다 —
                  "내 반사막이 뭘 못 하는지"는 산 뒤에 더 궁금해진다. */}
              {o.note && (
                <div className="mt-1 px-1 text-[12px] leading-snug text-orbit-dim">{o.note}</div>
              )}
            </div>
          )
        })}
      </section>

      {/* 사고 나면 무엇이 어떻게 바뀌는지 미리 보여준다. 에너지가 곧 속도라
          방어에는 속도를 내주는 대가가 따른다 — 그게 이 게임의 핵심이다. */}
      {pick && (
        <div className="space-y-2 rounded-control border border-white/10 bg-white/5 p-3.5">
          {[
            ['에너지', `${Math.round(energy * 10) / 10}E`, `${Math.round(after * 10) / 10}E`],
            [
              '속도',
              `${Math.round(speedOf(energy) * 100)}%`,
              `${Math.round(speedOf(after) * 100)}%`,
            ],
          ].map(([label, before, next]) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-semibold text-orbit-dim">{label}</span>
              <span className="flex items-center gap-2">
                <span className="num text-[16px] font-bold text-orbit-text">{before}</span>
                <span className="text-[14px] text-orbit-dim">→</span>
                <span className="num text-[18px] font-extrabold text-orbit-amber">{next}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <OrbitButton className="w-full" disabled={!pick || busy} onClick={buy}>
        {busy ? (
          '구매 중…'
        ) : pick ? (
          <>
            {pick.label} 구매
            <span className="num ml-1.5 font-extrabold">{pick.price}E</span>
          </>
        ) : (
          '구매'
        )}
      </OrbitButton>
    </div>
  )
}

/* 발사 기록. 지금까지 나간 것 전부를 날짜로 갈라 늘어놓는다.
 *
 * 맞은 것만 보이던 시스템 메시지와 달리, 여기는 빗나갔든 막혔든 되돌아갔든
 * 다 남는다 — "누가 나를 노리고 있나"를 보려면 결과보다 흐름이 필요하다. */
function AttackLog() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    getAttackLog()
      .then(setRows)
      .catch((e) => {
        setErr(e.message)
        setRows([])
      })
  }, [])

  if (err) return <p className="text-[14px] text-orbit-red">{err}</p>
  if (!rows) return <p className="px-1 text-[14px] text-orbit-dim">불러오는 중…</p>
  if (!rows.length)
    return <p className="px-1 text-[14px] text-orbit-dim">아직 발사된 게 없습니다.</p>

  const STATUS = {
    in_flight: { text: '날아가는 중', tone: 'text-orbit-amber' },
    hit: { text: '명중', tone: 'text-orbit-red' },
    reflected: { text: '반사됨', tone: 'text-emerald-400' },
    shot_down: { text: '요격됨', tone: 'text-orbit-cyan' },
    intercepting: { text: '요격 중', tone: 'text-orbit-amber' },
    intercept_hit: { text: '요격 성공', tone: 'text-emerald-400' },
    miss: { text: '불발', tone: 'text-orbit-dim' },
  }

  // 하루씩 묶는다. 서버가 최신순으로 주므로 순서는 그대로 쓴다.
  const days = []
  for (const r of rows) {
    const key = ymd(new Date(r.launchedAt))
    if (days.at(-1)?.key !== key) days.push({ key, items: [] })
    days.at(-1).items.push(r)
  }

  return (
    <div className="space-y-4">
      {days.map((d) => (
        <section key={d.key}>
          <div className="mb-1.5 flex items-center gap-2.5 px-1">
            <span className="shrink-0 text-[13px] font-bold text-orbit-dim">
              {prettyDate(d.key)}
            </span>
            <span className="h-px flex-1 bg-white/12" />
          </div>
          <div className="panel divide-y divide-white/8">
            {d.items.map((r) => {
              const st = STATUS[r.status] ?? STATUS.miss
              return (
                <div key={r.id} className="flex items-center gap-2.5 px-3 py-2.5">
                  <WeaponIcon
                    type={r.type}
                    className="h-5 w-5 shrink-0"
                    style={{ color: WEAPON_COLOR[r.type] }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold">
                      <span className={r.isMine ? 'text-orbit-cyan' : 'text-orbit-text'}>
                        {r.isMine ? '나' : r.fromNickname}
                      </span>
                      <span className="mx-1 text-orbit-dim">→</span>
                      {/* 나는 쏘는 쪽이든 맞는 쪽이든 파란색이다 — 로그에서
                          "나"의 색이 줄마다 다르면 내 줄을 한눈에 못 찾는다. */}
                      <span className={r.isTarget ? 'text-orbit-cyan' : 'text-orbit-text'}>
                        {r.isTarget ? '나' : r.toNickname}
                      </span>
                      {r.reflected && (
                        <span className="ml-1.5 text-[11px] font-bold text-emerald-400">
                          되돌아옴
                        </span>
                      )}
                      {r.intercept && (
                        <span className="ml-1.5 text-[11px] font-bold text-orbit-cyan">요격탄</span>
                      )}
                    </div>
                    <div className="num text-[11px] text-orbit-dim">
                      {new Date(r.launchedAt).toTimeString().slice(0, 5)} 발사
                    </div>
                  </div>
                  <span className={`shrink-0 text-[12px] font-bold ${st.tone}`}>{st.text}</span>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

/* OPER 겉껍데기. 공격·방어막·기록을 하위 갈래로 나눈다. */
function Combat({ ship, fleet, missiles, onChanged }) {
  const [tab, setTab] = useState('attack')

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-control border border-white/10 bg-white/5 p-1">
        {OPER_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded px-2 py-1.5 text-[13px] font-bold transition ${
              tab === t.id ? 'bg-orbit-cyan text-orbit-bg' : 'text-orbit-dim hover:text-orbit-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'attack' && (
        <AttackPanel ship={ship} fleet={fleet} missiles={missiles} onChanged={onChanged} />
      )}
      {tab === 'shield' && <ShieldPanel ship={ship} onChanged={onChanged} />}
      {tab === 'log' && <AttackLog />}
    </div>
  )
}

/** 방어막 칸. 가진 만큼 불이 들어온다. */
function ShieldChips({ shields, max, small = false }) {
  return (
    <span className={`flex shrink-0 items-center ${small ? 'gap-1' : 'gap-1.5'}`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`rounded-[3px] border ${small ? 'h-2.5 w-4' : 'h-4 w-7'} ${
            i < shields ? 'border-orbit-cyan bg-orbit-cyan/70' : 'border-white/15 bg-transparent'
          }`}
          style={i < shields ? { boxShadow: '0 0 7px rgba(0,212,255,0.7)' } : undefined}
        />
      ))}
    </span>
  )
}

/* 계기판. 수치는 에너지 하나뿐이다 — 속도가 거기서 나오므로
 * "에너지 = 얼마나 빠른가"로 읽으면 된다.
 *
 * 방어막은 몇 장 있는지만 보여준다. 사는 건 Oper. 탭에서 한다 — 공격을
 * 준비하는 자리에서 방어도 같이 정하는 편이 자연스럽고, 같은 버튼이 두 군데
 * 있으면 어느 쪽을 눌러야 하는지 헷갈린다. */
function ShipStats({ ship }) {
  const energy = Math.max(0, ship.energyBalance ?? 0)

  return (
    <div className="panel space-y-3 p-5">
      <Meter
        label="에너지"
        value={energy}
        max={ship.maxEnergy}
        color={speedOf(energy) >= 1 ? 'cyan' : speedOf(energy) >= 0.34 ? 'amber' : 'red'}
        suffix={`/${ship.maxEnergy}`}
      />
      <Meter label="속도" value={speedOf(energy) * 100} color="cyan" suffix="%" />
    </div>
  )
}

/* ---------------- 공격 ---------------- */

const WEAPON_COLOR = {
  emp: '#ffffff',
  missile_basic: '#3b82f6',
  missile_fast: '#22c55e',
  missile_heavy: '#ff6b35',
  missile_stealth: '#a855f7',
  missile_nuke: '#ff0000',
}

/* 공격 화면.
 *
 * 미사일은 쏘는 즉시 안 맞는다 — 도달 시간이 지나야 터진다. 그래서 "쐈는데 왜
 * 아무 일도 안 일어나지?"가 되지 않게 발사 결과에 도착 예정을 같이 띄운다.
 * EMP만 즉발이다. */
function AttackPanel({ ship, fleet, missiles = [], onChanged }) {
  const [weapons, setWeapons] = useState([])
  const [pick, setPick] = useState(null) // 고른 무기 type
  const [target, setTarget] = useState(null) // 고른 대상 uid
  const [targetMissile, setTargetMissile] = useState(null) // 요격할 미사일 id
  /* 열려 있는 고르기 창. 'missile'(요격할 미사일) 또는 'people'(공격할 상대).
   * 명단을 화면에 쭉 펴두면 공격 화면이 한없이 길어져서, 갈래 버튼 두 개만
   * 남기고 실제 명단은 창 안에서 고르게 한다. */
  const [chooser, setChooser] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [flash, setFlash] = useState(null)
  /* 최근에 때린 사람. 같은 사람을 연달아 노리는 일이 많은데 매번 명단에서
   * 찾는 건 번거롭다. 이 기기에만 남긴다 — 서버까지 갈 값은 아니다. */
  const [recent, setRecent] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_TARGET_KEY) ?? '[]')
    } catch {
      return []
    }
  })

  const load = useCallback(async () => {
    try {
      setWeapons(await getWeapons())
    } catch (e) {
      setErr(e.message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const weapon = weapons.find((w) => w.type === pick)
  const targets = fleet.filter((f) => !f.isMe)
  const chosen = targets.find((t) => t.uid === target)

  /* 나에게 날아오는 미사일. 배 대신 이걸 겨누면 요격이다.
   * 스텔스는 서버가 목록에서부터 안 준다 — 안 보이는 건 못 겨눈다. */
  const myUid = fleet.find((f) => f.isMe)?.uid
  const incoming = missiles.filter((m) => m.toUid === myUid)
  const chosenMissile = incoming.find((m) => m.id === targetMissile)
  /* 요격 조건: 피해가 같거나 높은 무기. 모르는 무기(퇴역한 종류)면 서버 판단에
   * 맡긴다 — 여기서 0으로 치고 막아버리면 되는 요격을 못 하게 된다. */
  const missileDmg = (m) => weapons.find((w) => w.type === m.type)?.damage ?? 0
  const tooWeak = chosenMissile && weapon && weapon.damage < missileDmg(chosenMissile)

  const canFire =
    weapon && (chosenMissile ? !tooWeak : !!chosen) && ship.energyBalance >= weapon.energyCost

  // 최근 3명. 지금 참가자 명단에 남아 있는 사람만.
  const recentTargets = recent
    .map((uid) => targets.find((t) => t.uid === uid))
    .filter(Boolean)
    .slice(0, 3)

  async function fire() {
    setBusy(true)
    setErr(null)
    try {
      const r = chosenMissile
        ? await fireAttack({ targetAttackId: chosenMissile.id, attackType: pick })
        : await fireAttack({ targetUid: target, attackType: pick })
      setFlash(r.message)
      // 최근 공격은 사람만 기억한다. 미사일은 한 번 떨구면 끝이라 다시 노릴 일이 없다.
      if (!chosenMissile) {
        const next = [target, ...recent.filter((u) => u !== target)].slice(0, 3)
        setRecent(next)
        try {
          localStorage.setItem(RECENT_TARGET_KEY, JSON.stringify(next))
        } catch {
          /* 저장 못 해도 공격은 나갔다 */
        }
      }
      setPick(null)
      setTarget(null)
      setTargetMissile(null)
      await load()
      onChanged()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  /* 대상 한 명. 숫자를 나열하는 대신 막대 두 줄로 보여준다 — 에너지가 얼마나
   * 남았는지(때릴 값어치)와 지금 얼마나 빠른지(추격 위협)는 다른 이야기라
   * 하나로 합칠 수 없다. 이름은 길어도 한 줄로 자른다. */
  /* 이름만 있는 칩. 전체 명단에 쓴다 — 열 명 넘는 명단에서 막대까지 다 그리면
   * 화면이 표가 되고, 정작 "누구를 고를까"가 안 보인다. 상태를 견줘 보고 싶으면
   * 최근 공격 쪽 카드가 그 일을 한다. */
  const targetChip = (t) => {
    const on = target === t.uid
    return (
      <button
        key={t.uid}
        onClick={() => {
          setTarget(on ? null : t.uid)
          setTargetMissile(null)
          setChooser(null)
        }}
        className={`truncate rounded-control border-2 px-2 py-2.5 text-center text-[15px] font-bold transition ${
          on ? 'border-orbit-red bg-orbit-red/10 text-orbit-red' : 'border-white/22 bg-white/5'
        }`}
      >
        {t.nickname}
      </button>
    )
  }

  const targetCard = (t) => {
    const energy = Math.max(0, t.energy ?? 0)
    const spd = speedOf(energy)
    const on = target === t.uid
    const tone = spd >= 1 ? 'bg-orbit-cyan' : spd >= 0.34 ? 'bg-orbit-amber' : 'bg-orbit-red'

    const bar = (label, ratio, text, fill) => (
      <div className="flex items-center gap-1">
        <span className="w-7 shrink-0 text-[11px] text-orbit-dim">{label}</span>
        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-black/60">
          <span
            className={`block h-full rounded-full ${fill}`}
            style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
          />
        </span>
        <span className="num w-9 shrink-0 text-right text-[11px] font-semibold text-orbit-text">
          {text}
        </span>
      </div>
    )

    return (
      <button
        key={t.uid}
        onClick={() => {
          setTarget(on ? null : t.uid)
          setTargetMissile(null)
          setChooser(null)
        }}
        className={`overflow-hidden rounded-control border-2 px-2.5 py-2 text-left transition ${
          on ? 'border-orbit-red bg-orbit-red/10' : 'border-white/22 bg-white/5'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`min-w-0 flex-1 truncate text-[15px] font-bold ${
              on ? 'text-orbit-red' : 'text-orbit-text'
            }`}
          >
            {t.nickname}
          </span>
          <ShieldChips shields={t.shields ?? 0} max={MAX_SHIELDS} small />
        </div>
        <div className="mt-1.5 space-y-1">
          {bar('E', energy / MAX_ENERGY, `${Math.round(energy)}E`, tone)}
          {bar('속도', spd, `${Math.round(spd * 100)}%`, 'bg-orbit-cyan')}
        </div>
      </button>
    )
  }

  const energy = Math.max(0, ship.energyBalance ?? 0)

  return (
    <div className="space-y-4">
      {/* 지금 쓸 수 있는 에너지. 무엇을 살지 고르기 전에 이것부터 봐야 한다.
          테두리는 안 두른다 — 고르는 물건이 아니라 머리말이라, 아래 카드들과
          같은 네모를 두르면 이것도 눌러야 하는 것처럼 보인다. */}
      <div className="flex items-baseline justify-between px-1">
        <span className="text-[17px] font-bold text-orbit-dim">보유 에너지</span>
        <span className="num text-[22px] font-extrabold text-orbit-amber neon">
          {Math.round(energy * 10) / 10}
          <span className="ml-0.5 text-[14px] font-semibold text-orbit-amber/70">E</span>
        </span>
      </div>

      {flash && (
        <p className="rounded-control border border-orbit-cyan/30 bg-orbit-cyan/10 px-3.5 py-2.5 text-[14px] leading-relaxed text-orbit-cyan">
          {flash}
        </p>
      )}

      <section>
        <div className="mb-1.5 px-1 label">무기 선택</div>
        {/* 정사각형 카드를 두 줄로 깔면 세 개째가 혼자 남아 어색하고, 좁은 칸에
            숫자 둘을 욱여넣느라 글씨도 작았다. 가로로 긴 막대 세 줄로 편다 —
            왼쪽에 무엇인지, 오른쪽에 값이 얼마인지. 세로로 훑으면 값 비교가 된다. */}
        <div className="space-y-2">
          {weapons.map((w) => {
            const afford = ship.energyBalance >= w.energyCost
            const on = pick === w.type
            const num = (label, value) => (
              <div className="shrink-0 text-right">
                <div className="text-[11px] font-semibold text-orbit-dim">{label}</div>
                <div className="num text-[20px] leading-none font-extrabold text-orbit-amber">
                  {value}
                  <span className="ml-0.5 text-[11px] font-bold text-orbit-amber/70">E</span>
                </div>
              </div>
            )
            return (
              <div key={w.type}>
                <button
                  onClick={() => setPick(on ? null : w.type)}
                  disabled={!afford}
                  /* 테두리를 1px 흐린 회색으로 두니 어두운 배경에서 거의 안 보여
                   막대끼리 어디서 끊기는지 몰랐다. 2px에 또렷한 흰색으로 올린다. */
                  className={`flex w-full items-center gap-3 rounded-control border-2 px-3 py-2.5 text-left transition disabled:opacity-35 ${
                    on ? 'border-orbit-cyan bg-orbit-cyan/10' : 'border-white/22 bg-white/5'
                  }`}
                >
                  <WeaponIcon
                    type={w.type}
                    className="h-7 w-7 shrink-0"
                    style={{
                      color: WEAPON_COLOR[w.type],
                      filter: `drop-shadow(0 0 4px ${WEAPON_COLOR[w.type]})`,
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="code text-[15px] font-bold">{w.label}</span>
                    <div className="truncate text-[12px] text-orbit-dim">
                      {w.etaMinutes ? `${fmtEtaMin(w.etaMinutes)} 뒤 상대방에게 피해` : '즉시 피해'}
                    </div>
                  </div>
                  {/* 쏘는 데 드는 값과 상대가 잃는 양 — 무기를 고르는 기준은
                    사실상 이 둘뿐이라 오른쪽 끝에 나란히 세운다. */}
                  {num('필요', w.energyCost)}
                  {num('피해', w.damage)}
                </button>
                {/* 무기마다 무엇이 다른지. 카드 밖에 둔다 — 뉴클리어 설명은 길어서
                  칸 안에 넣으면 값·피해 숫자를 밀어내고 두 줄로 접힌다. */}
                {w.desc && (
                  <div
                    className={`mt-1 px-1 text-[12px] leading-snug ${
                      w.stealth ? 'text-purple-400' : w.pierce ? 'text-orbit-red' : 'text-orbit-dim'
                    }`}
                  >
                    {w.desc}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* 누구를(무엇을) 때릴지 고르는 자리. 명단은 화면에 안 편다 — 갈래 버튼을
          누르면 창이 열리고, 그 안에서 고르면 창이 닫히면서 버튼에 고른 대상이
          남는다. 명단을 다 펴두면 공격 화면이 한없이 길었다. */}
      <section>
        <div className="mb-2 px-1 label">공격 대상 선택</div>
        <div className="space-y-2">
          {/* 미사일 공격하기 — 나에게 오는 미사일도 대상이다. 사람 위에 둔다.
              날아오는 게 있는 사람에게는 이쪽이 더 급한 일이라서다.
              날아오는 게 없어도 버튼은 잠긴 채로 남긴다 — 자리가 있어야
              "미사일이 오면 여기서 요격한다"를 미리 알 수 있다. */}
          <button
            disabled={!incoming.length}
            onClick={() => setChooser('missile')}
            className={`flex w-full items-center gap-3 rounded-control border-2 px-3 py-3 text-left transition disabled:opacity-40 ${
              chosenMissile ? 'border-orbit-amber bg-orbit-amber/10' : 'border-white/22 bg-white/5'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-bold text-orbit-text">미사일 공격하기</div>
              <div
                className={`truncate text-[12px] ${chosenMissile ? 'font-semibold text-orbit-amber' : 'text-orbit-dim'}`}
              >
                {chosenMissile
                  ? `${chosenMissile.fromNickname}의 ${
                      weapons.find((w) => w.type === chosenMissile.type)?.label ?? '미사일'
                    } 요격`
                  : incoming.length
                    ? `날아오는 미사일 ${incoming.length}발`
                    : '날아오는 미사일 없음'}
              </div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-orbit-dim" />
          </button>

          <button
            onClick={() => setChooser('people')}
            className={`flex w-full items-center gap-3 rounded-control border-2 px-3 py-3 text-left transition ${
              chosen ? 'border-orbit-red bg-orbit-red/10' : 'border-white/22 bg-white/5'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-bold text-orbit-text">상대 공격하기</div>
              <div
                className={`truncate text-[12px] ${chosen ? 'font-semibold text-orbit-red' : 'text-orbit-dim'}`}
              >
                {chosen ? `${chosen.nickname} 선택됨` : `참가자 ${targets.length}명`}
              </div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-orbit-dim" />
          </button>
        </div>
      </section>

      {/* 쏘는 버튼은 맨 아래다. 무기 → 대상 순으로 고르며 내려온 손이 마지막에
          닿는 자리이고, 고른 게 갖춰지면 버튼 글자가 "아름에게 공격"/"요격하기"로
          바뀌어 무엇을 누르는지 그 자리에서 읽힌다. */}
      {err && <p className="text-[14px] text-orbit-red">{err}</p>}
      {tooWeak && (
        <p className="text-[13px] leading-snug text-orbit-amber">
          피해 {missileDmg(chosenMissile)} 이상인 무기로만 요격할 수 있습니다.
        </p>
      )}

      <OrbitButton variant="danger" className="w-full" disabled={!canFire || busy} onClick={fire}>
        {busy
          ? '공격 중…'
          : weapon && chosenMissile
            ? '요격하기'
            : weapon && chosen
              ? `${chosen.nickname}에게 공격`
              : '공격하기'}
      </OrbitButton>

      <Sheet
        dark
        center
        open={chooser === 'missile'}
        onClose={() => setChooser(null)}
        title="미사일 공격하기"
      >
        <p className="mb-3 text-[13px] leading-snug text-orbit-dim">
          피해가 같거나 큰 무기로만 요격할 수 있습니다.
        </p>
        <div className="space-y-2">
          {incoming.map((m) => {
            const on = targetMissile === m.id
            const minLeft = Math.max(1, Math.round((m.impactAt - Date.now()) / 60000))
            const iLeft = m.interceptAt
              ? Math.max(1, Math.round((m.interceptAt - Date.now()) / 60000))
              : null
            return (
              <button
                key={m.id}
                disabled={!!m.interceptedBy}
                onClick={() => {
                  setTargetMissile(on ? null : m.id)
                  setTarget(null)
                  setChooser(null)
                }}
                className={`flex w-full items-center gap-3 rounded-control border-2 px-3 py-2.5 text-left transition disabled:opacity-60 ${
                  on ? 'border-orbit-amber bg-orbit-amber/10' : 'border-white/22 bg-white/5'
                }`}
              >
                <WeaponIcon
                  type={m.type}
                  className="h-6 w-6 shrink-0"
                  style={{
                    color: WEAPON_COLOR[m.type] ?? '#ff6b35',
                    filter: `drop-shadow(0 0 4px ${WEAPON_COLOR[m.type] ?? '#ff6b35'})`,
                  }}
                />
                <div className="min-w-0 flex-1">
                  <span className="text-[15px] font-bold">
                    {m.fromNickname} <span className="text-orbit-dim">→</span>{' '}
                    <span className="text-orbit-red">나</span>
                  </span>
                  <div className="num text-[12px] text-orbit-dim">
                    {m.interceptedBy
                      ? `요격탄 발사됨 · ${fmtEtaMin(iLeft)} 뒤 요격`
                      : `${fmtEtaMin(minLeft)} 뒤 도달`}
                  </div>
                </div>
                {m.interceptedBy ? (
                  <span className="shrink-0 text-[13px] font-bold text-emerald-400">요격 중</span>
                ) : (
                  missileDmg(m) > 0 && (
                    <div className="shrink-0 text-right">
                      <div className="text-[11px] font-semibold text-orbit-dim">피해</div>
                      <div className="num text-[20px] leading-none font-extrabold text-orbit-red">
                        {missileDmg(m)}
                      </div>
                    </div>
                  )
                )}
              </button>
            )
          })}
        </div>
      </Sheet>

      <Sheet
        dark
        center
        open={chooser === 'people'}
        onClose={() => setChooser(null)}
        title="상대 공격하기"
      >
        {recentTargets.length > 0 && (
          <>
            {/* 최근 공격은 곁다리라 제목을 키우지 않는다 — 아래 명단이 본줄기다. */}
            <div className="mb-1.5 px-1 text-[13px] font-semibold text-orbit-dim">최근 공격</div>
            {/* 최근 공격 카드는 두 칸씩 — 석 줄로 깔면 좁아서 서너 글자
                이름부터 잘렸다. 막대 두 줄까지 든 카드라 폭이 필요하다. */}
            <div className="grid grid-cols-2 gap-2">{recentTargets.map((t) => targetCard(t))}</div>
            <div className="my-3 border-t border-white/10" />
          </>
        )}

        {!targets.length ? (
          <div className="panel p-5 text-center text-[15px] text-orbit-dim">
            다른 참가자가 없습니다.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">{targets.map((t) => targetChip(t))}</div>
        )}
      </Sheet>
    </div>
  )
}

/* ---------------- 랭킹 ---------------- */

/* 기간별 순위. 정렬과 등수는 여기서 매긴다 — 서버는 네 가지 합계만 준다. */
const PERIODS = [
  { id: 'weekMinutes', label: '주간', note: '최근 7일' },
  { id: 'monthMinutes', label: '월간', note: '최근 30일' },
  { id: 'totalMinutes', label: '누적', note: '전체 기간' },
]

/* 내 공부 로그.
 *
 * 순위표만 있을 땐 "이번 주 12시간"까지만 보이고 그 12시간이 어디서 왔는지는
 * 알 수 없었다. 타이머를 켜 둔 채 잠들었거나 끄는 걸 잊으면 엉뚱한 기록이
 * 하나 껴 있어도 찾을 데가 없다 — 여기서 날짜별로 펴 보고 고친다.
 *
 * 고칠 수 있는 건 시간(분)뿐이다. 서버가 그만큼 에너지와 항로 위치를 되돌려
 * 다시 계산하고 수정 이력을 남긴다(server/orbit/study.js). 지우는 건 안 된다 —
 * 늘렸다 지웠다로 점수를 흔들 수 있어서, 틀렸으면 줄여 적는 쪽으로 둔다. */
function MyLogs({ uid, onChanged }) {
  const [logs, setLogs] = useState(null) // null = 불러오는 중
  const [err, setErr] = useState(null)
  const [editing, setEditing] = useState(null) // { id, h, m, was }
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await getLogs({ uid, limit: 60 })
      setLogs(r.logs ?? [])
      setErr(null)
    } catch (e) {
      setErr(e.message)
      setLogs([])
    }
  }, [uid])

  useEffect(() => {
    load()
  }, [load])

  /* 시·분 두 칸을 합친 값. 빈 칸은 0으로 본다. */
  const editedMinutes = editing
    ? Math.max(0, Math.floor(Number(editing.h) || 0)) * 60 +
      Math.max(0, Math.floor(Number(editing.m) || 0))
    : 0

  /* 줄이는 것만 된다.
   *
   * 늘리는 걸 열어두면 1분으로 적어 두고 나중에 10시간으로 고치는 걸로 순위를
   * 만들 수 있다. 타이머를 끄는 걸 잊었을 때 줄이는 게 원래 쓸 일이라, 늘리는
   * 길은 아예 막는다(서버도 같이 막는다). */
  const tooLong = editedMinutes > (editing?.was ?? 0)
  const canSave = editedMinutes >= 1 && !tooLong && editedMinutes !== (editing?.was ?? 0)

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    setErr(null)
    try {
      await editLog(editing.id, { durationMinutes: editedMinutes })
      setEditing(null)
      await load()
      onChanged?.()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (logs === null) {
    return <div className="panel p-6 text-center text-[15px] text-orbit-dim">불러오는 중…</div>
  }

  return (
    <div className="space-y-2">
      {err && <p className="px-1 text-[14px] text-orbit-red">{err}</p>}

      {!logs.length ? (
        <div className="panel p-6 text-center text-[15px] text-orbit-dim">
          아직 공부 기록이 없습니다.
        </div>
      ) : (
        <div className="panel divide-y divide-white/8">
          {logs.map((l) => {
            const open = editing?.id === l.id
            return (
              <div key={l.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="num text-[14px] font-semibold">{l.studyDate}</div>
                    {l.content && (
                      <div className="truncate text-[13px] text-orbit-dim">{l.content}</div>
                    )}
                    {/* 고친 기록은 그렇다고 적어 둔다. 나중에 숫자만 보면
                        왜 이렇게 됐는지 알 수가 없다. */}
                    {l.editedFromMinutes != null && (
                      <div className="num text-[12px] text-orbit-amber">
                        {fmtDuration(l.editedFromMinutes)}에서 고침
                      </div>
                    )}
                  </div>
                  <span className="num shrink-0 text-[16px] font-bold text-orbit-cyan">
                    {fmtDuration(l.durationMinutes)}
                  </span>
                  <button
                    onClick={() =>
                      setEditing(
                        open
                          ? null
                          : {
                              id: l.id,
                              h: String(Math.floor(l.durationMinutes / 60)),
                              m: String(l.durationMinutes % 60),
                              was: l.durationMinutes,
                            },
                      )
                    }
                    className={`shrink-0 rounded-control px-2.5 py-1.5 text-[13px] font-bold transition ${
                      open ? 'bg-orbit-cyan text-orbit-bg' : 'text-orbit-cyan hover:bg-white/8'
                    }`}
                  >
                    고치기
                  </button>
                </div>

                {open && (
                  <div className="mt-3 space-y-2 rounded-control bg-white/5 p-3">
                    {/* 519분처럼 큰 수를 그대로 치게 두면 몇 시간인지 세어야
                        한다. 시·분으로 나눠 받는다. */}
                    <div className="flex items-center gap-2">
                      <input
                        inputMode="numeric"
                        autoFocus
                        aria-label="시간"
                        value={editing.h}
                        onChange={(e) => setEditing({ ...editing, h: e.target.value })}
                        className="num w-14 shrink-0 rounded-control border border-white/15 bg-orbit-bg px-2 py-2 text-right text-[15px] text-orbit-text focus:border-orbit-cyan focus:outline-none"
                      />
                      <span className="shrink-0 text-[13px] text-orbit-dim">시간</span>
                      <input
                        inputMode="numeric"
                        aria-label="분"
                        value={editing.m}
                        onChange={(e) => setEditing({ ...editing, m: e.target.value })}
                        className="num w-14 shrink-0 rounded-control border border-white/15 bg-orbit-bg px-2 py-2 text-right text-[15px] text-orbit-text focus:border-orbit-cyan focus:outline-none"
                      />
                      <span className="shrink-0 text-[13px] text-orbit-dim">분</span>
                    </div>
                    <p className="num text-[13px] text-orbit-dim">
                      {fmtDuration(l.durationMinutes)} → {fmtDuration(editedMinutes)}
                    </p>
                    {tooLong ? (
                      <p className="text-[13px] text-orbit-red">
                        원래 시간보다 늘릴 수는 없습니다. 줄이는 것만 됩니다.
                      </p>
                    ) : (
                      /* 시간을 줄이면 에너지와 항로 위치도 같이 줄어든다. 모르고
                         고쳤다가 순위가 바뀌면 당황한다. */
                      <p className="text-[12px] leading-relaxed text-orbit-dim">
                        줄인 만큼 에너지와 항로 위치도 다시 계산됩니다. 고친 내역은 기록에 남습니다.
                      </p>
                    )}
                    <div className="flex gap-2">
                      <OrbitButton
                        variant="ghost"
                        className="flex-1"
                        onClick={() => setEditing(null)}
                        disabled={busy}
                      >
                        그만두기
                      </OrbitButton>
                      <OrbitButton className="flex-1" onClick={save} disabled={busy || !canSave}>
                        {busy ? '고치는 중…' : '저장'}
                      </OrbitButton>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StudyTime({ rows, onChanged }) {
  const [period, setPeriod] = useState('weekMinutes')
  /* 순위 / 내 기록. 같은 탭에 둔다 — "이번 주 12시간"을 보고 바로 "그 12시간이
     어디서 왔지"로 넘어가는 게 자연스럽다. */
  const [mode, setMode] = useState('rank')
  const meta = PERIODS.find((p) => p.id === period)

  /* 0분인 사람도 명단에 남긴다. 순위에서 아예 사라지면 "나는 왜 없지?"가 된다.
   * 대신 맨 뒤로 밀리고 흐리게 보인다. */
  const sorted = [...rows]
    .sort((a, b) => (b[period] ?? 0) - (a[period] ?? 0))
    .map((r, i) => ({ ...r, rank: i + 1 }))

  const top = sorted[0]?.[period] ?? 0
  const myUid = rows.find((r) => r.isMe)?.uid

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-control border border-white/10 bg-white/5 p-1">
        {[
          { id: 'rank', label: '순위' },
          { id: 'mine', label: '내 기록' },
        ].map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`flex-1 rounded px-2 py-2 text-[14px] font-bold transition ${
              mode === m.id ? 'bg-orbit-cyan text-orbit-bg' : 'text-orbit-dim hover:text-orbit-text'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'mine' && <MyLogs uid={myUid} onChanged={onChanged} />}

      {mode === 'rank' && (
        <>
          <div className="flex gap-1 rounded-control border border-white/10 bg-white/5 p-1">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`flex-1 rounded px-2 py-2 text-[14px] font-bold transition ${
                  period === p.id
                    ? 'bg-orbit-cyan text-orbit-bg'
                    : 'text-orbit-dim hover:text-orbit-text'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="px-1 text-[13px] text-orbit-dim">{meta.note} 공부 시간</p>

          {!sorted.length ? (
            <div className="panel p-6 text-center text-[15px] text-orbit-dim">기록이 없습니다.</div>
          ) : (
            <div className="panel divide-y divide-white/8">
              {sorted.map((r) => {
                const minutes = r[period] ?? 0
                // 1등 대비 얼마나 했는지를 막대로. 숫자만 있으면 격차가 안 와닿는다.
                const pct = top > 0 ? (minutes / top) * 100 : 0
                return (
                  <div
                    key={r.uid}
                    className={`px-4 py-3 ${r.isMe ? 'bg-orbit-cyan/8' : ''} ${
                      minutes === 0 ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`num w-6 shrink-0 text-right text-[16px] font-bold ${
                          r.rank === 1 && minutes > 0 ? 'text-yellow-400' : 'text-orbit-dim'
                        }`}
                      >
                        {r.rank}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                        {r.nickname}
                        {r.isMe && <span className="ml-1.5 text-[13px] text-orbit-cyan">나</span>}
                      </span>
                      <span className="num shrink-0 text-[16px] font-bold text-orbit-cyan">
                        {fmtDuration(minutes)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full bg-orbit-cyan transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* 오늘 반이 얼마나 했나. HUD 맨 아래에 붙는다.
 *
 * 공부시간 탭에도 순위가 있지만 그건 주간·월간이라 "오늘"이 안 보이고, 무엇보다
 * 지금 누가 앉아 있는지를 알 수 없다. 시작 버튼을 누를지 말지는 대개 그걸 보고
 * 정하게 되므로 HUD 안에 둔다.
 *
 * 하루는 자정이 아니라 새벽 5시에 바뀐다. 그리고 어느 날 몫인지는 앉은 시각으로
 * 정하기 때문에, 새벽 2시에 시작해 6시까지 한 공부는 전날에 그대로 붙는다.
 */
function TodayStudy({ rows, fleet }) {
  /* 지금 공부 중인 사람은 아직 로그가 없다(로그는 끝낼 때 쓴다). 진행 중인
   * 시간은 여기서 세션 시작 시각으로부터 세어 보여준다 — 1분마다 다시 그린다. */
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  const live = new Map(fleet.map((f) => [f.uid, f]))
  const list = rows
    .map((r) => {
      const f = live.get(r.uid)
      const startedAt = f?.isStudying && f?.sessionStartedAt ? new Date(f.sessionStartedAt) : null
      return {
        ...r,
        studying: !!startedAt,
        /* 진행 중인 세션은 아직 로그가 없다(로그는 끝낼 때 쓴다). 그래서 세션
         * 시작 시각에서 흐른 만큼을 여기서 세어 합계에 더한다 — 화면의 숫자는
         * 늘 "지금 이 순간까지의 누적"이다. 따로 "+42분"으로 떼어 보여주면
         * 어느 쪽이 합계인지 헷갈려서 하나로 합쳤다. 상대가 기록을 취소하면
         * 다음 갱신(20초) 때 줄어든 값이 그대로 반영된다. */
        runningMinutes: startedAt
          ? Math.max(0, Math.floor((now - startedAt.getTime()) / 60000))
          : 0,
      }
    })
    /* 지금 앉아 있는 사람을 맨 위로. 그다음은 오늘 많이 한 순서다. */
    .sort(
      (a, b) =>
        Number(b.studying) - Number(a.studying) ||
        b.todayMinutes + b.runningMinutes - (a.todayMinutes + a.runningMinutes),
    )

  const me = list.find((r) => r.isMe)
  const total = (r) => r.todayMinutes + r.runningMinutes
  const studyingCount = list.filter((r) => r.studying).length

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-baseline justify-between border-b border-white/8 px-4 py-3">
        <span className="text-[15px] font-bold tracking-wider text-orbit-cyan uppercase">
          오늘의 공부
        </span>
        <span className="text-[12px] text-orbit-dim">새벽 5시부터</span>
      </div>

      {/* 내 오늘치를 크게. 남과 견주기 전에 내가 얼마나 했는지부터 보여야 한다. */}
      <div className="border-b border-white/8 px-4 py-4 text-center">
        <div className="num text-[34px] leading-none font-extrabold text-orbit-cyan neon">
          {me ? fmtDuration(total(me)) : '0분'}
        </div>
        {/* 할 말이 있을 때만 한 줄. "지금은 공부 중이 아닙니다"는 아무것도
            알려주지 않으면서 자리만 차지했다. */}
        {(me?.studying || studyingCount > 0) && (
          <div className="mt-1.5 text-[13px] text-orbit-dim">
            {me?.studying && <span className="text-orbit-cyan">지금 공부 중</span>}
            {me?.studying && studyingCount > 1 && ' · '}
            {(!me?.studying || studyingCount > 1) && `반에서 ${studyingCount}명 공부 중`}
          </div>
        )}
      </div>

      {!list.length ? (
        <p className="px-4 py-5 text-center text-[14px] text-orbit-dim">기록이 없습니다.</p>
      ) : (
        <div className="divide-y divide-white/6">
          {list.map((r) => (
            <div
              key={r.uid}
              className={`flex items-center gap-2.5 px-4 py-2.5 ${r.isMe ? 'bg-orbit-cyan/8' : ''} ${
                total(r) === 0 && !r.studying ? 'opacity-45' : ''
              }`}
            >
              {/* 앉아 있는 사람만 점이 뛴다. 없으면 자리만 비워 줄을 맞춘다. */}
              <span className="flex h-2 w-2 shrink-0 items-center justify-center">
                {r.studying && (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-orbit-cyan shadow-[0_0_6px_var(--color-orbit-cyan)]" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                {r.nickname}
                {r.isMe && <span className="ml-1.5 text-[13px] text-orbit-cyan">나</span>}
              </span>
              <span
                className={`num w-20 shrink-0 text-right text-[15px] font-bold ${
                  total(r) > 0 ? 'text-orbit-text' : 'text-orbit-dim'
                }`}
              >
                {fmtDuration(total(r))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* 같은 계정의 다른 기기가 공부 중일 때.
 *
 * 세션은 계정당 하나다. 폰에서 타이머를 돌려 두고 태블릿을 열면 예전엔 태블릿도
 * 똑같은 공부 화면을 띄웠고, 거기서 정지를 누르면 폰에서 하던 공부가 끝났다.
 * 여기서는 흘러가는 시간만 보여주고 정지·기록은 안 준다.
 *
 * 다만 잠기지는 않게 한다 — 폰을 잃어버렸거나 앱을 지웠으면 영영 못 끝내므로,
 * 이어받으면 지금까지 한 시간을 그대로 안고 이 기기가 주인이 된다. */
function OtherDeviceSession({ startedAt, onTakeover, busy, error }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const sec = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const hh = String(Math.floor(sec / 3600)).padStart(2, '0')
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0')
  const ss = String(sec % 60).padStart(2, '0')

  return (
    <div className="space-y-4">
      <div className="panel panel-cyan flex flex-col items-center gap-2 py-8 text-center">
        <Smartphone className="h-9 w-9 text-orbit-cyan opacity-80" />
        <p className="text-[16px] font-bold text-orbit-cyan">다른 기기에서 공부 중입니다</p>
        <div className="num mt-1 text-[42px] leading-none font-extrabold text-orbit-cyan neon">
          {hh}:{mm}:{ss}
        </div>
        <p className="mt-1 px-8 text-[14px] leading-relaxed text-orbit-dim">
          한 번에 한 기기에서만 공부할 수 있습니다. 그 기기에서 정지하면 기록됩니다.
        </p>
      </div>

      <OrbitButton variant="ghost" className="w-full" disabled={busy} onClick={onTakeover}>
        {busy ? '넘겨받는 중…' : '이 기기에서 이어하기'}
      </OrbitButton>
      <p className="px-1 text-[13px] leading-relaxed text-orbit-dim">
        지금까지 잰 시간은 그대로 이어집니다. 그 기기에서는 더 이상 정지할 수 없게 됩니다.
      </p>
      {error && <p className="text-[14px] text-orbit-red">{error}</p>}
    </div>
  )
}

/* ---------------- 화면 ---------------- */

const VIEWS = [
  { id: 'hud', label: 'HOME' },
  { id: 'map', label: 'MAP' },
  { id: 'combat', label: 'Oper.' },
  { id: 'time', label: '공부시간' },
]

/* OPER 안쪽 갈래. 공격·방어·기록은 하는 일이 달라서 한 화면에 다 늘어놓으면
 * 쏘러 들어온 사람이 방어막 값을 지나쳐 스크롤해야 했다. */
const OPER_TABS = [
  { id: 'attack', label: '공격' },
  { id: 'shield', label: '방어막' },
  { id: 'log', label: 'log' },
]

export default function Orbit() {
  const [state, setState] = useState({ phase: 'loading' })
  const [view, setView] = useState('hud')
  const [session, setSession] = useState(null)
  // 정지를 누르면 기록 입력 화면으로 넘어간다. 이때도 세션은 아직 살아 있다.
  const [finishing, setFinishing] = useState(false)
  const [saving, setSaving] = useState({ busy: false, error: null })
  /* 화면 전환 연출. null이거나 { dir: 'launch' | 'return', phase: 'out' | 'move' }.
   * 'out' — 지금 화면의 계기가 빠진다(함선은 그대로 남는다).
   * 'move' — 화면이 바뀌고, 함선이 layoutId를 타고 새 자리로 난다.
   * 끝나면 null로 돌아가고 도착한 화면의 계기가 뜬다. */
  const [transit, setTransit] = useState(null)
  /* uid → 프사(data URL). 함선 옆에 띄운다. 프사는 자주 안 바뀌니 20초 폴링에
   * 얹지 않고 들어올 때 한 번만 받는다. */
  const [photos, setPhotos] = useState({})
  const seq = useRef(0)

  const load = useCallback(async () => {
    const my = ++seq.current
    try {
      /* 요청 한 번이면 된다. 예전엔 status를 받고 그게 끝나야 다섯 개를 더
       * 불러서, 왕복이 두 겹으로 쌓이고 서버는 같은 걸 여러 번 읽었다. */
      const today = new Date(Date.now() + 9 * 3600e3 - 5 * 3600e3).toISOString().slice(0, 10)
      const boot = await bootOrbit(today)
      if (seq.current !== my) return

      if (!boot.status.joined) {
        /* 방에 들어온 사람은 곧 참가자다 — "사용해보기" 단추를 또 누르게
         * 하지 않고 그 자리에서 배를 받아 다시 읽는다. */
        await joinOrbit()
        const again = await bootOrbit(today)
        if (seq.current !== my) return
        setSession(again.session?.sessionId ? again.session : null)
        setState({
          phase: 'in',
          status: again.status,
          ship: again.ship,
          fleet: again.fleet,
          ranking: again.ranking,
          missiles: again.missiles,
        })
        return
      }
      setSession(boot.session?.sessionId ? boot.session : null)
      setState({
        phase: 'in',
        status: boot.status,
        ship: boot.ship,
        fleet: boot.fleet,
        ranking: boot.ranking,
        missiles: boot.missiles,
      })
    } catch (e) {
      if (seq.current === my) setState({ phase: 'error', message: e.message })
    }
  }, [])

  useEffect(() => {
    load()
    fetchRoomPhotos()
      .then(setPhotos)
      .catch(() => {})
  }, [load])

  /* 계기가 다 빠지면 화면을 바꾼다. 이때 함선은 두 화면 양쪽에 다 있으므로
   * layoutId가 이어받아 옛 자리에서 새 자리로 날아간다 — 함선은 한순간도
   * 사라지지 않는다. */
  useEffect(() => {
    if (transit?.phase !== 'out') return
    const t = setTimeout(() => {
      if (transit.dir === 'return') {
        setSession(null)
        setFinishing(false)
      }
      setTransit({ dir: transit.dir, phase: 'move' })
    }, TRANSIT_OUT_MS)
    return () => clearTimeout(t)
  }, [transit])

  /* 함선이 도착하면 연출이 끝난다 — 그제서야 그 화면의 계기가 뜬다. */
  useEffect(() => {
    if (transit?.phase !== 'move') return
    const t = setTimeout(() => setTransit(null), TRANSIT_MOVE_MS)
    return () => clearTimeout(t)
  }, [transit])

  /* 맵의 위치·미사일은 서버가 계산해 주므로, 남이 공부하거나 쏜 걸 보려면 주기적으로
   * 다시 받아야 한다. 화면을 보고 있을 때만 20초마다.
   *
   * 착탄 처리도 이 요청이 들여다볼 때 서버에서 일어난다 — 예약 타이머를 안 쓰기
   * 때문이다(server/orbit/combat.js 참고). */
  useEffect(() => {
    if (state.phase !== 'in') return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 20000)
    return () => clearInterval(t)
  }, [state.phase, load])

  if (!hasFirebase) {
    return (
      <div className="rounded-card p-8 text-center text-[15px] text-orbit-dim">
        Study Orbital은 Firebase 설정이 있어야 씁니다.
      </div>
    )
  }

  if (state.phase === 'loading') {
    /* 화면 한가운데 놓는다. 위쪽에 한 줄만 띄우면 빈 화면에 글자가 떠 있는 것
     * 같아서, 뭘 기다리는 중인지 아니면 고장인지 구분이 안 된다. */
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="flicker text-[26px] font-bold tracking-widest text-orbit-cyan neon">
          Loading...
        </p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="panel panel-red space-y-3 p-5">
        <p className="text-[15px] leading-relaxed text-orbit-red">{state.message}</p>
        <OrbitButton variant="ghost" className="w-full" onClick={load}>
          다시 시도
        </OrbitButton>
      </div>
    )
  }

  if (state.phase === 'join') return <JoinCard onJoined={load} />

  /* 세션이 도는 동안엔 탭 전체가 공부 화면이다. 원본도 별도 화면이었고, 달리는
   * 중에 항로맵이나 무기고를 볼 이유가 없다. */
  /* 다른 기기가 돌리는 세션이면 구경만 한다. 여기서 정지를 누르면 저쪽에서
   * 하던 공부가 끝나 버린다. */
  if (session && session.mine === false) {
    return (
      <OtherDeviceSession
        startedAt={session.startedAt}
        busy={saving.busy}
        error={saving.error}
        onTakeover={async () => {
          setSaving({ busy: true, error: null })
          try {
            setSession(await startSession(true))
            setSaving({ busy: false, error: null })
          } catch (e) {
            /* 다섯 시간이 넘어 무효가 된 세션은 서버가 이미 지웠다. 화면도
             * 놓아줘야 한다 — 붙잡고 있으면 정지가 계속 실패한다. */
            if (e.voided) {
              setSession(null)
              setFinishing(false)
              load()
            }
            setSaving({ busy: false, error: e.message })
          }
        }}
      />
    )
  }

  /* 'out' 박자에는 아직 떠날 화면이 그대로 있다 — 계기만 빠진다.
   * 'move'로 넘어가는 순간 화면이 바뀌고, 그 사이 함선은 layoutId로 이어진다. */
  const leavingHome = transit?.dir === 'launch' && transit.phase === 'out'
  const showStudy = session && !leavingHome
  /* 연출 중엔 어느 쪽 계기든 숨는다 — 보이는 건 함선과 별밭뿐이다. */
  const dim = transit !== null
  return (
    <>
      <AnimatePresence>
        {transit?.phase === 'move' && <WarpTrails dir={transit.dir} />}
      </AnimatePresence>
      {showStudy ? (
        <StudySession
          dim={dim}
          session={session}
          ship={state.ship}
          fleet={state.fleet}
          missiles={state.missiles}
          finishing={finishing}
          busy={saving.busy}
          error={saving.error}
          onStop={() => {
            setFinishing((f) => !f)
            setSaving({ busy: false, error: null })
          }}
          onCancel={async () => {
            await cancelSession().catch(() => {})
            setSession(null)
            setFinishing(false)
            load()
          }}
          onFinish={async () => {
            setSaving({ busy: true, error: null })
            try {
              await endSession({
                sessionId: session.sessionId,
                // 실제 판정은 서버가 자기가 기억한 시작 시각으로 한다.
                durationMinutes: Math.max(
                  1,
                  Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 60000),
                ),
              })
              setSaving({ busy: false, error: null })
              /* 세션은 아직 지우지 않는다 — 계기가 빠지는 동안 공부 화면은
               * 그대로 있어야 한다. 지우는 건 'move'로 넘어갈 때. */
              setTransit({ dir: 'return', phase: 'out' })
              load()
            } catch (e) {
              setSaving({ busy: false, error: e.message })
            }
          }}
        />
      ) : (
        <div className={`space-y-4 ${dim ? 'pointer-events-none' : ''}`}>
          <Fading
            dim={dim}
            className="flex gap-1 rounded-control border border-white/10 bg-white/5 p-1"
          >
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`flex-1 rounded px-2 py-2 text-[14px] font-bold tracking-wider uppercase transition ${
                  view === v.id
                    ? 'bg-orbit-cyan text-orbit-bg'
                    : 'text-orbit-dim hover:text-orbit-text'
                }`}
              >
                {v.label}
              </button>
            ))}
          </Fading>

          {state.status.noFlyZone && (
            <p className="rounded-control border border-orbit-amber/30 bg-orbit-amber/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-orbit-amber">
              항해 금지 시간대 — 평일 수업시간엔 세션을 시작하거나 공격할 수 없습니다.
            </p>
          )}

          {view === 'hud' && (
            <div className="space-y-4">
              {/* 함선은 연출 내내 보인다 — 숫자만 빠진다. */}
              <ShipHero ship={state.ship} isStudying={false} dim={dim} />
              <Fading dim={dim} delay={0.12} className="space-y-4">
                {/* 날아오는 게 있으면 함선 상태 바로 다음에 알린다 — 방어막을 살지
                말지가 여기서 갈린다. 없으면 아무것도 안 그린다. */}
                <IncomingMissiles missiles={state.missiles} fleet={state.fleet} />
                <EngineStart
                  noFlyZone={state.status.noFlyZone}
                  onStart={async () => {
                    setFinishing(false)
                    try {
                      const s = await startSession()
                      setSession(s)
                      setTransit({ dir: 'launch', phase: 'out' })
                    } catch (e) {
                      /* 다른 기기가 이미 돌리고 있으면 에러로 끝내지 않는다. 그 세션을
                       * 보여주고 이어받을지 물어본다. */
                      if (!e.otherDevice) throw e
                      setSession({ sessionId: null, startedAt: e.startedAt, mine: false })
                    }
                  }}
                />
                <ShipStats ship={state.ship} />
                <TodayStudy rows={state.ranking} fleet={state.fleet} />
              </Fading>
            </div>
          )}

          {view === 'map' && (
            <RouteMap fleet={state.fleet} missiles={state.missiles} photos={photos} />
          )}

          {view === 'combat' && (
            <Combat
              ship={state.ship}
              fleet={state.fleet}
              missiles={state.missiles}
              onChanged={load}
            />
          )}

          {view === 'time' && <StudyTime rows={state.ranking} onChanged={load} />}
        </div>
      )}
    </>
  )
}
