import { useCallback, useEffect, useState } from 'react'
import { fetchMe, createRoom, joinRoom } from '../lib/rooms'
import { logout } from '../lib/firebase'
import { OrbitButton } from './OrbitButton'

/* 방 문. 로그인은 됐는데 아직 방이 없으면 여기서 만들거나 초대코드로 들어간다.
 * 방이 있으면 children(Orbit 화면)에 { me, refresh }를 넘겨 그린다. */
export default function RoomGate({ children }) {
  const [me, setMe] = useState(null) // null = 불러오는 중
  const [err, setErr] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setMe(await fetchMe())
      setErr(null)
    } catch (e) {
      setErr(e.message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (err) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <p className="text-[15px] text-orbit-red">{err}</p>
          <OrbitButton variant="ghost" className="mt-4" onClick={refresh}>
            다시 시도
          </OrbitButton>
        </div>
      </div>
    )
  }
  if (!me) {
    return <div className="grid min-h-dvh place-items-center text-orbit-dim">확인 중…</div>
  }
  if (me.room) return children({ me, refresh })

  return <RoomPicker onDone={refresh} />
}

function RoomPicker({ onDone }) {
  const [mode, setMode] = useState('join') // 'join' | 'create'
  const [code, setCode] = useState('')
  const [roomName, setRoomName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function submit() {
    setErr(null)
    setBusy(true)
    try {
      if (mode === 'create') {
        if (!roomName.trim()) throw new Error('방 이름을 입력하세요.')
        await createRoom(roomName.trim())
      } else {
        if (!code.trim()) throw new Error('초대코드를 입력하세요.')
        await joinRoom(code.trim())
      }
      await onDone()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const input =
    'w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3.5 text-[16px] text-orbit-text placeholder:text-orbit-dim/40 focus:border-orbit-cyan focus:outline-none'

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <h1 className="neon text-center text-[26px] font-bold tracking-widest text-orbit-cyan">
        STUDY ORBITAL
      </h1>
      <p className="mt-2 mb-8 text-center text-[14px] leading-relaxed text-orbit-dim">
        친구들과 같은 방에 있어야 같은 맵에서 경쟁합니다.
      </p>

      <div className="w-full max-w-sm space-y-3">
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
          {[
            ['join', '초대코드로 참가'],
            ['create', '새 방 만들기'],
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

        {mode === 'join' ? (
          <input
            className={`${input} code text-center text-[22px] tracking-[0.35em] uppercase`}
            placeholder="초대코드"
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        ) : (
          <input
            className={input}
            placeholder="방 이름 (예: 3반 스터디, 물리 팟)"
            value={roomName}
            maxLength={20}
            onChange={(e) => setRoomName(e.target.value)}
          />
        )}

        {err && <p className="text-[13px] text-orbit-red">{err}</p>}

        <OrbitButton className="w-full" disabled={busy} onClick={submit}>
          {busy ? '진입 중…' : mode === 'create' ? '방 만들고 출항' : '방에 들어가기'}
        </OrbitButton>

        <p className="text-center text-[12px] leading-relaxed text-orbit-dim/70">
          {mode === 'create'
            ? '방을 만들면 초대코드가 생깁니다 — 친구들에게 알려주세요. 만든 사람이 방장이 됩니다.'
            : '초대코드는 방을 만든 친구의 화면 위쪽에 있습니다.'}
        </p>

        <button
          onClick={logout}
          className="mx-auto block pt-2 text-[12px] text-orbit-dim/60 underline-offset-2 hover:underline"
        >
          로그아웃
        </button>
      </div>
    </div>
  )
}
