// 모바일 액션 바텀시트 — 카드의 '⋮'(더보기)에서 여는 모달형 시트.
// 데스크탑 테이블의 행 버튼 묶음을 대체한다. actions: [{ label, tone, disabled, selected, onClick }]
// tone: 'default' | 'primary' | 'safe' | 'danger'
// selected: 선택지 목록으로 쓸 때(정렬 등) 현재 값 표시. 액션 목록에서는 그냥 생략한다.
//
// **닫는 법은 두 가지다: 스크림 탭, 그리고 아래로 끌어내리기.**
// 예전엔 목록 맨 아래 '취소' 버튼이 있었는데, 손가락이 닿기 먼 자리에 놓인 데다
// 아래로 쓸어내리는 게 이미 몸에 밴 동작이라 지웠다. 잡는 곳은 머리말(핸들+제목) 전체다 —
// 핸들 바 4px 만 판정하면 겨냥이 필요해서 '부드럽다'는 느낌이 나오지 않는다.
//
// 목록이 스크롤 중이면 그 스크롤이 우선이다(맨 위에서 더 내릴 때만 시트가 따라온다).
// 지도·경로의 상주 시트(useDragSheet)와는 다른 물건이다 — 저쪽은 끈 방향 끝까지 붙고 닫히지 않는다.
import { useState, useRef, useEffect, useCallback } from 'react'

const TONE_COLOR = {
  default: 'var(--text-strong)',
  primary: 'var(--blue-primary)',
  safe: 'var(--safe)',
  danger: 'var(--danger)',
}

const ENTER_MS = 260
const EXIT_MS = 220
// 감속 곡선. 끝에서 부드럽게 멎어 '툭' 하고 붙지 않는다.
const EASE = 'cubic-bezier(.32,.72,0,1)'

// 이만큼 내렸으면 손을 떼도 닫는다. 짧게 튕겨 내려도(속도) 닫힌다 —
// 거리만 보면 빠르게 쓸어내렸을 때 도로 올라가 답답하다.
const CLOSE_DISTANCE = 92
const CLOSE_VELOCITY = 0.7   // px/ms (≈700px/s — 천천히 끄는 손은 여기 못 닿는다)
// 던져서 닫으려면 이만큼은 실제로 내려가 있어야 한다.
const FLING_MIN_DISTANCE = 28
// 이 이하는 탭으로 본다(버튼을 누를 때 손가락이 조금 흔들리는 정도).
const DRAG_SLOP = 6

