// 바텀시트 드래그 — 핸들을 잡고 위아래로 끌면 그만큼 시트 높이가 따라오고, 놓으면 끈 **방향**의
// 끝까지 간다. 위로 조금만 끌어도 full, 아래로 조금만 끌어도 collapsed 다.
//   collapsed : 핸들 바만 남고 지도만 보이는 상태
//   mid       : 처음 열었을 때의 상태. 시트 머리말 정도가 보인다(드래그로는 다시 오지 않는다)
//   full      : 시트가 화면을 거의 다 덮는다
//
// 예전에는 놓은 자리에서 '가장 가까운' 스냅으로 붙였다. 그러면 끝까지 올리려면 화면 절반 넘게
// 끌어야 했고, 조금 끌다 놓으면 제자리로 튕겨 돌아와 사용자가 두세 번씩 다시 끌었다.
// 안드로이드 앱(DragSheet.kt)도 같은 규칙이다 — 한쪽만 바꾸지 말 것.
//
// 핸들 바는 포인터 이벤트로 끈다(터치·마우스 공용).
// 본문(스크롤 영역)은 네이티브 스크롤과 공존해야 해서 터치 이벤트로 직접 중재한다:
//   · 시트가 full 이 아니면        → 본문 어디를 잡아도 시트가 움직인다(스크롤은 아직 잠금).
//   · full 이고 내용이 안 넘치면   → 본문 어디를 잡아도 시트가 내려간다(스크롤이 없으니).
//   · full 이고 내용이 넘치면      → 제목(data-sheet-head)을 잡으면 시트가 움직이고,
//                                    본문은 정상 스크롤하되 맨 위에서 더 당기면 그때 시트가 내려간다.
import { useState, useRef, useEffect, useCallback } from 'react'

// 이만큼(px) 이상 끌어야 '방향이 있는 드래그'로 본다. 이보다 짧으면 손떨림으로 보고 제자리로 돌린다.
const FLICK_PX = 12

