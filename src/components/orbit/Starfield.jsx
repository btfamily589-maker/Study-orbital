/* 앱 전체가 함께 쓰는 별밭.
 *
 * 예전엔 공부 화면 안에만 있었다. 그래서 홈↔공부를 오갈 때 별이 통째로
 * 사라졌다 나타나면서 화면이 한순간 까매졌고, 그게 연출이 끊기는 것처럼
 * 보였다. 이제 앱 껍데기에 한 번만 깔아 두고 아무도 이걸 지우지 않는다 —
 * 화면이 바뀌어도 배경은 그대로다.
 *
 * 좌표는 모듈이 처음 불릴 때 한 번만 만든다. 렌더마다 다시 뽑으면 별이 튄다.
 */
const STARS = Array.from({ length: 60 }, (_, i) => ({
  id: i,
  big: i % 7 === 0,
  left: (i * 37 + 13) % 100,
  top: (i * 53 + 7) % 100,
  o: 0.15 + (i % 5) * 0.12,
}))

export function Starfield() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      {STARS.map((s) => (
        <div
          key={s.id}
          className="absolute rounded-full bg-white"
          style={{
            width: s.big ? 2 : 1,
            height: s.big ? 2 : 1,
            left: `${s.left}%`,
            top: `${s.top}%`,
            opacity: s.o,
          }}
        />
      ))}
    </div>
  )
}
