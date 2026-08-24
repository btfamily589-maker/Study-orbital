import { useEffect, useState } from 'react'
import { Bell, BellOff, Users } from 'lucide-react'
import AuthGate from './components/AuthGate'
import RoomGate from './components/RoomGate'
import Orbit from './pages/Orbit'
import OrbitAdmin from './components/OrbitAdmin'
import { Starfield } from './components/orbit/Starfield'
import { OrbitButton } from './components/OrbitButton'
import { Sheet } from './components/ui'
import { createRoom, joinRoom, leaveRoom, setMyPhoto, switchRoom } from './lib/rooms'
import { ensurePushRegistered, isPushRegistered, listenForegroundMessages } from './lib/push'
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

  /* 알림은 무조건 켠다 — 앱이 뜨고 잠깐 뒤, 그리고 첫 터치 때 한 번 더
   * 권한을 묻고 조용히 등록한다. iOS(PWA)는 터치 없이 권한 창을 안 띄워서
   * 첫 터치 쪽이 실제로 잡아 준다. 이미 허락된 기기는 창 없이 토큰만 갱신. */
  useEffect(() => {
    listenForegroundMessages()
    const t = setTimeout(() => ensurePushRegistered(), 3000)
    const once = () => ensurePushRegistered()
    window.addEventListener('pointerdown', once, { once: true })
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', once)
    }
  }, [])
  const [adminOpen, setAdminOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [switchOpen, setSwitchOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <>
      {/* 별밭은 화면이 바뀌어도 그대로 있어야 한다 — 여기 한 번만 깐다. */}
      <Starfield />
      {/* 상단 바 — 서비스 이름과 지금 방. 방 이름을 누르면 초대코드가 뜬다. */}
      <header className="relative z-10 flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        {/* 서비스 이름은 절대 줄바꿈되지 않는다 — 방 이름 칩이 대신 줄어든다. */}
        <div className="neon shrink-0 text-[18px] leading-none font-bold tracking-widest whitespace-nowrap text-orbit-cyan">
          STUDY ORBITAL
        </div>
        {/* 팀 이름 — 서비스 이름과 같은 꼴, 색만 하양. 누르면 방 정보. */}
        <button
          onClick={() => setRoomOpen(true)}
          className="neon min-w-0 truncate text-[18px] leading-none font-bold tracking-widest whitespace-nowrap text-white"
        >
          {me.room.name}
        </button>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-xl flex-1 px-4 pb-28">
        {/* 방을 바꾸면 다른 항로다 — key로 통째로 새로 띄운다. */}
        <Orbit key={me.room.id} />
      </main>

      {/* 하단 중앙 그룹 버튼 — 참여하는 팀 목록을 연다. */}
      <button
        onClick={() => setSwitchOpen(true)}
        aria-label="그룹"
        className="fixed bottom-6 left-1/2 z-40 grid h-14 w-14 -translate-x-1/2 place-items-center rounded-full border border-orbit-cyan/50 bg-[#0a1226]/90 backdrop-blur transition active:scale-95"
        style={{ boxShadow: '0 0 18px rgba(0,212,255,0.35), inset 0 0 12px rgba(0,212,255,0.12)' }}
      >
        <Users
          className="h-6 w-6 text-orbit-cyan"
          style={{ filter: 'drop-shadow(0 0 6px rgba(0,212,255,0.95))' }}
        />
      </button>

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

          <PushRow />

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
              if (
                !confirm('이 방을 나갈까요?\n배와 기록은 남습니다 — 코드로 돌아오면 이어서 합니다.')
              )
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
            이 방 나가기
          </OrbitButton>
          <OrbitButton variant="danger" className="w-full" onClick={logout}>
            로그아웃
          </OrbitButton>
        </div>
      </Sheet>

      <Sheet dark full open={adminOpen} onClose={() => setAdminOpen(false)} title="방장 설정">
        {adminOpen && <OrbitAdmin />}
      </Sheet>

      <Sheet dark center open={switchOpen} onClose={() => setSwitchOpen(false)} title="내 팀">
        <MyRooms
          me={me}
          onSwitched={async () => {
            setSwitchOpen(false)
            await refresh()
          }}
          onAdd={() => {
            setSwitchOpen(false)
            setAddOpen(true)
          }}
        />
      </Sheet>

      <Sheet dark center open={addOpen} onClose={() => setAddOpen(false)} title="방 추가">
        {addOpen && (
          <AddRoom
            onDone={async () => {
              setAddOpen(false)
              await refresh()
            }}
          />
        )}
      </Sheet>
    </>
  )
}

/* 내 방 목록 — 참여하는 팀이 세로로 나란히 선다. 지금 팀은 네온으로 밝히고,
 * 다른 팀은 줄 전체가 버튼이다. */
