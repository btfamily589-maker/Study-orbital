/* Study Orbital 서버.
 *
 * Sevenly에서 검증된 Orbit 엔진(server/orbit/*)을 그대로 얹되, "반" 하나에
 * 묶여 있던 것을 "방"으로 일반화한다. 학생 누구나 가입해서 방을 만들고,
 * 초대코드로 친구를 모아 그 방 안에서 항로 경쟁을 한다.
 *
 * 인증은 Sevenly와 같은 방식이다 — 이름+비밀번호를 서버가 확인하고 Firebase
 * 커스텀 토큰을 발급한다. 클라이언트는 Firestore를 직접 읽지 않는다(전부 이
 * 서버의 API를 거친다). firestore.rules는 그래서 전부 잠가둔다.
 *
 * Firestore 구조:
 *   logins/{이름}                    { uid, pinHash }      — 이름은 서비스 전체에서 유일
 *   users/{uid}                      { name, roomId }      — 지금 들어가 있는 방 (하나)
 *   roomCodes/{초대코드}             { roomId }
 *   rooms/{roomId}                   { name, code, ownerUid, createdAt }
 *   rooms/{roomId}/members/{uid}     { name, role }        — orbit/auth.js가 읽는 명부
 *   rooms/{roomId}/orbitShips/...                          — 이하 orbit 엔진 몫
 */
import express from 'express'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { createOrbitRouter } from './server/orbit/router.js'
import { orbitStore } from './server/orbit/store.js'
import { resolveDueAttacks } from './server/orbit/combat.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json({ limit: '1mb' }))

/* ---------------- Firebase Admin (게으른 초기화) ----------------
 * FIREBASE_SERVICE_ACCOUNT가 없어도 서버는 뜬다 — 화면은 열리고, API가
 * "설정이 없다"고 알려준다. 배포 순서가 꼬여도 빈 화면이 되지 않게. */
let adminApp = null
let adminInitTried = false

async function firebaseAdmin() {
  if (adminApp || adminInitTried) return adminApp
  adminInitTried = true
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) {
    console.warn('[firebase] FIREBASE_SERVICE_ACCOUNT가 없습니다 — API가 501을 돌려줍니다.')
    return null
  }
  try {
    const { initializeApp, cert } = await import('firebase-admin/app')
    adminApp = initializeApp({ credential: cert(JSON.parse(raw)) })
  } catch (e) {
    console.error('[firebase] 초기화 실패:', e.message)
  }
  return adminApp
}

let dbCached = null
function db() {
  return dbCached
}
let authCached = null
function adminAuth() {
  return authCached
}

async function ensureAdmin() {
  const appRef = await firebaseAdmin()
  if (!appRef) return false
  if (!dbCached) {
    const { getFirestore } = await import('firebase-admin/firestore')
    const { getAuth } = await import('firebase-admin/auth')
    dbCached = getFirestore(appRef)
    authCached = getAuth(appRef)
  }
  return true
}

