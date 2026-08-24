/* 무기 아이콘.
 *
 * 전에는 종류마다 색깔 점 하나뿐이라, 색을 외우기 전에는 무엇이 무엇인지
 * 알 수 없었다. 생김새로 구분되게 그렸다 — 빠른 건 날렵하고, 무거운 건
 * 뭉툭하고, 핵은 방사능 표시다.
 *
 * 전부 24×24에 위를 향하고, 색은 currentColor를 따라간다.
 */

/** 세 갈래 방사능 표시. 핵에만 쓴다. */
function Trefoil({ cx = 12, cy = 13.5, r = 6.4 }) {
  // 한 갈래는 60도. 사이를 60도씩 띄워 세 개를 놓는다.
  const half = (60 / 2) * (Math.PI / 180)
  const x = r * Math.sin(half)
  const y = r * Math.cos(half)
  const blade = `M${cx} ${cy} L${cx + x} ${cy - y} A${r} ${r} 0 0 0 ${cx - x} ${cy - y} Z`
  return (
    <>
      {[0, 120, 240].map((deg) => (
        <path key={deg} d={blade} transform={`rotate(${deg} ${cx} ${cy})`} />
      ))}
      <circle cx={cx} cy={cy} r={1.9} />
    </>
  )
}

const SHAPES = {
  /* EMP — 터지면서 사방으로 퍼지는 펄스. 미사일이 아니라 즉시 터지는 무기라
     생김새부터 다르게 뒀다. */
  emp: (
    <>
      <circle cx="12" cy="12" r="2.6" />
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M7.9 7.9a5.8 5.8 0 000 8.2" />
        <path d="M16.1 16.1a5.8 5.8 0 000-8.2" />
        <path d="M5.1 5.1a9.8 9.8 0 000 13.8" opacity="0.55" />
        <path d="M18.9 18.9a9.8 9.8 0 000-13.8" opacity="0.55" />
      </g>
    </>
  ),

  /* Basic — 기본형. 다른 것들이 여기서 얼마나 달라졌는지 재는 기준이다. */
  missile_basic: (
    <>
      <path d="M12 2.2c1.9 2.1 3 4.6 3 7.2V16H9V9.4c0-2.6 1.1-5.1 3-7.2z" />
      <path d="M9 11.4L6.1 17H9zM15 11.4L17.9 17H15z" />
      <path d="M10.4 16.6h3.2L12 21z" opacity="0.75" />
    </>
  ),

  /* Fast — 몸통이 가늘고 뒤로 속도선이 흐른다. 1시간이면 도착하는 놈이다. */
  missile_fast: (
    <>
      <path d="M12 2.2c1.5 1.9 2.4 4.2 2.4 6.6V14H9.6V8.8c0-2.4.9-4.7 2.4-6.6z" />
      <path d="M9.6 10.2L7.4 15h2.2zM14.4 10.2L16.6 15h-2.2z" />
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M12 16.4v5.4" />
        <path d="M8.4 17.2v3.4" opacity="0.7" />
        <path d="M15.6 17.2v3.4" opacity="0.7" />
      </g>
    </>
  ),

  /* Heavy — 뭉툭하고 넓다. 날개도 넷. 피해가 제일 큰 재래식이다. */
  missile_heavy: (
    <>
      <path d="M12 2.4c2.5 2.4 3.9 5.4 3.9 8.6V16H8.1v-5c0-3.2 1.4-6.2 3.9-8.6z" />
      <path d="M8.1 10.4L4.6 17h3.5zM15.9 10.4L19.4 17h-3.5z" />
      <path d="M9.4 16.6h1.7L10.4 21zM12.9 16.6h1.7L14.6 21z" opacity="0.75" />
    </>
  ),

  /* Stealth — 각진 다트. 꼬리를 점선으로 끊어 "안 보인다"는 걸 드러낸다. */
  missile_stealth: (
    <>
      <path d="M12 2L18 14.6l-6-3.2-6 3.2z" />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2.2 2.6">
        <path d="M12 15.4v6.4" />
      </g>
    </>
  ),

  /* Nuclear — 방사능 표시. 여기까지 오면 설명이 필요 없다. */
  missile_nuke: (
    <>
      <path d="M12 1.6l2.2 3.8H9.8z" />
      <Trefoil />
    </>
  ),
}

/* 도형만 돌려준다. 항로맵은 이걸 <g>에 직접 넣어 회전·축소해서 쓴다 —
 * 미사일 머리가 목록에 뜬 아이콘과 같은 모양이라야 무엇이 날아오는지 안다.
 * 24×24 좌표계에 위를 향하고 있다는 걸 전제로 쓰면 된다. */
export function WeaponShape({ type }) {
  return SHAPES[type] ?? null
}

export function WeaponIcon({ type, className = 'h-5 w-5', style }) {
  if (!SHAPES[type]) return null
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden>
      {SHAPES[type]}
    </svg>
  )
}
