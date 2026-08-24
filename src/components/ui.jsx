import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** 공유 일정 표시용. 이모지 자물쇠는 기기마다 스타일이 달라 들쭉날쭉해서 직접 그린다. */
export function LockIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <rect
        x="3.25"
        y="7.25"
        width="9.5"
        height="6.75"
        rx="1.75"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M5.25 7.25V5.5a2.75 2.75 0 0 1 5.5 0v1.75"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="8" cy="10.4" r="0.9" fill="currentColor" />
    </svg>
  )
}

/** 삭제 버튼용. 같은 이유로(이모지 들쭉날쭉) 직접 그린다. */
export function TrashIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path
        d="M3.5 5h9M6.5 5V3.75c0-.55.45-1 1-1h1c.55 0 1 .45 1 1V5M6.25 7.5v4M9.75 7.5v4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M4.25 5l.55 7.15c.05.7.63 1.25 1.33 1.25h3.74c.7 0 1.28-.55 1.33-1.25L11.75 5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** "직접 추가하기" 줄용. */
export function PlusIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function Card({ className = '', children, ...rest }) {
  return (
    <div className={`rounded-card bg-surface shadow-card ${className}`} {...rest}>
      {children}
    </div>
  )
}

/** 섹션 머리말. 화면당 여러 번 반복되지만, 각 섹션이 뭔지 바로 읽혀야 하니
 * 연한 회색(text-muted)보다 진하고 큰 글씨로 둔다. */
export function Eyebrow({ children, tone = 'muted' }) {
  const tones = {
    muted: 'text-ink',
    mark: 'text-mark',
    red: 'text-red',
  }
  return <div className={`text-[15px] font-bold ${tones[tone]}`}>{children}</div>
}

export function Button({ variant = 'solid', className = '', ...rest }) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-control px-4 h-11 text-[14px] font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40'
  const styles = {
    solid: 'bg-ink text-white hover:bg-ink/90',
    mark: 'bg-mark text-white hover:brightness-[0.95]',
    ghost: 'bg-surface text-ink ring-1 ring-line hover:ring-muted/35',
    quiet: 'text-muted hover:bg-paper hover:text-ink',
    danger: 'text-red ring-1 ring-red/25 hover:bg-red-soft',
  }
  return <button className={`${base} ${styles[variant]} ${className}`} {...rest} />
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      {label && <div className="mb-2 text-[13px] font-semibold text-ink">{label}</div>}
      {children}
      {hint && <div className="mt-1.5 text-[12px] text-faint">{hint}</div>}
    </label>
  )
}

/* 테두리 대신 ring을 쓴다. 포커스 때 두께가 늘어도 레이아웃이 안 밀린다. */
const inputCls =
  'w-full rounded-control bg-surface px-3.5 py-3 text-[15px] text-ink ring-1 ring-line transition placeholder:text-faint focus:ring-2 focus:ring-mark focus:outline-none'

export const Input = (p) => <input {...p} className={`${inputCls} ${p.className ?? ''}`} />
export const Textarea = (p) => (
  <textarea {...p} className={`${inputCls} resize-y leading-relaxed ${p.className ?? ''}`} />
)
export const Select = (p) => (
  <select {...p} className={`${inputCls} appearance-none ${p.className ?? ''}`} />
)

/* dark: Orbit 탭에서 여는 시트. 시트는 앱 전체를 덮으므로 어두운 화면에서
 * 흰 시트가 올라오면 눈이 아프다. */
/* 아래로 얼마나 끌어야 닫히는지.
 *
 * 처음엔 110px에 살짝만 튕겨도 닫히게 했는데, 조금만 건드려도 사라져서
 * "잡고 내린다"가 아니라 "손대면 없어진다"가 됐다. 눈에 띄게 내렸을 때만
 * 닫는다 — 화면의 5분의 1쯤(=적당히 내린 만큼)이 기준이다.
 *
 * 튕겨서 닫는 것도 남기되, 빠르기만 하면 되는 게 아니라 어느 정도 내려간
 * 뒤여야 한다. 안 그러면 손가락이 살짝 미끄러진 것까지 "던졌다"가 된다. */
const CLOSE_PX = 190
const CLOSE_FLICK = 1.2 // px/ms
const FLICK_MIN_PX = 70

