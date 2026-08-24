import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

/* 없는 변수를 쓰는 실수만은 배포 전에 잡는다.
 *
 * `npm run build`는 이런 걸 못 잡는다 — 문법이 맞으면 그대로 통과시키고, 그 줄을
 * 실제로 그릴 때가 되어서야 터진다. 그래서 화면 하나가 통째로 안 열리는 사고가
 * 두 번 났다(수리 화면의 repairLeft, 설정 화면의 me). 둘 다 그 화면을 여는
 * 사람에게만 보였기 때문에 만든 쪽에서는 멀쩡한 줄 알았다.
 *
 * 규칙을 잔뜩 켜서 잔소리를 늘리는 게 목적이 아니다. 오류로 잡는 건 사실상
 * "터질 코드"뿐이고(no-undef가 위의 두 사고를 다 잡는다), 나머지는 경고로 둔다.
 * react-hooks도 훅 순서(rules-of-hooks)만 오류다 — 나머지 새 규칙들은 고치려면
 * 화면을 다시 짜야 해서, 지금은 켜지 않는다.
 */
const shared = {
  ...js.configs.recommended.rules,
  // 일부러 비워둔 catch가 여럿 있다 — 옆에 이유를 적어뒀다.
  'no-empty': ['error', { allowEmptyCatch: true }],
}

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/firebase-messaging-sw.js'] },

  // 브라우저에서 도는 앱 코드
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...shared,
      /* JSX에 쓴 컴포넌트는 "안 쓰는 변수"로 잘못 잡힌다. 이름이 대문자로
       * 시작하는 것(컴포넌트)은 빼고 본다.
       *
       * motion은 소문자라 그 그물에 안 걸린다 — <motion.div>는 멤버 표현식이라
       * eslint가 쓰임을 못 보고 "안 쓴다"고 말한다. 그 말을 믿고 import를
       * 지웠다가 일정 탭이 통째로 "motion is not defined"로 죽었다. 네 파일이
       * 같은 거짓 경고를 달고 있어서 다음에도 똑같이 당한다 — 여기서 막는다.
       * (제대로 고치려면 eslint-plugin-react의 jsx-uses-vars가 필요한데, 이
       * 한 이름 때문에 의존성을 늘리진 않는다.) */
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z]|^motion$' }],
      // 훅 순서가 어긋나면 화면이 죽는다. 이건 경고가 아니라 오류다.
      'react-hooks/rules-of-hooks': 'error',
      // 의존성 배열은 일부러 비워둔 곳이 있다 — 알려만 주고 막지는 않는다.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // 서버·크론은 Node에서 돈다
  {
    files: ['server.js', 'server/**/*.js', 'cron/**/*.js', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      ...shared,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
]
