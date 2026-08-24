import { useState } from 'react'
import AuthGate from './components/AuthGate'
import RoomGate from './components/RoomGate'
import Orbit from './pages/Orbit'
import { OrbitButton } from './components/OrbitButton'
import { Sheet } from './components/ui'
import { leaveRoom } from './lib/rooms'
import { logout } from './lib/firebase'

/* Study Orbital 앱 껍데기.
 *
 * 문이 두 개다: 로그인(AuthGate) → 방(RoomGate). 둘 다 통과하면 Orbit 화면이
 * 곧 앱이다 — Sevenly에서는 탭 하나였지만 여기서는 이게 전부라, 항상 어두운
 * 콕핏(.orbit)이다.
 */
export default function App() {
  return (
    <div className="orbit flex min-h-dvh flex-col">
      <AuthGate>
        <RoomGate>{({ me, refresh }) => <Main me={me} refresh={refresh} />}</RoomGate>
      </AuthGate>
    </div>
  )
}

function Main({ me, refresh }) {
  const [roomOpen, setRoomOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <>
      {/* 상단 바 — 서비스 이름과 지금 방. 방 이름을 누르면 초대코드가 뜬다. */}
      <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        <div className="neon text-[18px] leading-none font-bold tracking-widest text-orbit-cyan">
          STUDY ORBITAL
        </div>
        <button
          onClick={() => setRoomOpen(true)}
          className="flex min-w-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[13px] font-semibold text-orbit-text"
        >
          <span className="max-w-[9rem] truncate">{me.room.name}</span>
          <span className="code shrink-0 text-[11px] text-orbit-dim">{me.room.memberCount}명</span>
        </button>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-10">
        <Orbit />
      </main>

      <Sheet dark center open={roomOpen} onClose={() => setRoomOpen(false)} title={me.room.name}>
        <div className="space-y-4">
          <div className="rounded-xl border border-orbit-cyan/30 bg-orbit-cyan/10 p-4 text-center">
            <div className="text-[12px] font-semibold text-orbit-dim">초대코드</div>
            <div className="code mt-1 text-[30px] font-bold tracking-[0.3em] text-orbit-cyan">
              {me.room.code}
            </div>
          </div>

          <div className="text-center text-[13px] text-orbit-dim">
            참가자 {me.room.memberCount}명
          </div>

          <OrbitButton
            variant="ghost"
            className="w-full"
            disabled={busy}
            onClick={async () => {
              if (!confirm('방을 나갈까요?\n배와 기록은 남습니다 — 코드로 돌아오면 이어서 합니다.'))
                return
              setBusy(true)
              try {
                await leaveRoom()
                setRoomOpen(false)
                await refresh()
              } finally {
                setBusy(false)
              }
            }}
          >
            방 나가기
          </OrbitButton>
          <OrbitButton variant="danger" className="w-full" onClick={logout}>
            로그아웃
          </OrbitButton>
        </div>
      </Sheet>
    </>
  )
}
