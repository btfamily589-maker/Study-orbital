import { useState } from 'react'
import AuthGate from './components/AuthGate'
import RoomGate from './components/RoomGate'
import Orbit from './pages/Orbit'
import OrbitAdmin from './components/OrbitAdmin'
import { Starfield } from './components/orbit/Starfield'
import { OrbitButton } from './components/OrbitButton'
import { Sheet } from './components/ui'
import { leaveRoom, setMyPhoto } from './lib/rooms'
import { compressProfilePhoto } from './lib/photo'
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
  const [adminOpen, setAdminOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <>
      {/* 별밭은 화면이 바뀌어도 그대로 있어야 한다 — 여기 한 번만 깐다. */}
      <Starfield />
      {/* 상단 바 — 서비스 이름과 지금 방. 방 이름을 누르면 초대코드가 뜬다. */}
      <header className="relative z-10 flex items-center justify-between gap-3 px-5 pt-4 pb-2">
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

      <main className="relative z-10 mx-auto w-full max-w-xl flex-1 px-4 pb-10">
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

          <PhotoRow me={me} refresh={refresh} />

          {me.room.isOwner && (
            <OrbitButton
              className="w-full"
              onClick={() => {
                setRoomOpen(false)
                setAdminOpen(true)
              }}
            >
              방장 설정
            </OrbitButton>
          )}
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

      <Sheet dark full open={adminOpen} onClose={() => setAdminOpen(false)} title="방장 설정">
        {adminOpen && <OrbitAdmin />}
      </Sheet>
    </>
  )
}

/* 프사 줄 — 내 사진과 바꾸기/지우기. 함선 옆에 뜨는 사진이다.
 * 예전 Replit 앱의 프로필 사진을 옮겨온 것: 클라이언트에서 160px로 줄여 올린다. */
function PhotoRow({ me, refresh }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function save(photo) {
    setBusy(true)
    setErr(null)
    try {
      await setMyPhoto(photo)
      await refresh()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/12 bg-white/5 p-3">
      {me.photo ? (
        <img
          src={me.photo}
          alt="프사"
          className="h-12 w-12 shrink-0 rounded-full border border-orbit-cyan/50 object-cover"
        />
      ) : (
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 text-[17px] font-bold text-orbit-dim">
          {me.name.slice(0, 1)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">프사</div>
        <div className="text-[12px] text-orbit-dim">함선 옆에 뜹니다</div>
        {err && <div className="mt-0.5 text-[12px] text-orbit-red">{err}</div>}
      </div>
      <label className="shrink-0 cursor-pointer rounded-lg bg-orbit-cyan/15 px-3 py-2 text-[13px] font-bold text-orbit-cyan">
        {busy ? '올리는 중…' : me.photo ? '바꾸기' : '올리기'}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            try {
              await save(await compressProfilePhoto(file))
            } catch (er) {
              setErr(er.message)
            }
          }}
        />
      </label>
      {me.photo && (
        <button
          disabled={busy}
          onClick={() => save(null)}
          className="shrink-0 rounded-lg px-2 py-2 text-[13px] font-semibold text-orbit-dim"
        >
          지우기
        </button>
      )}
    </div>
  )
}
