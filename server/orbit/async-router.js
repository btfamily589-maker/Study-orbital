/* async 라우트가 실패해도 응답은 반드시 나가게 하는 Router.
 *
 * Express 4는 async 핸들러가 던진 걸 잡아주지 않는다. 그래서 Firestore 호출
 * 하나가 실패하면 그 요청은 응답이 영영 안 나가고, 브라우저의 fetch는 끝나지
 * 않는 약속을 붙잡고 기다린다 — 화면에는 "Loading..."이 무한히 떠 있는다.
 * 실제로 Orbit 탭이 통째로 안 열린 적이 있고, 서버 로그에만 unhandledRejection이
 * 남았다.
 *
 * 여기서 만든 Router는 등록되는 핸들러를 전부 감싸서, 던진 것을 next(err)로
 * 넘긴다. 그러면 맨 끝의 오류 처리기가 500을 내려주고, 화면은 "다시 시도"를
 * 띄울 수 있다. 라우트를 새로 추가할 때 감싸는 걸 잊어도 자동으로 걸린다.
 */
import { Router } from 'express'

/* 인자가 넷인 함수는 Express의 오류 처리기다(err, req, res, next). 그건 감싸면
 * 안 된다 — 감싸는 순간 인자 수가 셋으로 보여서 오류 처리기로 안 불린다. */
const wrap = (fn) =>
  fn.length >= 4 ? fn : (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

const METHODS = ['use', 'all', 'get', 'post', 'put', 'patch', 'delete']

export function asyncRouter() {
  const router = Router()
  for (const method of METHODS) {
    const original = router[method].bind(router)
    router[method] = (...args) =>
      original(...args.map((a) => (typeof a === 'function' ? wrap(a) : a)))
  }
  return router
}

/* 라우터 맨 끝에 붙인다. 어디서 터졌든 여기로 모인다.
 *
 * 사용자에게는 무엇이 안 됐는지만 알려주고(원인 문자열은 Firestore 내부 메시지라
 * 도움이 안 된다), 진짜 원인은 서버 로그에 남긴다. */
export function jsonErrorHandler(tag) {
  // eslint-disable-next-line no-unused-vars -- Express는 인자 넷을 봐야 오류 처리기로 인식한다
  return (err, req, res, next) => {
    console.error(`[${tag}] ${req.method} ${req.originalUrl}`, err)
    if (res.headersSent) return
    res.status(500).json({ error: '서버에서 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' })
  }
}
