import { useEffect, useState } from 'react'
import { getOrbitSettings, saveOrbitSettings, simulateOrbit, resetOrbit } from '../lib/orbit'
import { OrbitButton } from './OrbitButton'

/* 방장 설정 — Sevenly 설정의 Study Orbital 칸을 이 사이트 방장 몫으로 옮긴 것.
 * 항해 금지 시간대, 시뮬레이션, 전체 초기화.
 * 서버 쪽 권한은 orbit admin 라우터가 본다(방 명부의 role === 'admin'). */
export default function OrbitAdmin() {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [nfz, setNfz] = useState(null)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  async function load() {
    try {
      setNfz(await getOrbitSettings())
      setLoadError(null)
    } catch (e) {
      setLoadError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  /** 버튼 하나를 눌렀을 때 공통 처리 — 잠그고, 돌리고, 결과를 보여주고, 새로 읽는다. */
  async function run(key, fn, confirmText) {
    if (confirmText && !confirm(confirmText)) return
    setBusy(key)
    setErr(null)
    setMsg(null)
    try {
      const r = await fn()
      if (r?.message) setMsg(r.message)
      await load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <p className="py-6 text-center text-[14px] text-orbit-dim">불러오는 중…</p>
  }
  if (loadError || !nfz) {
    return (
      <div className="space-y-3">
        <p className="text-[14px] text-orbit-red">{loadError ?? '설정을 불러오지 못했습니다.'}</p>
        <OrbitButton variant="ghost" className="w-full" onClick={load}>
          다시 시도
        </OrbitButton>
      </div>
    )
  }

  const timeInput =
    'min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-[15px] text-orbit-text focus:border-orbit-cyan focus:outline-none disabled:opacity-40'

  return (
    <div className="space-y-4">
      {/* 항해 금지 시간대 */}
      <section className="rounded-xl border border-white/12 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[15px] font-bold">항해 금지 시간대</div>
            <div className="mt-0.5 text-[12px] leading-relaxed text-orbit-dim">
              이 시간엔 공부 세션도 공격도 못 합니다. 주말·공휴일은 자동으로 빠집니다.
            </div>
          </div>
          <button
            onClick={() => setNfz({ ...nfz, nfzEnabled: !nfz.nfzEnabled })}
            className={`h-7 w-12 shrink-0 rounded-full transition ${
              nfz.nfzEnabled ? 'bg-orbit-cyan' : 'bg-white/15'
            }`}
            aria-pressed={nfz.nfzEnabled}
          >
            <span
              className={`block h-6 w-6 rounded-full bg-white transition ${
                nfz.nfzEnabled ? 'translate-x-[22px]' : 'translate-x-[2px]'
              }`}
            />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            type="time"
            className={timeInput}
            value={nfz.nfzStart}
            disabled={!nfz.nfzEnabled}
            onChange={(e) => setNfz({ ...nfz, nfzStart: e.target.value })}
          />
          <span className="shrink-0 text-[13px] text-orbit-dim">부터</span>
          <input
            type="time"
            className={timeInput}
            value={nfz.nfzEnd}
            disabled={!nfz.nfzEnabled}
            onChange={(e) => setNfz({ ...nfz, nfzEnd: e.target.value })}
          />
        </div>

        <OrbitButton
          className="mt-3 w-full"
          disabled={busy === 'settings'}
          onClick={() => run('settings', () => saveOrbitSettings(nfz))}
        >
          {busy === 'settings' ? '저장하는 중…' : '시간대 저장'}
        </OrbitButton>
      </section>

      {/* 테스트·초기화 */}
      <section className="space-y-3 rounded-xl border border-white/12 bg-white/5 p-4">
        <div>
          <div className="text-[15px] font-bold">시뮬레이션</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-orbit-dim">
            함선을 흩어놓고 미사일을 띄워 화면이 실제로 어떻게 보이는지 확인합니다. 기존 게임 상태는
            덮어씁니다.
          </div>
        </div>
        <OrbitButton
          variant="ghost"
          className="w-full"
          disabled={busy === 'sim'}
          onClick={() =>
            run(
              'sim',
              simulateOrbit,
              '지금 함선 상태와 기록을 덮어쓰고 테스트용 상황을 만듭니다. 계속할까요?',
            )
          }
        >
          {busy === 'sim' ? '만드는 중…' : '복잡한 상황 만들기'}
        </OrbitButton>
        <OrbitButton
          variant="danger"
          className="w-full"
          disabled={busy === 'reset'}
          onClick={() => {
            if (
              !confirm('공부 기록·공격 기록을 모두 지우고 함선을 새것으로 되돌립니다.\n계속할까요?')
            )
              return
            if (!confirm('정말로 전부 초기화할까요? 되돌릴 수 없습니다.')) return
            run('reset', resetOrbit)
          }}
        >
          {busy === 'reset' ? '초기화 중…' : '게임 상태 전체 초기화'}
        </OrbitButton>
      </section>

      {msg && (
        <p className="rounded-xl border border-orbit-cyan/30 bg-orbit-cyan/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-orbit-cyan">
          {msg}
        </p>
      )}
      {err && (
        <p className="rounded-xl border border-orbit-red/30 bg-orbit-red/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-orbit-red">
          {err}
        </p>
      )}
    </div>
  )
}
