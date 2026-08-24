import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/* 지금 화면에 떠 있는 게 어느 PR까지 반영된 빌드인지 앱에서 바로 보이게 한다.
 * 이게 없으면 "기능이 안 만들어진 것"과 "배포가 아직 안 된 것"을 구분할 수가 없다.
 *
 * 빌드하는 시점에 한 번만 읽어서 번들에 박는다. Railway는 얕은 클론(shallow clone)을
 * 할 수 있어서 머지 커밋이 안 잡힐 수 있으므로, 못 찾으면 짧은 커밋 해시로 물러난다. */
function buildVersion() {
  const git = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

  /* Railway는 저장소를 .git 없이 펼쳐서 빌드하기 때문에 git 명령이 전부 실패한다
   * (그래서 처음엔 "dev"만 떴다). 대신 빌드 환경에 커밋 정보를 환경변수로 넣어주므로
   * 그걸 먼저 본다. 일반 머지 커밋은 "Merge pull request #70 from ..." 모양이고,
   * 스쿼시 머지는 GitHub 기본값으로 "커밋 제목 (#70)" 모양이라 둘 다 잡아야 한다. */
  const PR_PATTERN = /Merge pull request #(\d+)|\(#(\d+)\)\s*$/m
  const envMsg = process.env.RAILWAY_GIT_COMMIT_MESSAGE
  const envMatch = envMsg?.match(PR_PATTERN)
  const envPr = envMatch?.[1] ?? envMatch?.[2]
  if (envPr) return `PR #${envPr}`

  try {
    const match = git('git log --format=%s -50').match(PR_PATTERN)
    const pr = match?.[1] ?? match?.[2]
    if (pr) return `PR #${pr}`
  } catch {
    /* git이 없거나 저장소가 아니면 아래로 */
  }

  const envSha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA
  if (envSha) return envSha.slice(0, 7)

  try {
    return git('git rev-parse --short HEAD')
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(buildVersion()) },
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Firebase를 따로 떼어 두면 앱 코드를 고쳐도 이 청크는 캐시에 그대로 남는다.
        // firestore/auth/messaging을 각각 쪼개면 서로를 참조하는 순환 청크가 생겨서
        // 로딩 시점에 TDZ 에러("Cannot access ... before initialization")로 앱이 죽는다.
        // Firebase는 통째로 한 청크에 둔다.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('firebase')) return 'firebase'
          if (id.includes('react')) return 'react'
        },
      },
    },
  },
})