function MyRooms({ me, onSwitched, onAdd }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const others = (me.rooms ?? []).filter((r) => r.id !== me.room.id)

  return (
    <div className="space-y-2.5">
      {err && <p className="px-1 text-[13px] text-orbit-red">{err}</p>}

      <div
        className="flex items-center gap-3 rounded-2xl border border-orbit-cyan/50 bg-orbit-cyan/10 px-4 py-4"
        style={{ boxShadow: '0 0 18px rgba(0,212,255,0.16)' }}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-bold text-orbit-text">{me.room.name}</div>
          <div className="mt-0.5 text-[12px] text-orbit-cyan/80">
            {me.room.isOwner ? '방장' : '참가자'} · {me.room.memberCount}명
          </div>
        </div>
        <span className="neon shrink-0 text-[11px] font-bold tracking-widest text-orbit-cyan">
          현재 팀
        </span>
      </div>

      {others.map((r) => (
        <button
          key={r.id}
          disabled={busy === r.id}
          onClick={async () => {
            setBusy(r.id)
            setErr(null)
            try {
              await switchRoom(r.id)
              await onSwitched()
            } catch (e) {
              setErr(e.message)
            } finally {
              setBusy(null)
            }
          }}
          className="flex w-full items-center gap-3 rounded-2xl border border-white/12 bg-white/5 px-4 py-4 text-left transition hover:border-orbit-cyan/35 hover:bg-orbit-cyan/5 disabled:opacity-50"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-bold text-orbit-text">{r.name}</div>
            {r.isOwner && <div className="mt-0.5 text-[12px] text-orbit-dim">방장</div>}
          </div>
          <span className="shrink-0 text-[14px] font-bold text-orbit-cyan">
            {busy === r.id ? '이동 중…' : '이동 ›'}
          </span>
        </button>
      ))}

      <button
        onClick={onAdd}
        className="w-full rounded-2xl border border-dashed border-orbit-cyan/35 bg-transparent py-3.5 text-[14px] font-bold text-orbit-cyan/90 transition hover:bg-orbit-cyan/5"
      >
        + 방 추가
      </button>
    </div>
  )
}

/* 방 추가 — 초대코드로 참가하거나 새로 만든다. RoomGate의 첫 화면과 같은 일이지만
 * 이미 방에 들어와 있는 상태에서 하나 더 얹는 것. */
function AddRoom({ onDone }) {
  const [mode, setMode] = useState('join') // 'join' | 'create'
  const [code, setCode] = useState('')
  const [roomName, setRoomName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const input =
    'w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3.5 text-[16px] text-orbit-text placeholder:text-orbit-dim/40 focus:border-orbit-cyan focus:outline-none'

  return (
    <div className="space-y-3">
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
          placeholder="방 이름"
          value={roomName}
          maxLength={20}
          onChange={(e) => setRoomName(e.target.value)}
        />
      )}

      {err && <p className="text-[13px] text-orbit-red">{err}</p>}

      <OrbitButton
        className="w-full"
        disabled={busy}
        onClick={async () => {
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
        }}
      >
        {busy ? '진입 중…' : mode === 'create' ? '방 만들고 출항' : '방에 들어가기'}
      </OrbitButton>
    </div>
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

/* 알림 줄 — 상태 표시만 한다. 켜는 버튼은 없다: 앱이 알아서 권한을 묻고
 * 등록한다(App의 ensurePushRegistered). 여기서는 이 기기가 실제로 받는
 * 상태인지만 보여준다. */
function PushRow() {
  const [on, setOn] = useState(false)

  useEffect(() => {
    isPushRegistered().then(setOn)
  }, [])

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/12 bg-white/5 p-3">
      {/* 네온 종. 꺼진 상태는 빗금 친 종에 빛을 죽여 같은 결로 보여준다. */}
      <div
        className={`grid h-12 w-12 shrink-0 place-items-center rounded-full border ${
          on ? 'border-orbit-cyan/45 bg-orbit-cyan/10' : 'border-orbit-cyan/20 bg-orbit-cyan/5'
        }`}
        style={{ boxShadow: on ? '0 0 14px rgba(0,212,255,0.28)' : 'none' }}
      >
        {on ? (
          <Bell
            className="h-5 w-5 text-orbit-cyan"
            style={{ filter: 'drop-shadow(0 0 6px rgba(0,212,255,0.95))' }}
          />
        ) : (
          <BellOff
            className="h-5 w-5 text-orbit-cyan/55"
            style={{ filter: 'drop-shadow(0 0 4px rgba(0,212,255,0.45))' }}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">미사일 알림</div>
      </div>
    </div>
  )
}