/* ---------------- 비밀번호 ---------------- */
function hashPin(pin) {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(pin, salt, 32).toString('hex')}`
}
function verifyPin(pin, stored) {
  const [salt, hash] = String(stored ?? '').split(':')
  if (!salt || !hash) return false
  const check = scryptSync(pin, salt, 32)
  const saved = Buffer.from(hash, 'hex')
  return saved.length === check.length && timingSafeEqual(saved, check)
}

/** 이름·비밀번호 형식 검사. 이름은 서비스 전체에서 로그인 아이디가 된다. */
function readCredentials(req, res) {
  const name = String(req.body?.name ?? '').trim()
  const pin = String(req.body?.pin ?? '').trim()
  if (!name || name.length > 12) {
    res.status(400).json({ error: '이름은 1~12자로 입력하세요.' })
    return null
  }
  if (/[/.#$[\]]/.test(name)) {
    res.status(400).json({ error: '이름에 / . # $ [ ] 는 쓸 수 없습니다.' })
    return null
  }
  if (!/^\d{4,8}$/.test(pin)) {
    res.status(400).json({ error: '비밀번호는 숫자 4~8자리입니다.' })
    return null
  }
  return { name, pin }
}

async function requireAdminReady(res) {
  if (await ensureAdmin()) return true
  res.status(501).json({ error: '서버에 FIREBASE_SERVICE_ACCOUNT가 설정돼 있지 않습니다.' })
  return false
}

/* ---------------- 가입 · 로그인 ---------------- */
app.post('/api/signup', async (req, res) => {
  const cred = readCredentials(req, res)
  if (!cred) return
  if (!(await requireAdminReady(res))) return

  try {
    const uid = `local:${randomBytes(12).toString('hex')}`
    const ref = db().doc(`logins/${cred.name}`)

    /* 같은 이름으로 동시에 가입하면 나중 사람이 앞사람을 덮어쓴다.
     * "없을 때만 쓰기"를 트랜잭션으로 잡는다. */
    const taken = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (snap.exists) return true
      tx.set(ref, { uid, pinHash: hashPin(cred.pin), createdAt: new Date().toISOString() })
      tx.set(db().doc(`users/${uid}`), {
        name: cred.name,
        roomId: null,
        createdAt: new Date().toISOString(),
      })
      return false
    })
    if (taken) {
      return res.status(409).json({
        error: '이미 쓰고 있는 이름입니다. 본인이면 "로그인"으로 들어오세요.',
      })
    }
    res.json({ token: await adminAuth().createCustomToken(uid) })
  } catch (e) {
    console.error('[signup]', e)
    res.status(502).json({ error: '가입에 실패했습니다.' })
  }
})

app.post('/api/login', async (req, res) => {
  const cred = readCredentials(req, res)
  if (!cred) return
  if (!(await requireAdminReady(res))) return

  try {
    const snap = await db().doc(`logins/${cred.name}`).get()
    if (!snap.exists) {
      return res.status(404).json({
        error: '가입되지 않은 이름입니다. 처음이라면 "계정 만들기"로 들어오세요.',
      })
    }
    if (!verifyPin(cred.pin, snap.data()?.pinHash)) {
      return res.status(403).json({ error: '비밀번호가 틀렸습니다.' })
    }
    res.json({ token: await adminAuth().createCustomToken(snap.data().uid) })
  } catch (e) {
    console.error('[login]', e)
    res.status(502).json({ error: '로그인에 실패했습니다.' })
  }
})

/* ---------------- 내가 누구인지 확인하는 공통 미들웨어 ---------------- */
async function requireUser(req, res, next) {
  if (!(await requireAdminReady(res))) return
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' })
  try {
    const decoded = await adminAuth().verifyIdToken(token)
    const userSnap = await db().doc(`users/${decoded.uid}`).get()
    if (!userSnap.exists) {
      return res.status(403).json({ error: '가입 정보가 없습니다. 다시 가입해 주세요.' })
    }
    req.user = { uid: decoded.uid, ...userSnap.data() }
    next()
  } catch (e) {
    console.warn('[auth] 토큰 검증 실패', e?.code || e?.message || e)
    res.status(401).json({ error: '로그인이 만료됐습니다. 새로고침 후 다시 시도하세요.' })
  }
}

/* ---------------- 방 ---------------- */

/* 초대코드. 헷갈리는 글자(0/O, 1/I/L)는 뺀다 — 친구에게 말로 불러주는 값이다. */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const newCode = () =>
  Array.from(randomBytes(6))
    .map((b) => CODE_CHARS[b % CODE_CHARS.length])
    .join('')

/** 내 정보 + 지금 들어가 있는 방. 첫 화면이 이걸로 어디를 보여줄지 정한다. */
app.get('/api/me', requireUser, async (req, res) => {
  let room = null
  if (req.user.roomId) {
    const snap = await db().doc(`rooms/${req.user.roomId}`).get()
    if (snap.exists) {
      const membersSnap = await db().collection(`rooms/${req.user.roomId}/members`).get()
      room = {
        id: snap.id,
        name: snap.data().name,
        code: snap.data().code,
        memberCount: membersSnap.size,
        isOwner: snap.data().ownerUid === req.user.uid,
      }
    }
  }
  res.json({ uid: req.user.uid, name: req.user.name, photo: req.user.photo ?? null, room })
})

/* ---------------- 프사 ---------------- */

/** 프사 올리기/지우기(null). 클라이언트가 160px 정사각으로 줄여 보낸 data URL을
 * 그대로 든다 — 예전 Replit 앱과 같은 방식이라 별도 스토리지 없이 문서에 들어갈
 * 크기다. 방 명부에도 복사해 둔다(함선 옆에 띄울 때 방 단위로 한 번에 읽는다). */
app.post('/api/me/photo', requireUser, async (req, res) => {
  const photo = req.body?.photo ?? null
  if (photo !== null) {
    if (typeof photo !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(photo)) {
      return res.status(400).json({ error: '이미지 파일이 아닙니다.' })
    }
    if (photo.length > 200_000) {
      return res.status(400).json({ error: '사진이 너무 큽니다. 다른 사진으로 해보세요.' })
    }
  }
  try {
    await db().doc(`users/${req.user.uid}`).update({ photo })
    if (req.user.roomId) {
      await db()
        .doc(`rooms/${req.user.roomId}/members/${req.user.uid}`)
        .set({ photo }, { merge: true })
    }
    res.json({ ok: true })
  } catch (e) {
    console.error('[me/photo]', e)
    res.status(502).json({ error: '사진을 저장하지 못했습니다.' })
  }
})

/** 방 참가자들의 프사. uid → data URL. 프사 없는 사람은 아예 안 실린다. */
app.get('/api/room/photos', requireUser, async (req, res) => {
  if (!req.user.roomId) return res.json({})
  try {
    const snap = await db().collection(`rooms/${req.user.roomId}/members`).get()
    const out = {}
    for (const d of snap.docs) if (d.data().photo) out[d.id] = d.data().photo
    res.json(out)
  } catch (e) {
    console.error('[room/photos]', e)
    res.status(502).json({ error: '사진을 불러오지 못했습니다.' })
  }
})

/** 방 만들기. 만든 사람이 방장(orbit의 운영자)이 된다. */
app.post('/api/room/create', requireUser, async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name || name.length > 20) {
    return res.status(400).json({ error: '방 이름은 1~20자로 입력하세요.' })
  }
  try {
    /* 코드 충돌은 트랜잭션의 "없을 때만 쓰기"로 잡고, 걸리면 새 코드로 다시. */
    let created = null
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const code = newCode()
      const roomRef = db().collection('rooms').doc()
      created = await db().runTransaction(async (tx) => {
        const codeRef = db().doc(`roomCodes/${code}`)
        if ((await tx.get(codeRef)).exists) return null
        tx.set(roomRef, {
          name,
          code,
          ownerUid: req.user.uid,
          createdAt: new Date().toISOString(),
        })
        tx.set(codeRef, { roomId: roomRef.id })
        tx.set(db().doc(`rooms/${roomRef.id}/members/${req.user.uid}`), {
          name: req.user.name,
          role: 'admin',
          joinedAt: new Date().toISOString(),
          ...(req.user.photo ? { photo: req.user.photo } : {}),
        })
        tx.update(db().doc(`users/${req.user.uid}`), { roomId: roomRef.id })
        return { id: roomRef.id, code }
      })
    }
    if (!created) return res.status(502).json({ error: '초대코드 만들기에 실패했습니다.' })
    res.json({ ok: true, roomId: created.id, code: created.code })
  } catch (e) {
    console.error('[room/create]', e)
    res.status(502).json({ error: '방을 만들지 못했습니다.' })
  }
})

/** 초대코드로 참가. 이미 다른 방에 있으면 옮겨 탄다(명부·배는 방마다 따로 남는다). */
app.post('/api/room/join', requireUser, async (req, res) => {
  const code = String(req.body?.code ?? '')
    .trim()
    .toUpperCase()
  if (!code) return res.status(400).json({ error: '초대코드를 입력하세요.' })
  try {
    const codeSnap = await db().doc(`roomCodes/${code}`).get()
    if (!codeSnap.exists) {
      return res.status(404).json({ error: '그 코드의 방이 없습니다. 코드를 다시 확인하세요.' })
    }
    const roomId = codeSnap.data().roomId
    const roomSnap = await db().doc(`rooms/${roomId}`).get()
    if (!roomSnap.exists) return res.status(404).json({ error: '없어진 방입니다.' })

    /* 명부는 merge로 쓴다 — 나갔다 돌아온 사람의 역할(role)을 지우지 않는다. */
    const member = {
      name: req.user.name,
      role: 'member',
      joinedAt: new Date().toISOString(),
      ...(req.user.photo ? { photo: req.user.photo } : {}),
    }
    const mergeFields = ['name', 'joinedAt', ...(req.user.photo ? ['photo'] : [])]
    await db()
      .doc(`rooms/${roomId}/members/${req.user.uid}`)
      .set(member, { mergeFields })
      .catch(async () => {
        // 처음 참가면 mergeFields 대상 문서가 없어 실패할 수 있다 — 통째로 만든다.
        await db().doc(`rooms/${roomId}/members/${req.user.uid}`).set(member)
      })
    await db().doc(`users/${req.user.uid}`).update({ roomId })
    res.json({ ok: true, roomId, name: roomSnap.data().name })
  } catch (e) {
    console.error('[room/join]', e)
    res.status(502).json({ error: '방에 참가하지 못했습니다.' })
  }
})

/** 방 나가기. 명부와 배는 남긴다 — 코드로 돌아오면 이어서 한다. */
app.post('/api/room/leave', requireUser, async (req, res) => {
  try {
    await db().doc(`users/${req.user.uid}`).update({ roomId: null })
    res.json({ ok: true })
  } catch (e) {
    console.error('[room/leave]', e)
    res.status(502).json({ error: '방을 나가지 못했습니다.' })
  }
})

/* ---------------- Orbit — 방마다 라우터 한 벌 ----------------
 * orbit 모듈들은 store(방 하나)를 닫아 넣고 만들어진다. 방마다 라우터를 하나씩
 * 게으르게 만들어 두고, 요청한 사람이 들어가 있는 방의 것으로 넘긴다. */
const orbitRouters = new Map()
function orbitRouterFor(roomId) {
  if (!orbitRouters.has(roomId)) {
    orbitRouters.set(
      roomId,
      createOrbitRouter({
        adminAuth,
        adminDb: db,
        adminMessaging: () => null, // 웹푸시는 아직 없다 — notify가 알아서 건너뛴다
        classId: roomId,
      }),
    )
  }
  return orbitRouters.get(roomId)
}

app.use('/api/orbit', requireUser, (req, res, next) => {
  if (!req.user.roomId) {
    return res.status(403).json({ error: '먼저 방에 참가하세요.', needRoom: true })
  }
  orbitRouterFor(req.user.roomId)(req, res, next)
})

/* ---------------- 착탄 시계 ----------------
 * 미사일은 아무도 안 볼 때도 제때 떨어져야 한다. 방이 여럿이므로, 날고 있는
 * 미사일이 있는 방만 골라(collectionGroup) 그 방의 착탄을 처리한다. */
const ORBIT_TICK_MS = 60_000
let ticking = false
async function orbitTick() {
  if (ticking) return
  ticking = true
  try {
    if (!(await ensureAdmin())) return
    const snap = await db().collectionGroup('orbitAttacks').where('status', '==', 'in_flight').get()
    const roomIds = new Set(
      snap.docs
        .map((d) => d.ref.parent.parent)
        .filter((p) => p && p.parent.id === 'rooms')
        .map((p) => p.id),
    )
    for (const roomId of roomIds) {
      try {
        const messages = await resolveDueAttacks(orbitStore(db(), roomId))
        if (messages.length) console.log(`[orbit:${roomId}] 착탄 ${messages.length}건`)
      } catch (e) {
        console.error(`[orbit:${roomId}]`, e)
      }
    }
  } catch (e) {
    console.error('[orbit tick]', e)
  } finally {
    ticking = false
  }
}
setInterval(orbitTick, ORBIT_TICK_MS).unref?.()

/* ---------------- 정적 파일 ---------------- */
const dist = path.join(__dirname, 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(readFileSync(path.join(dist, 'index.html'), 'utf8'))
  })
}

const port = process.env.PORT || 3000
app.listen(port, () => console.log(`Study Orbital 서버: http://localhost:${port}`))