export default function useDragSheet(containerRef, {
  collapsed = 26,
  mid = 132,
  fullRatio = 0.92,
  initial = 'mid',
  enabled = true,
} = {}) {
  const [containerH, setContainerH] = useState(0)
  const [height, setHeight] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [bodyEl, setBodyEl] = useState(null)
  const drag = useRef(null)

  // 컨테이너 높이를 알아야 full 높이를 계산할 수 있다(주소창 노출로 바뀔 수 있어 관찰한다).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const sync = () => setContainerH(el.clientHeight)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  const pointFor = useCallback((name) => {
    if (name === 'collapsed') return collapsed
    if (name === 'full') return containerH ? Math.round(containerH * fullRatio) : mid
    return mid
  }, [collapsed, mid, fullRatio, containerH])

  const snapTo = useCallback((name) => setHeight(pointFor(name)), [pointFor])

  // 사용자가 아직 안 건드렸으면(height === null) 초기 스냅을 그대로 쓴다.
  // effect로 setHeight 하지 않고 렌더에서 유도해, 컨테이너 크기를 처음 알게 될 때 생기는 추가 렌더를 피한다.
  const current = height ?? pointFor(initial)
  const isFull = containerH > 0 && current >= pointFor('full') - 2

  // 놓았을 때 끈 방향의 끝으로 보낸다. startH 는 끌기 시작할 때의 높이다.
  const settle = useCallback((startH) => {
    setHeight((h) => {
      const cur = h ?? pointFor(initial)
      const dy = cur - startH
      if (dy >= FLICK_PX) return pointFor('full')
      if (dy <= -FLICK_PX) return pointFor('collapsed')
      return startH // 거의 안 움직였으면 원래 자리로
    })
  }, [pointFor, initial])

  // ── 핸들 바(포인터) ─────────────────────────────────────────────
  const onPointerDown = useCallback((e) => {
    if (!enabled) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { startY: e.clientY, startH: current, moved: 0 }
    setDragging(true)
  }, [enabled, current])

  const onPointerMove = useCallback((e) => {
    if (!drag.current) return
    const dy = drag.current.startY - e.clientY // 위로 끌면 양수 = 커진다
    drag.current.moved = Math.max(drag.current.moved, Math.abs(dy))
    const max = pointFor('full')
    setHeight(Math.min(max, Math.max(collapsed, drag.current.startH + dy)))
  }, [collapsed, pointFor])

  const onPointerUp = useCallback(() => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (!d) return
    // 거의 안 움직였으면 탭으로 보고 끝과 끝을 오간다(다 올라가 있으면 내리고, 아니면 올린다).
    if (d.moved < 5) {
      setHeight(h => ((h ?? pointFor(initial)) >= pointFor('full') - 2 ? pointFor('collapsed') : pointFor('full')))
      return
    }
    settle(d.startH)
  }, [pointFor, initial, settle])

  // ── 본문(터치) : 스크롤과 시트 드래그를 상황에 맞게 중재 ────────────
  // 리스너 안에서 최신 값을 읽도록 ref 로 흘려둔다(리스너를 매 렌더 재부착하지 않기 위해).
  // 렌더 중이 아니라 렌더 후 effect에서 갱신한다.
  const liveRef = useRef({})
  useEffect(() => {
    liveRef.current = { current, isFull, pointFor, collapsed, enabled }
  })

  useEffect(() => {
    if (!bodyEl) return
    let g = null

    const onStart = (e) => {
      if (!liveRef.current.enabled || e.touches.length !== 1) { g = null; return }
      const t = e.touches[0]
      g = {
        startY: t.clientY,
        startH: liveRef.current.current,
        moved: 0,
        mode: null, // 'sheet' | 'scroll' | null(아직 결정 안 함)
        inHeader: !!(e.target.closest && e.target.closest('[data-sheet-head]')),
      }
    }

    const onMove = (e) => {
      if (!g) return
      const dy = g.startY - e.touches[0].clientY // 손가락 위로 = 양수(시트 커짐)
      g.moved = Math.max(g.moved, Math.abs(dy))

      if (g.mode === null) {
        if (g.moved < 4) return // 방향이 분명해질 때까지 판단을 미룬다
        const overflowing = bodyEl.scrollHeight > bodyEl.clientHeight + 1
        if (!liveRef.current.isFull) {
          g.mode = 'sheet'            // 아직 다 안 올림 → 본문을 끌면 시트가 움직인다
        } else if (!overflowing) {
          g.mode = 'sheet'            // 스크롤 없음 → 어디를 잡아도 시트가 움직인다
        } else if (g.inHeader) {
          g.mode = 'sheet'            // 제목을 잡음 → 시트가 움직인다
        } else {
          const atTop = bodyEl.scrollTop <= 0
          const pullingDown = dy < 0  // 손가락을 아래로(=위로 스크롤) 당김
          g.mode = (atTop && pullingDown) ? 'sheet' : 'scroll' // 맨 위에서 더 당기면 시트, 아니면 스크롤
        }
        if (g.mode === 'sheet') setDragging(true)
      }

      if (g.mode === 'sheet') {
        e.preventDefault() // 네이티브 스크롤을 막고 시트를 손가락에 붙인다
        const max = liveRef.current.pointFor('full')
        setHeight(Math.min(max, Math.max(liveRef.current.collapsed, g.startH + dy)))
      }
    }

    const onEnd = () => {
      if (!g) return
      const wasSheet = g.mode === 'sheet'
      const startH = g.startH
      g = null
      if (wasSheet) { setDragging(false); settle(startH) }
    }

    bodyEl.addEventListener('touchstart', onStart, { passive: true })
    bodyEl.addEventListener('touchmove', onMove, { passive: false })
    bodyEl.addEventListener('touchend', onEnd)
    bodyEl.addEventListener('touchcancel', onEnd)
    return () => {
      bodyEl.removeEventListener('touchstart', onStart)
      bodyEl.removeEventListener('touchmove', onMove)
      bodyEl.removeEventListener('touchend', onEnd)
      bodyEl.removeEventListener('touchcancel', onEnd)
    }
  }, [bodyEl, settle])

  const handleProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    // 브라우저가 이 제스처를 페이지 스크롤로 가로채지 못하게 한다.
    style: { touchAction: 'none' },
  }

  // 본문: full 이면 세로 스크롤 허용(pan-y), 아니면 우리가 전부 드래그로 쓰므로 막는다.
  // 스크롤 체이닝(뒤 페이지로 번지는 것)은 막는다.
  const bodyProps = {
    ref: setBodyEl,
    style: { touchAction: isFull ? 'pan-y' : 'none', overscrollBehavior: 'contain' },
  }

  return {
    height: current,
    dragging,
    handleProps,
    bodyProps,
    snapTo,
    isFull,
  }
}