/* 지금 열려 있는 시트들의 닫기 함수. 나중에 연 것이 위다.
 *
 * 폰의 뒤로가기는 App이 방문 기록(popstate)으로 받는데, 시트는 기록에 칸을
 * 안 쌓는다 — 그래서 시트를 열어둔 채 뒤로가기를 누르면 시트 대신 화면이
 * 넘어가 버렸다(맛집 상세에서 홈으로). App이 화면을 넘기기 전에 여기부터
 * 물어보고, 열린 시트가 있으면 그것만 닫는다. */
const sheetCloseStack = []

/** 맨 위 시트를 닫는다. 닫은 게 있으면 true — App의 뒤로가기가 부른다. */
export function closeTopSheet() {
  const top = sheetCloseStack[sheetCloseStack.length - 1]
  if (!top) return false
  top()
  return true
}

/* full: 화면 맨 위까지 꽉 차게 연다. 내용이 길어 아래(댓글 입력창 같은 것)가
 * 잘리는 시트가 쓴다 — 기본 시트는 내용만큼만 올라온다.
 * center: 바닥에 붙는 시트 대신 화면 한가운데 뜨는 창으로 연다. 짧은 고르기
 * 목록이 쓴다 — 바닥에 붙으면 손은 가깝지만 눈은 화면 중앙을 보고 있다. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  dark = false,
  full = false,
  center = false,
}) {
  /* 손잡이를 잡고 아래로 끄는 만큼 시트가 따라 내려간다.
   *
   * 손잡이 모양만 그려두고 아무 일도 안 하면, 잡아 내려도 꿈쩍 안 해서 앱이
   * 멈춘 것처럼 보인다. 그릴 거면 움직여야 한다. */
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const drag = useRef(null)

  /* 뒤로가기용 등록. onClose를 ref로 드는 건 스택 항목을 열림당 하나로
   * 고정하기 위해서다 — 렌더마다 넣었다 뺐다 하면 순서가 흐트러진다. */
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const close = () => closeRef.current()
    sheetCloseStack.push(close)
    return () => {
      const i = sheetCloseStack.indexOf(close)
      if (i >= 0) sheetCloseStack.splice(i, 1)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  // 닫았다 다시 열면 제자리에서 시작해야 한다. 안 그러면 내려간 채로 뜬다.
  useEffect(() => {
    if (open) setDy(0)
  }, [open])

  const onDown = (e) => {
    drag.current = { start: e.clientY, last: e.clientY, t: e.timeStamp, v: 0, held: false }
  }

  const onMove = (e) => {
    const d = drag.current
    if (!d) return
    const moved = e.clientY - d.start

    /* 포인터를 붙잡는(capture) 건 실제로 끌기 시작한 뒤다.
     *
     * 누르자마자 붙잡으면 그 뒤의 pointerup이 전부 이쪽으로 오고, 브라우저는
     * click을 붙잡은 요소에 준다 — 같은 줄에 있는 ✕ 버튼이 눌리지 않았다.
     * 몇 px 움직이기 전까지는 평범한 클릭으로 남겨둔다. */
    if (!d.held) {
      // 아래로 8px은 확실히 내려야 끌기로 친다. 손가락은 누를 때 늘 조금 흔들린다.
      if (moved < 8) return
      d.held = true
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }

    const dt = Math.max(1, e.timeStamp - d.t)
    d.v = (e.clientY - d.last) / dt
    d.last = e.clientY
    d.t = e.timeStamp
    // 위로는 안 늘어난다 — 시트는 아래로만 사라진다.
    setDy(Math.max(0, moved))
  }

  const onUp = (e) => {
    const d = drag.current
    drag.current = null
    if (!d?.held) return // 그냥 눌렀다 뗀 것 — 클릭이 제 갈 길을 가게 둔다
    setDragging(false)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    // 손 뗀 좌표로 속도를 재면 언제나 0이다. 마지막 움직임에서 잰 값을 쓴다.
    const moved = d.last - d.start
    const flick = e.timeStamp - d.t > 120 ? 0 : d.v
    if (moved > CLOSE_PX || (moved > FLICK_MIN_PX && flick > CLOSE_FLICK)) onClose()
    else setDy(0)
  }

  if (!open) return null

  /* 반드시 body에 붙여서 그린다(portal).
   *
   * position: fixed는 보통 화면 기준이지만, 조상 중에 backdrop-filter나
   * transform이 하나라도 있으면 그 요소가 기준이 된다. Orbit의 .panel이
   * backdrop-filter: blur를 쓰기 때문에, 패널 안에서 연 시트가 화면 바닥이
   * 아니라 패널 안쪽에 떠 있었다 — 아래로 쓸어 닫는 손잡이가 화면 한가운데
   * 있는 꼴이었다. 어디서 열든 화면 바닥에 붙게 하려면 트리 밖으로 빼야 한다. */
  return createPortal(
    <div
      /* 열려 있는 시트가 있는지 밖에서 알아볼 표식. 오래된 판을 스스로 새로
         받아올 때, 글을 쓰던 창이 열려 있으면 건너뛴다(lib/version의 holdReload). */
      data-sheet
      className={`fixed inset-0 z-50 flex justify-center ${
        center ? 'items-center' : 'items-end sm:items-center'
      } ${dark ? 'orbit' : ''}`}
    >
      <div
        className={`absolute inset-0 backdrop-blur-[2px] ${dark ? 'bg-black/60' : 'bg-night/35'}`}
        onClick={onClose}
      />
      {/* 끌어 내리는 몫은 이 껍데기가 맡는다.
       *
       * 안쪽 .rise는 열릴 때 올라오는 애니메이션인데 fill-mode가 both라
       * 끝난 뒤에도 transform: none을 계속 물고 있다. CSS 애니메이션은 인라인
       * 스타일을 이기므로, 같은 요소에 끌기 transform을 주면 아무 일도 안
       * 일어난다 — 손가락을 따라오지 않고 그대로 멈춰 있었다. 층을 나눈다. */}
      <div
        style={{
          transform: dy ? `translateY(${dy}px)` : undefined,
          // 끄는 동안엔 손가락을 그대로 따라간다. 놓은 뒤에만 제자리로 미끄러진다.
          transition: dragging ? 'none' : 'transform 220ms cubic-bezier(.22,.61,.36,1)',
        }}
        className={`relative ${center ? 'w-[calc(100%-2.5rem)] max-w-lg' : 'w-full sm:max-w-lg'}`}
      >
        <div
          className={`rise w-full overflow-y-auto p-6 shadow-lift sm:rounded-[26px] ${
            center
              ? 'max-h-[80vh] rounded-[26px]'
              : full
                ? 'h-[100dvh] max-h-[100dvh] rounded-t-[26px] sm:h-auto sm:max-h-[88vh]'
                : 'max-h-[88vh] rounded-t-[26px]'
          } ${dark ? 'border border-white/10 bg-orbit-panel text-orbit-text' : 'bg-surface'}`}
        >
          {/* 아래로 쓸어 닫는 손잡이. 제목 줄까지가 잡는 자리다 — 내용은 그 자체로
            스크롤되기 때문에, 아무 데서나 끌게 하면 목록을 내리려다 시트가
            닫힌다. touch-none이 없으면 브라우저가 스크롤로 가져간다. */}
          <div
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            className="-mx-6 -mt-6 touch-none px-6 pt-6"
          >
            {/* 끌어 내리는 손잡이. 가운데 창은 바닥에서 올라온 물건이 아니라 안 단다. */}
            <div
              className={`mx-auto mb-4 h-1.5 w-10 rounded-full ${center ? 'hidden' : 'sm:hidden'} ${
                dark ? 'bg-white/20' : 'bg-line'
              }`}
            />
            <div className="mb-5 flex items-center justify-between">
              {/* 제목이 길면 여기서 접힌다. 띄어쓰기 없이 붙여 쓴 제목은
                  break-keep만으로는 한 낱말이라 안 접히고 닫기 단추를 화면
                  밖으로 밀어낸다 — anywhere를 같이 걸고 단추는 안 줄인다. */}
              <h2
                className={`min-w-0 text-[19px] font-bold tracking-tight break-keep [overflow-wrap:anywhere] ${
                  dark ? 'text-orbit-cyan' : ''
                }`}
              >
                {title}
              </h2>
              <button
                onClick={onClose}
                aria-label="닫기"
                className={`ml-3 grid h-8 w-8 shrink-0 place-items-center rounded-full transition ${
                  dark
                    ? 'text-orbit-dim hover:bg-white/10 hover:text-orbit-text'
                    : 'text-muted hover:bg-paper hover:text-ink'
                }`}
              >
                ✕
              </button>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function Empty({ title, action }) {
  return (
    <div className="rounded-card bg-surface/70 px-5 py-10 text-center ring-1 ring-line ring-inset">
      <p className="text-[14px] text-faint">{title}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Tag({ children, tone = 'line' }) {
  const tones = {
    line: 'bg-paper text-muted',
    mark: 'bg-mark-soft text-mark',
    red: 'bg-red-soft text-red',
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  )
}
