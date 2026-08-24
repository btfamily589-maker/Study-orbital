import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 앱 전체가 어두운 콕핏이다 — 스크롤 튕김 영역까지 어두워야 한다.
document.body.classList.add('orbit-bg')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
