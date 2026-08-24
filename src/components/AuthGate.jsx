import { useEffect, useState } from 'react'
import { hasFirebase, loginWithPin, signUpWithPin, watchAuth } from '../lib/firebase'
import { OrbitButton } from './OrbitButton'

/* 로그인 문. 통과하면 children(앱 본체)이 보인다.
 *
 * Sevenly와 같은 자체 계정(이름+비밀번호)이지만, 이름이 반이 아니라 서비스
 * 전체에서 유일하다 — 로그인 아이디이자 함선에 뜨는 이름이다. */
export default function AuthGate({ children }) {
  const [phase, setPhase] = useState(hasFirebase ? 'loading' : 'nofb')
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!hasFirebase) return
    return watchAuth((user) => setPhase(user ? 'in' : 'out'))
  }, [])

  async function submit() {
    setErr(null)
    if (!name.trim()) return setErr('이름을 입력하세요.')
    if (!/^\d{4,8}$/.test(pin)) return setErr('비밀번호는 숫자 4~8자리입니다.')
    if (mode === 'signup' && pin !== pin2) return setErr('비밀번호가 서로 다릅니다.')
    setBusy(true)
    try {
      if (mode === 'signup') await signUpWithPin(name.trim(), pin)
      else await loginWithPin(name.trim(), pin)
      // watchAuth가 phase를 'in'으로 바꿔준다.
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'in') return children
  if (phase === 'loading') {
    return <div className="grid min-h-dvh place-items-center text-orbit-dim">확인 중…</div>
  }
  if (phase === 'nofb') {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center text-orbit-dim">
        서버에 Firebase 설정이 없습니다. VITE_FIREBASE_* 환경변수를 넣고 다시 배포하세요.
      </div>
    )
  }

  const input =
    'w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3.5 text-[16px] text-orbit-text placeholder:text-orbit-dim/40 focus:border-orbit-cyan focus:outline-none'

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <h1 className="neon text-center text-[34px] leading-tight font-bold tracking-widest text-orbit-cyan">
        STUDY
        <br />
        ORBITAL
      </h1>
      <p className="mt-2 mb-8 text-center text-[14px] text-orbit-dim">
        공부한 시간이 우주선의 연료가 됩니다
      </p>

      <div className="w-full max-w-sm space-y-3">
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
          {[
            ['login', '로그인'],
            ['signup', '계정 만들기'],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                setMode(id)
                setErr(null)
              }}
              className={`flex-1 rounded-lg py-2.5 text-[14px] font-bold transition ${
                mode === id ? 'bg-orbit-cyan/15 text-orbit-cyan' : 'text-orbit-dim'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          className={input}
          placeholder="이름 (함선에 뜨는 이름)"
          value={name}
          maxLength={12}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={input}
          type="password"
          inputMode="numeric"
          placeholder="비밀번호 (숫자 4~8자리)"
          value={pin}
          maxLength={8}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
        {mode === 'signup' && (
          <input
            className={input}
            type="password"
            inputMode="numeric"
            placeholder="비밀번호 다시 입력"
            value={pin2}
            maxLength={8}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
          />
        )}

        {err && <p className="text-[13px] text-orbit-red">{err}</p>}

        <OrbitButton className="w-full" disabled={busy} onClick={submit}>
          {busy ? '들어가는 중…' : mode === 'signup' ? '가입하고 시작하기' : '로그인'}
        </OrbitButton>

        {mode === 'signup' && (
          <p className="text-center text-[12px] leading-relaxed text-orbit-dim/70">
            이름은 서비스 전체에서 하나뿐입니다 — 로그인할 때도 이 이름을 씁니다.
          </p>
        )}
      </div>
    </div>
  )
}
