# Study Orbital

공부한 시간이 우주선의 연료가 됩니다. 초대코드로 친구를 모아 같은 항로에서 경쟁하세요.

- 가입: 이름 + 숫자 비밀번호 (이름이 곧 로그인 아이디, 서비스 전체에서 유일)
- 방: 만들면 초대코드가 생기고, 코드로 들어온 사람끼리 같은 맵
- 게임: 공부 세션 → 에너지 → 항로 전진, 미사일/방어막/요격, 주간·월간 랭킹

## 개발

```bash
npm install
npm run dev        # 프론트 (Vite)
npm start          # 서버 (Express, PORT=3000)
```

Vite 개발 중에는 `/api`가 서버로 프록시되지 않으므로, 로컬에서 전체 흐름을 보려면
`npm run build && npm start`로 확인하는 게 간단하다.

## 배포 (Railway)

1. Firebase 프로젝트 새로 만들기 → Authentication 켜기 (로그인 방법은 아무것도 안 켜도 됨 — 커스텀 토큰만 쓴다)
2. Firestore Database 만들기 → 규칙에 `firestore.rules` 붙여넣고 게시 (전부 잠금)
3. 프로젝트 설정 → 일반 → 웹 앱 추가 → SDK 설정값 4개를 `VITE_FIREBASE_*`로
4. 프로젝트 설정 → 서비스 계정 → 새 비공개 키 → JSON 통째로 `FIREBASE_SERVICE_ACCOUNT`에
5. Railway에서 이 레포 연결 → 환경변수(.env.example 참고) 넣기 → Build `npm run build`, Start `npm start`