export default function ActionSheet({ title, subtitle, actions = [], onClose }) {
  // 애니메이션을 끄기로 한 사용자에게는 움직임 없이 즉시 보여준다(처음부터 올라간 상태로 시작).
  const [reduceMotion] = useState(
    () => typeof window !== 'undefined'
      && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
  )
  const [entered, setEntered] = useState(reduceMotion)
  const [closing, setClosing] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const bodyRef = useRef(null)
  const drag = useRef(null)
  const closed = useRef(false)

  // 마운트한 프레임에 translateY(100%) 로 그려두고, 다음 프레임에 0 으로 옮겨야
  // 브라우저가 두 상태 사이를 보간한다. 같은 프레임에 바꾸면 그냥 튀어나온다.
  //
  // 타이머로 한 번 더 받친다. 탭이 백그라운드면 requestAnimationFrame 이 아예 안 불려서
  // 시트가 화면 밖에 걸린 채 영영 안 올라온다(어차피 숨은 탭에서는 트랜지션도 안 돈다).
  useEffect(() => {
    if (reduceMotion) return
    const raf = requestAnimationFrame(() => setEntered(true))
    const timer = setTimeout(() => setEntered(true), 60)
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [reduceMotion])

  // 내려가는 모습을 다 보여준 뒤에 실제로 언마운트한다.
  const close = useCallback(() => {
    if (closed.current) return
    closed.current = true
    setClosing(true)
    setTimeout(onClose, reduceMotion ? 0 : EXIT_MS)
  }, [onClose, reduceMotion])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])

  const onPointerDown = (e) => {
    if (closed.current) return
    // 머리말이 아니라 목록에서 시작했고 이미 스크롤이 내려가 있으면, 스크롤이 먼저다.
    const fromHead = Boolean(e.target.closest?.('[data-sheet-head]'))
    if (!fromHead && bodyRef.current && bodyRef.current.scrollTop > 0) return
    drag.current = {
      startY: e.clientY, dy: 0,
      sampleY: e.clientY, sampleT: performance.now(),
      velocity: 0, active: false,
    }
  }

  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return

    const now = performance.now()
    const dt = now - d.sampleT
    // 브라우저는 포인터 이벤트를 뭉쳐 보낼 때가 있다. dt 가 0 에 가까운 표본으로 나누면
    // 속도가 무한대로 튀어, 살짝 움직였을 뿐인데 '휙 던졌다'로 읽힌다. 그런 표본은 버린다.
    if (dt >= 8) {
      d.velocity = (e.clientY - d.sampleY) / dt
      d.sampleY = e.clientY
      d.sampleT = now
    }

    const dy = e.clientY - d.startY
    d.dy = dy
    if (!d.active) {
      if (dy < DRAG_SLOP) return   // 아래로 확실히 움직이기 전까지는 탭일 수 있다
      d.active = true
      setDragging(true)
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    // 위로는 거의 안 늘어난다 — 끝이 있다는 걸 손끝으로 알려준다.
    setDragY(dy > 0 ? dy : dy * 0.2)
  }

  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d?.active) return
    setDragging(false)
    // 충분히 내렸거나, 짧아도 분명히 아래로 던졌으면 닫는다.
    // 속도만으로 닫지 않는 이유 — 손가락이 조금 미끄러진 것까지 '던졌다'로 읽으면 오작동이 된다.
    const flung = d.dy > FLING_MIN_DISTANCE && d.velocity > CLOSE_VELOCITY
    if (d.dy > CLOSE_DISTANCE || flung) close()
    else setDragY(0)   // 모자라면 제자리로 되돌아간다
  }

  const hidden = closing || !entered
  const transition = dragging || reduceMotion
    ? 'none'
    : `transform ${closing ? EXIT_MS : ENTER_MS}ms ${EASE}`

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        background: 'rgba(15,23,42,.45)',
        // 시트를 내릴수록 뒤 화면이 드러난다. 끌던 손이 어디까지 왔는지 배경으로도 보인다.
        opacity: hidden ? 0 : Math.max(0, 1 - Math.max(dragY, 0) / 360),
        transition: dragging || reduceMotion ? 'none' : `opacity ${closing ? EXIT_MS : ENTER_MS}ms ease`,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          background: 'var(--surface)', borderTopLeftRadius: 18, borderTopRightRadius: 18,
          paddingBottom: 'max(10px, env(safe-area-inset-bottom))',
          boxShadow: '0 -4px 24px rgba(15,23,42,.18)',
          transform: hidden ? 'translateY(100%)' : `translateY(${dragY}px)`,
          transition,
          willChange: 'transform',
        }}
      >
        {/* 머리말 전체가 손잡이다. touchAction:none 이라야 브라우저가 이 제스처를
            페이지 스크롤로 가로채지 않는다. */}
        <div data-sheet-head style={{ touchAction: 'none', cursor: 'grab' }}>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 6px' }}>
            <span style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)' }} />
          </div>
          {title && (
            <div style={{ padding: '4px 20px 12px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-.2px' }}>{title}</div>
              {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
            </div>
          )}
        </div>
        <div
          ref={bodyRef}
          className="ls-scroll"
          style={{
            padding: '6px 10px 10px',
            // 항목이 많아 화면을 넘기면 그때만 목록이 스크롤된다.
            maxHeight: '60vh', overflowY: 'auto', overscrollBehavior: 'contain',
          }}
        >
          {actions.map(a => (
            <button
              key={a.label}
              // 끌어내리는 중에 손을 뗀 것을 누름으로 읽으면, 닫으려다 엉뚱한 항목이 실행된다.
              onClick={() => {
                if (a.disabled || drag.current?.active || dragY !== 0) return
                close()
                a.onClick()
              }}
              disabled={a.disabled}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                width: '100%', minHeight: 48, padding: '0 12px', textAlign: 'left',
                border: 'none', borderRadius: 11, fontFamily: 'inherit',
                background: a.selected ? 'var(--blue-tint)' : 'transparent',
                fontSize: 14.5, fontWeight: a.selected ? 800 : 600, cursor: a.disabled ? 'default' : 'pointer',
                color: a.disabled ? 'var(--text-muted)'
                  : a.selected ? 'var(--blue-primary)' : (TONE_COLOR[a.tone] ?? TONE_COLOR.default),
                opacity: a.disabled ? 0.45 : 1,
              }}
            >
              {a.label}
              {a.selected && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
