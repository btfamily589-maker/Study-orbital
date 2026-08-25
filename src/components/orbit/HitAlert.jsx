import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getAttackLog } from '../../lib/orbit'
import { OrbitButton } from '../OrbitButton'

/* 피격 알림.
 *
 * 미사일은 쏘고 몇 시간 뒤에 떨어진다. 푸시는 폰이 잠겨 있을 때를 위한 것이고,
 * 앱을 보고 있는 동안 맞으면 화면 한가운데에 창을 띄워 본인이 확인을 눌러야
 * 사라지게 한다 — 에너지가 왜 깎였는지 모른 채 지나가지 않게.
 *
 * 무엇을 "새 피격"으로 보는가: 나를 겨눈 공격 중 판정이 끝난(status: 'hit')
 * 것들. 한 번 확인한 것은 기기에 적어 두고 다시 띄우지 않는다. 처음 켠 기기는
 * 예전 것까지 우르르 뜨면 곤란하므로, 첫 조회분은 조용히 확인 처리한다.
 */
const SEEN_KEY = 'orbital:hits-seen'
const SEEN_MAX = 200

function loadSeen() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function saveSeen(ids) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-SEEN_MAX)))
  } catch {
    /* 저장소가 막힌 브라우저면 이번 세션 동안만 기억한다 */
  }
}

const LABEL = { emp: 'EMP', missile_basic: 'Missile', missile_nuke: 'Nuclear' }

/** 폴링 주기. Orbit 화면의 새로고침과 같은 박자다. */
const POLL_MS = 20000

export function HitAlert() {
  const [queue, setQueue] = useState([])
  const seen = useRef(null)
  const primed = useRef(false)

  const check = useCallback(async () => {
    try {
      const log = await getAttackLog(60)
      if (!Array.isArray(log)) return
      if (seen.current === null) seen.current = new Set(loadSeen())

      /* 앱을 켜고 나서 첫 조회분은 지난 기록이지 새 피격이 아니다 — 조용히
       * 확인 처리한다. 피격이 없어도 priming은 해둬야, 그다음 조회에서 오는
       * 진짜 새 피격이 삼켜지지 않는다. */
      const first = !primed.current
      primed.current = true

      const hits = log.filter((a) => a.isTarget && a.status === 'hit' && !seen.current.has(a.id))
      if (!hits.length) return

      for (const h of hits) seen.current.add(h.id)
      saveSeen([...seen.current])

      if (first) return
      // 오래된 것부터 차례로 보여준다.
      setQueue((q) => [...q, ...hits.sort((a, b) => a.impactAt - b.impactAt)])
    } catch {
      /* 알림은 부가 기능이다 — 실패해도 화면은 그대로 쓴다 */
    }
  }, [])

  useEffect(() => {
    check()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') check()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [check])

  const cur = queue[0]

  return (
    <AnimatePresence>
      {cur && (
        <motion.div
          key="hit-alert"
          className="fixed inset-0 z-[60] grid place-items-center bg-black/70 px-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="w-full max-w-sm rounded-card border-2 border-orbit-red/60 bg-orbit-panel p-6 text-center"
            style={{ boxShadow: '0 0 40px rgba(255,0,0,0.35)' }}
            initial={{ scale: 0.88, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
          >
            {/* 붉은 경보가 두 번 크게 뛴다 — 소리 없이도 "맞았다"가 읽힌다. */}
            <motion.div
              className="mx-auto grid h-16 w-16 place-items-center rounded-full border-2 border-orbit-red bg-orbit-red/15"
              animate={{ scale: [1, 1.12, 1] }}
              transition={{ duration: 0.7, repeat: 2 }}
            >
              {/* 폭발 버스트 — 앱의 다른 계기들처럼 선 하나에 네온 발광. */}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-9 w-9 text-orbit-red"
                style={{ filter: 'drop-shadow(0 0 6px hsl(0 100% 60% / 0.9))' }}
              >
                <path d="M12 8.1l1.3 2.4 2.7.5-1.9 2 .3 2.8-2.4-1.2-2.4 1.2.3-2.8-1.9-2 2.7-.5z" />
                <path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8" />
              </svg>
            </motion.div>

            <h3 className="mt-4 text-[20px] font-bold text-orbit-red">피격</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-orbit-text">
              <b>{cur.fromNickname}</b>님의 {LABEL[cur.type] ?? '미사일'}에 맞았습니다.
            </p>

            <div className="mt-4 rounded-control border border-orbit-red/30 bg-orbit-red/10 px-4 py-3">
              {cur.damageDealt > 0 ? (
                <div className="num text-[26px] font-extrabold text-orbit-red">
                  −{Math.round(cur.damageDealt * 10) / 10}
                  <span className="ml-1 text-[15px] font-bold">E</span>
                </div>
              ) : (
                <div className="text-[15px] font-bold text-orbit-cyan">방어막이 막아냈습니다</div>
              )}
            </div>

            {queue.length > 1 && (
              <p className="mt-3 text-[12px] text-orbit-dim">
                확인할 피격이 {queue.length - 1}건 더 있습니다
              </p>
            )}

            <OrbitButton
              className="mt-5 w-full"
              onClick={() => setQueue((q) => q.slice(1))}
              autoFocus
            >
              확인
            </OrbitButton>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
