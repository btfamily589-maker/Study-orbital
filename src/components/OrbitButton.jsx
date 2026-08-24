/* Orbit 스타일 버튼. Orbit 화면과 로그인·방 화면이 같은 것을 쓴다. */
export function OrbitButton({ variant = 'cyan', className = '', ...rest }) {
  const base =
    'inline-flex h-11 items-center justify-center rounded-control px-4 text-[15px] font-bold tracking-wider uppercase transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40'
  const styles = {
    cyan: 'bg-orbit-cyan text-orbit-bg hover:brightness-110',
    /* 테두리는 2px. 1px 흐린 선은 어두운 배경에서 거의 안 보여 버튼이
       글자만 떠 있는 것처럼 보였다 — 옆의 카드들과도 두께를 맞춘다. */
    ghost: 'border-2 border-white/22 text-orbit-text hover:border-orbit-cyan/60',
    danger: 'border-2 border-orbit-red/55 text-orbit-red hover:bg-orbit-red/10',
  }
  return <button className={`${base} ${styles[variant]} ${className}`} {...rest} />
}
