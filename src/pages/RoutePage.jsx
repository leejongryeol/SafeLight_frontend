import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import UserShell from '../components/layout/UserShell'
import useIsMobile from '../hooks/useIsMobile'
import Icon from '../components/Icon'
import useDragSheet from '../hooks/useDragSheet'
import useSheetHeadHeight from '../hooks/useSheetHeadHeight'
import { SHEET_COLLAPSED } from '../components/layout/BottomSheet'
import { apiFetch } from '../utils/api'
import { saveActiveRoute } from '../utils/activeRoute'
import { LAYER_COLOR, FACILITY_MAX_LEVEL, lampMaxLevel, POLICE_Z, dotContent } from '../components/Map/layerStyle'
import { createFacilityLoader } from '../utils/facilityApi'
import { renderFacilityDots } from '../components/Map/facilityLayer'
import { collectStores } from '../components/Map/storeSearch'

// 지도 화면과 같은 방식으로 '보이는 범위'만 받는다. 전국 CCTV 25만 건이라 전체 조회는 없다.
const loadCctv = createFacilityLoader('/cctvs', item => ({
  lat: item.latitude,
  lng: item.longitude,
}))

// 가로등은 좌표만 온다(LocationDto).
const loadLamps = createFacilityLoader('/security-lights', item => ({
  lat: item.latitude,
  lng: item.longitude,
}))

// 치안시설(지구대·파출소 등). 범위 규칙은 CCTV·가로등과 같다.
const loadPolice = createFacilityLoader('/police-facilities', item => ({
  lat: item.latitude,
  lng: item.longitude,
}))

const START_COLOR = '#2563EB'
const DEST_COLOR = '#E11D48'

// 구간 식별자 — 이름이 아니라 좌표로 만든다(같은 자리라도 이름은 나중에 주소로 바뀐다).
const coordKey = (p) => (p ? `${p.lat},${p.lng}` : '')
const segmentKey = (start, dest) => `${coordKey(start)}|${coordKey(dest)}`
// 배경 시설 점은 경로 위 안전시설 점(9px)보다 크면 시선을 뺏는다 — 한 단계 작게 둔다.
const cctvDot = dotContent(LAYER_COLOR.cctv, 9)
const lampDot = dotContent(LAYER_COLOR.streetLamp, 9)
const storeDot = dotContent(LAYER_COLOR.store, 9)
const policeDot = dotContent(LAYER_COLOR.police, 9)

// '2026-08-06T08:35:12' → '08-06 08:35'
const fmtSearchedAt = (iso) => (iso ? String(iso).slice(5, 16).replace('T', ' ') : '')

export default function RoutePage({ user, onLogout }) {
  const navigate = useNavigate()
  // 모바일(M4): 좌측 360px 패널이 화면을 다 먹으므로 지도 위 바텀시트로 전환한다(panelOpen = 시트 펼침).
  const isMobile = useIsMobile()
  const containerRef = useRef(null)
  const sheetRef = useRef(null)
  // mid = 핸들 + 제목 블록. 조금만 올리면 '안전 경로 안내' 제목까지만 보인다.
  const sheetMid = useSheetHeadHeight(sheetRef, { handle: SHEET_COLLAPSED, fallback: 128 })
  const {
    height: sheetH, dragging: sheetDragging, handleProps: sheetHandleProps,
    bodyProps: sheetBodyProps, isFull: sheetFull,
  } = useDragSheet(containerRef, {
    collapsed: SHEET_COLLAPSED, mid: sheetMid, fullRatio: 0.92, initial: 'mid',
  })
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const markersRef = useRef([])
  const polylinesRef = useRef([])
  const facilityOverlaysRef = useRef([])
  const cctvReqRef = useRef(0)   // 늦게 도착한 이전 조회 결과를 버리기 위한 순번
  const cctvOverlaysRef = useRef([])
  const lampReqRef = useRef(0)
  const lampOverlaysRef = useRef([])
  const storeReqRef = useRef(0)
  const storeOverlaysRef = useRef([])
  const policeReqRef = useRef(0)
  const policeOverlaysRef = useRef([])
  const resultSegmentRef = useRef('') // 지금 띄워둔 검색 결과가 어느 구간의 것인지

  // 모바일에서는 바텀시트가 지도 아래쪽을 덮는다. 그냥 setCenter 하면 출발/도착 마커가 시트 뒤로 숨으므로,
  // 시트를 뺀 '실제로 보이는 영역'의 한가운데로 오도록 시트 높이의 절반만큼 지도를 밀어준다.
  // (시트를 끝까지 올린 상태에서는 지도가 어차피 안 보이므로 mid 높이까지만 보정한다)
  const visibleOffset = () => (isMobile ? Math.min(sheetH, sheetMid) : 0)

  // 최신 보정값은 ref로 넘긴다. centerOnVisible을 sheetH에 의존시키면 이 함수를 쓰는 effect가
  // 시트를 끌 때마다 다시 돌아 위치 조회를 반복하게 된다.
  const sheetOffsetRef = useRef(0)
  useEffect(() => { sheetOffsetRef.current = isMobile ? Math.min(sheetH, sheetMid) : 0 }, [isMobile, sheetH, sheetMid])

  const centerOnVisible = useCallback((latlng) => {
    const map = mapInstance.current
    if (!map) return
    map.setCenter(latlng)
    const off = sheetOffsetRef.current
    if (off) map.panBy(0, off / 2)
  }, [])

  const [startMode, setStartMode] = useState('current')
  const [currentLocation, setCurrentLocation] = useState(null)
  const [startAddress, setStartAddress] = useState('') // 현재 위치의 사람이 읽는 주소 (역지오코딩)
  const [startSearch, setStartSearch] = useState('')
  const [startResult, setStartResult] = useState([])
  const [selectedStart, setSelectedStart] = useState(null)

  // 북마크는 도착지 탭에서 빠져나와 아래 전용 카드로 옮겼다 — 도착지 지정이 아니라 '바로 안내' 지름길이라
  // 같은 탭 줄에 두면 성격이 섞인다.
  const [destMode, setDestMode] = useState('search')
  const [destSearch, setDestSearch] = useState('')
  const [destResult, setDestResult] = useState([])
  const [selectedDest, setSelectedDest] = useState(null)

  const [bookmarkQuery, setBookmarkQuery] = useState('')
  const [bookmarkSort, setBookmarkSort] = useState('recent')
  const [bookmarkBusyId, setBookmarkBusyId] = useState(null) // 경로를 다시 받는 중인 북마크

  const [mapReady, setMapReady] = useState(false) // 카카오 지도 인스턴스 생성 완료 (마커 동기화 시점)
  const [pendingPlace, setPendingPlace] = useState(null) // 상단 검색에서 넘어온 장소 (출발/도착 선택 대기)
  const [routes, setRoutes] = useState([])
  const [selectedRoute, setSelectedRoute] = useState(null)
  const [isSearched, setIsSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [bookmarks, setBookmarks] = useState([])
  const [recentRoutes, setRecentRoutes] = useState([])
  const [recentLabels, setRecentLabels] = useState({}) // routeHistoryId → 도착지 주소 (역지오코딩 결과)
  const [panelOpen, setPanelOpen] = useState(true) // 좌측 경로 안내 패널 열기/닫기

  // 로그인 여부 판단에만 쓴다 — 요청 헤더는 apiFetch 가 붙인다.
  const token = localStorage.getItem('accessToken')

  // 지도 화면(MapView)과 같은 규칙으로 배경 시설을 깐다 — 화면 안에 있는 것만,
  // 레이어마다 정해진 상한 레벨까지만. 예전에는 전국 CCTV 를 통째로 마커 클러스터러에 넣어서,
  // 넓게 보면 숫자 뭉치만 잔뜩 뜨고 느렸다.
  //
  // 조회·순번·범위 판정은 지도 화면과 똑같아서 facilityLayer.js 하나를 같이 쓴다.
  // 이 화면은 레이어 칩이 없으므로 안내문구(setNotice)를 넘기지 않는다.
  const renderCctvInBounds = useCallback(() => renderFacilityDots({
    map: mapInstance.current,
    overlaysRef: cctvOverlaysRef, seqRef: cctvReqRef,
    load: loadCctv, maxLevel: FACILITY_MAX_LEVEL,
    dot: cctvDot, zIndex: 2, label: 'CCTV',
  }), [])

  // 가로등만 한 단계 더 확대해야 그린다. 전국 184만 개로 CCTV(25만)의 7배라
  // 같은 레벨에서 그리면 지도가 멎는다(layerStyle.js 의 실측 표 참고).
  // 데스크탑은 화면이 넓어 같은 레벨에도 3배쯤 더 깔리므로 거기서만 한 단계 더 조인다.
  // 제일 많으니 맨 아래(zIndex 1)에 깐다 — 위에 얹으면 몇 안 되는 CCTV 점을 노란 점들이 덮는다.
  const renderLampsInBounds = useCallback(() => renderFacilityDots({
    map: mapInstance.current,
    overlaysRef: lampOverlaysRef, seqRef: lampReqRef,
    load: loadLamps, maxLevel: lampMaxLevel(isMobile),
    dot: lampDot, zIndex: 1, label: '가로등',
  }), [isMobile])

  // 치안시설은 몇 곳 안 되니 배경 시설 중 맨 위(zIndex 4)에 얹는다.
  const renderPoliceInBounds = useCallback(() => renderFacilityDots({
    map: mapInstance.current,
    overlaysRef: policeOverlaysRef, seqRef: policeReqRef,
    load: loadPolice, maxLevel: FACILITY_MAX_LEVEL,
    dot: policeDot, zIndex: POLICE_Z, label: '치안시설',
  }), [])

  // 편의점만 출처가 다르다. 백엔드에 영역 조회가 없어 카카오 로컬을 직접 부른다(storeSearch.js).
  const renderStoresInBounds = useCallback(() => {
    const map = mapInstance.current
    if (!map || !window.kakao?.maps?.services) return

    // 이 시점 이후 도착하는 이전 요청의 콜백은 무시된다
    const reqId = ++storeReqRef.current
    storeOverlaysRef.current.forEach(o => o.setMap(null))
    storeOverlaysRef.current = []
    if (map.getLevel() > FACILITY_MAX_LEVEL) return

    collectStores(map.getBounds()).then(({ places, failed }) => {
      if (reqId !== storeReqRef.current) return
      if (failed) { console.error('편의점 조회 실패'); return }

      places.forEach(place => {
        const overlay = new window.kakao.maps.CustomOverlay({
          position: new window.kakao.maps.LatLng(Number(place.y), Number(place.x)),
          content: storeDot, yAnchor: 0.5, xAnchor: 0.5, zIndex: 3,
        })
        overlay.setMap(map)
        storeOverlaysRef.current.push(overlay)
      })
    })
  }, [])

  const renderFacilitiesInBounds = useCallback(() => {
    renderCctvInBounds()
    renderLampsInBounds()
    renderStoresInBounds()
    renderPoliceInBounds()
  }, [renderCctvInBounds, renderLampsInBounds, renderStoresInBounds, renderPoliceInBounds])

  useEffect(() => {
    const initMap = () => {
      if (!window.kakao || !window.kakao.maps) return
      const container = mapRef.current
      mapInstance.current = new window.kakao.maps.Map(container, {
        center: new window.kakao.maps.LatLng(37.4979, 127.0276), level: FACILITY_MAX_LEVEL,
      })
      window.kakao.maps.event.addListener(mapInstance.current, 'idle', renderFacilitiesInBounds)
      setMapReady(true)
      renderFacilitiesInBounds()
    }
    if (window.kakao && window.kakao.maps) initMap()
    else {
      const check = setInterval(() => { if (window.kakao && window.kakao.maps) { clearInterval(check); initMap() } }, 300)
      return () => clearInterval(check)
    }
  }, [renderFacilitiesInBounds])

  // 좌표 → 도로명(없으면 지번) 주소. 카카오 services 로 처리하므로 백엔드가 필요 없다.
  const reverseGeocode = useCallback((lat, lng) => new Promise((resolve) => {
    if (!window.kakao?.maps?.services) { resolve(''); return }
    const geocoder = new window.kakao.maps.services.Geocoder()
    geocoder.coord2Address(lng, lat, (result, status) => {
      if (status !== window.kakao.maps.services.Status.OK || !result?.length) { resolve(''); return }
      resolve(result[0].road_address?.address_name || result[0].address?.address_name || '')
    })
  }), [])

  useEffect(() => {
    if (startMode === 'current') {
      navigator.geolocation?.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords
          setCurrentLocation({ lat: latitude, lng: longitude })
          setSelectedStart({ lat: latitude, lng: longitude, name: '현재 위치' })
          // 주소를 알아내면 출발지 이름도 주소로 바꾼다 — 북마크 routeName 이 '현재 위치 → …'
          // 처럼 나중에 알아볼 수 없는 이름으로 저장되는 걸 막는다.
          reverseGeocode(latitude, longitude).then(addr => {
            if (!addr) return
            setStartAddress(addr)
            setSelectedStart(prev => (prev && prev.lat === latitude && prev.lng === longitude ? { ...prev, name: addr } : prev))
          })
          if (mapInstance.current) {
            mapInstance.current.setLevel(FACILITY_MAX_LEVEL)
            centerOnVisible(new window.kakao.maps.LatLng(latitude, longitude))
          }
        },
        () => setCurrentLocation(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      )
    }
  }, [startMode, centerOnVisible, reverseGeocode])

  // 좌측 패널 접힘/펼침 등으로 지도 컨테이너 크기가 바뀌면 카카오 지도 relayout (안 하면 타일이 잘림).
  // 넓어진 만큼 화면에 새로 들어온 시설도 같이 그린다 — relayout 만으로는 점이 이전 영역 기준으로 남는다.
  useEffect(() => {
    if (!mapRef.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!mapInstance.current) return
      requestAnimationFrame(() => {
        mapInstance.current.relayout()
        renderFacilitiesInBounds()
      })
    })
    ro.observe(mapRef.current)
    return () => ro.disconnect()
  }, [renderFacilitiesInBounds])

  // 선언을 effect보다 앞에 둔다 — effect에서 아직 선언 전인 const 를 참조하면 안 된다.
  // token 을 의존성으로 두는 건 '로그인이 바뀌면 다시 받는다'는 뜻이다(헤더 때문이 아니다).
  const fetchBookmarks = useCallback(async () => {
    try {
      const json = await apiFetch('/bookmarks')
      if (json.success) setBookmarks(json.data ?? [])
      else console.warn('북마크 조회 실패:', json.message)
    } catch (err) { console.error('북마크 조회 실패:', err) }
    // token 은 본문에서 안 쓰지만 의존성으로 남긴다 — 로그인/로그아웃 때 다시 받기 위한 것이다.
    // (헤더는 apiFetch 가 붙이므로 본문에서 token 을 읽을 일이 없어졌다.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => { fetchBookmarks() }, [fetchBookmarks])

  // 최근 경로 — /routes 가 성공하면 백엔드가 알아서 저장한다. 프론트는 조회·삭제만 맡는다.
  const fetchRecentRoutes = useCallback(async () => {
    if (!token) { setRecentRoutes([]); return }
    try {
      const json = await apiFetch('/recent-routes')
      if (json.success) setRecentRoutes(json.data ?? [])
      else console.warn('최근 경로 조회 실패:', json.message)
    } catch (err) { console.error('최근 경로 조회 실패:', err) }
  }, [token])

  useEffect(() => { fetchRecentRoutes() }, [fetchRecentRoutes])

  // 백엔드는 자동 저장 시 이름을 '최근 검색 경로'로 고정해 저장한다. 목록에서 구분이 안 되므로
  // 도착지 좌표를 주소로 바꿔서 보여준다.
  useEffect(() => {
    if (!mapReady || recentRoutes.length === 0) return
    let alive = true
    Promise.all(recentRoutes.map(async (rh) => [
      rh.routeHistoryId,
      await reverseGeocode(rh.endLatitude, rh.endLongitude),
    ])).then(pairs => {
      if (alive) setRecentLabels(Object.fromEntries(pairs.filter(([, addr]) => addr)))
    })
    return () => { alive = false }
  }, [mapReady, recentRoutes, reverseGeocode])

  const searchPlace = (keyword, setResult) => {
    if (!keyword.trim() || !window.kakao) return
    const ps = new window.kakao.maps.services.Places()
    ps.keywordSearch(keyword, (data, status) => {
      if (status === window.kakao.maps.services.Status.OK) {
        setResult(data.slice(0, 4).map(p => ({ name: p.place_name, address: p.road_address_name || p.address_name, lat: parseFloat(p.y), lng: parseFloat(p.x) })))
      }
    })
  }

  const clearMarkers = useCallback(() => { markersRef.current.forEach(m => m.setMap(null)); markersRef.current = [] }, [])

  // 경로 주변 안전시설 점 — 백엔드가 경로마다 cctvLocations / storeLocations /
  // securityLightLocations / policeFacilityLocations 를 같이 내려준다(RouteDto).
  const clearFacilities = useCallback(() => { facilityOverlaysRef.current.forEach(o => o.setMap(null)); facilityOverlaysRef.current = [] }, [])

  const clearPolylines = useCallback(() => {
    polylinesRef.current.forEach(p => p.setMap(null)); polylinesRef.current = []
    clearFacilities()
  }, [clearFacilities])

  const drawFacilities = (route) => {
    clearFacilities()
    if (!mapInstance.current || !window.kakao) return
    const dot = (color) =>
      `<div style="width:9px;height:9px;border-radius:50%;background:${color};border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(15,23,42,.18)"></div>`
    const add = (list, color) => {
      ;(Array.isArray(list) ? list : []).forEach(p => {
        if (p?.latitude == null || p?.longitude == null) return
        const o = new window.kakao.maps.CustomOverlay({
          // 배경 시설 점(가로등 1 · CCTV 2 · 편의점 3)보다 위에 온다. 이 점들은 '이 경로에
          // 붙은' 시설이라 배경에 묻히면 경로를 왜 안전하다고 했는지 읽을 수가 없다.
          position: new window.kakao.maps.LatLng(p.latitude, p.longitude),
          content: dot(color), yAnchor: 0.5, xAnchor: 0.5, zIndex: 5,
        })
        o.setMap(mapInstance.current)
        facilityOverlaysRef.current.push(o)
      })
    }
    // 가로등을 먼저 깔고 CCTV·편의점을 그 위에 올린다. 보안등은 191,378개라 경로 하나에
    // 수백 개가 붙는데, 나중에 그리면 몇 안 되는 CCTV 점을 노란 점들이 덮어버린다.
    add(route?.securityLightLocations, LAYER_COLOR.streetLamp)
    add(route?.cctvLocations, LAYER_COLOR.cctv)
    add(route?.storeLocations, LAYER_COLOR.store)
    add(route?.policeFacilityLocations, LAYER_COLOR.police)
  }

  const addMarker = useCallback((latlng, label, color) => {
    if (!mapInstance.current) return
    const content = `<div style="background:${color};border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.25);">${label}</div>`
    // 출발·도착은 무엇에도 가리면 안 된다 — 배경 시설(1~3)과 경로 위 시설(5) 위에 둔다.
    const overlay = new window.kakao.maps.CustomOverlay({ position: latlng, content, yAnchor: 1, zIndex: 6 })
    overlay.setMap(mapInstance.current)
    markersRef.current.push(overlay)
  }, [])

  // 출발·도착 마커는 오직 여기서만 그린다. 선택 상태가 바뀔 때마다 전부 지우고 다시 찍으므로
  // 출발 1개 + 도착 1개가 보장된다.
  // (이전에는 핸들러와 위치조회 effect가 각자 addMarker 를 불러서, 현재위치↔직접검색을 오가거나
  //  위치 조회가 다시 돌 때마다 같은 자리에 마커가 겹겹이 쌓였다.)
  useEffect(() => {
    if (!mapReady) return
    clearMarkers()
    if (selectedStart) addMarker(new window.kakao.maps.LatLng(selectedStart.lat, selectedStart.lng), '출발', START_COLOR)
    if (selectedDest) addMarker(new window.kakao.maps.LatLng(selectedDest.lat, selectedDest.lng), '도착', DEST_COLOR)
  }, [mapReady, selectedStart, selectedDest, clearMarkers, addMarker])

  // 출발·도착이 바뀌면 이전 검색 결과는 더 이상 이 구간의 것이 아니다 — 통째로 버린다.
  // 안 버리면 마커만 새 위치로 옮겨가고 경로선·추천 목록·안전도 패널은 옛 구간 그대로 남았다.
  // (그 상태에서 '지도에서 경로 보기'를 누르면 옛 경로선에 새 출발·도착을 붙여 안내를 시작한다.)
  // 검색 버튼도 다시 나타나므로 새 구간을 바로 조회할 수 있다.
  //
  // 객체가 아니라 좌표를 기준으로 본다. 현재 위치는 역지오코딩이 끝나면 이름만 채워
  // 새 객체로 교체되는데, 그때까지 결과를 지워버리면 안 된다.
  //
  // resultSegmentRef 는 '지금 띄워둔 결과가 어느 구간의 것인지'다. 북마크는 구간과 결과를
  // 한 번에 바꾸므로, 이게 없으면 이 effect 가 방금 띄운 결과를 곧바로 지워버린다.
  const segment = segmentKey(selectedStart, selectedDest)
  useEffect(() => {
    if (segment === resultSegmentRef.current) return
    resultSegmentRef.current = ''
    setIsSearched(false)
    setRoutes([])
    setSelectedRoute(null)
    clearPolylines()
  }, [segment, clearPolylines])

  // '현재 위치'가 실제와 다를 때(GPS 오차·실내 등) 사용자가 직접 고칠 수 있게 한다.
  // 검색 모드로 넘기면서 지금 주소를 미리 채워 넣고 후보까지 띄워준다.
  const handleEditStart = () => {
    const seed = startAddress || startSearch
    setStartMode('search')
    setStartSearch(seed)
    if (seed) searchPlace(seed, setStartResult)
  }

  // 마커는 위 동기화 effect가 맡는다. 핸들러는 선택 상태와 지도 중심만 다룬다.
  const handleSelectStart = (place) => {
    setSelectedStart(place); setStartResult([]); setStartSearch(place.name)
    if (mapInstance.current) centerOnVisible(new window.kakao.maps.LatLng(place.lat, place.lng))
  }

  const handleSelectDest = (place) => {
    setSelectedDest(place); setDestResult([]); setDestSearch(place.name)
    if (mapInstance.current) centerOnVisible(new window.kakao.maps.LatLng(place.lat, place.lng))
  }

  // 상단 검색에서 장소를 고르면 출발/도착 선택 팝업을 띄운다
  const applyPendingAsStart = () => {
    if (!pendingPlace) return
    setStartMode('search')
    handleSelectStart(pendingPlace)
    setPendingPlace(null)
  }
  const applyPendingAsDest = () => {
    if (!pendingPlace) return
    setDestMode('search')
    handleSelectDest(pendingPlace)
    setPendingPlace(null)
  }

  /**
   * 저장해 둔 점수에 가장 가까운 경로. 점수가 없으면(= 새 검색이면) 1등이다.
   *
   * 북마크에는 경로 선(path)이 저장되지 않고 저장 당시의 안전시설 점수만 남는다. 그래서
   * '그때 그 경로'는 점수로 되짚는 수밖에 없다 — 늘 1등을 고르면 북마크할 때 보던 것과
   * 다른 길이 잡힌다. 딱 맞는 점수가 없을 수도 있어서(그사이 CCTV·편의점 데이터가 바뀌면
   * 점수도 달라진다) 가장 가까운 쪽을 고른다.
   * 동점이면 목록이 점수 내림차순이라 더 높은 순위가 먼저 잡힌다.
   */
  const pickByScore = (list, score) => {
    if (score == null || list.length === 0) return list[0] ?? null
    return list.reduce((best, r) =>
      (Math.abs(r.safetyScore - score) < Math.abs(best.safetyScore - score) ? r : best))
  }

  // 받은 경로들을 화면(③ 추천 경로 + 지도)에 올린다. 검색과 북마크가 같은 결과 화면을 쓴다.
  // 어느 구간의 결과인지 함께 기록해 둔다 — 위의 무효화 effect 가 이걸 보고 그냥 지나간다.
  // preferScore 는 북마크가 저장해 둔 점수다(새 검색에는 없다).
  const showRoutes = (found, start, dest, preferScore = null) => {
    resultSegmentRef.current = segmentKey(start, dest)
    const picked = pickByScore(found, preferScore)
    setRoutes(found); setSelectedRoute(picked); setIsSearched(true)
    drawRoute(picked)
  }

  // /routes 호출 한 곳. 경로 검색과 북마크가 같은 응답 형태를 쓰므로 공유한다.
  // 백엔드는 안전 점수 상위 경로들을 한 번에(최대 3개) 돌려준다 — 개수는 백엔드가 정한다.
  const requestRoutes = async (start, dest) => {
    const json = await apiFetch('/routes', {
      method: 'POST',
      body: { startLatitude: start.lat, startLongitude: start.lng, endLatitude: dest.lat, endLongitude: dest.lng },
    })
    const found = json.success ? (json.data ?? []) : []
    // 실패 사유를 그대로 넘긴다 ('경로 없음'과 '권한 없음'은 다르다).
    if (found.length === 0) return { routes: [], message: json.message }
    return {
      routes: [...found]
        .sort((a, b) => b.safetyScore - a.safetyScore)
        .map((r, idx) => ({ ...r, routeId: idx + 1, label: idx === 0 ? '추천' : `경로 ${idx + 1}` })),
      message: null,
    }
  }

  const handleSearchRoute = async () => {
    if (!selectedStart || !selectedDest) { alert('출발지와 도착지를 설정해주세요.'); return }
    setLoading(true)
    try {
      const { routes: labeled, message } = await requestRoutes(selectedStart, selectedDest)
      if (labeled.length === 0) { alert(message || '경로를 찾을 수 없습니다.'); return }
      showRoutes(labeled, selectedStart, selectedDest)
      fetchRecentRoutes() // 백엔드가 이번 검색을 최근 경로에 저장했으므로 목록을 새로 받는다.
    } catch (err) {
      console.error('경로 검색 실패:', err); alert('경로 검색에 실패했습니다.')
    } finally { setLoading(false) }
  }

  // 선택한 경로로 안내를 시작한다 — 세션에 저장해야 다른 화면에 갔다 와도 유지된다(취소는 지도 배너에서).
  const startGuidance = (route, start, dest) => {
    saveActiveRoute({ routePath: route.path, start, dest, safetyScore: route.safetyScore })
    navigate('/')
  }

  const drawRoute = (route) => {
    if (!mapInstance.current || !route?.path) return
    clearPolylines() // 마커는 건드리지 않는다 — 동기화 effect가 이미 출발/도착 하나씩 유지 중이다.
    const linePath = route.path.map(point => new window.kakao.maps.LatLng(point.latitude, point.longitude))
    if (linePath.length === 0) return
    const polyline = new window.kakao.maps.Polyline({ path: linePath, strokeWeight: 6, strokeColor: START_COLOR, strokeOpacity: 0.9, strokeStyle: 'solid' })
    polyline.setMap(mapInstance.current); polylinesRef.current.push(polyline)
    drawFacilities(route)
    const bounds = new window.kakao.maps.LatLngBounds()
    linePath.forEach(latlng => bounds.extend(latlng))
    // 아래쪽 패딩만큼 비워두면 경로 전체가 시트에 가리지 않고 들어온다.
    mapInstance.current.setBounds(bounds, 24, 24, 24 + visibleOffset(), 24)
  }

  const handleBookmarkSave = async () => {
    if (!selectedRoute || !selectedStart || !selectedDest) return
    try {
      const json = await apiFetch('/bookmarks', {
        method: 'POST',
        body: { routeName: `${selectedStart.name} → ${selectedDest.name}`, startLatitude: selectedStart.lat, startLongitude: selectedStart.lng, endLatitude: selectedDest.lat, endLongitude: selectedDest.lng, safetyScore: selectedRoute.safetyScore },
      })
      if (json.success) { alert('북마크에 저장되었습니다.'); fetchBookmarks() }
      else alert(json.message || '저장에 실패했습니다.')
    } catch { alert('저장에 실패했습니다.') }
  }

  const handleBookmarkDelete = async (id) => {
    if (!window.confirm('북마크를 삭제할까요?')) return
    try { await apiFetch(`/bookmarks/${id}`, { method: 'DELETE' }); fetchBookmarks() }
    catch { alert('삭제에 실패했습니다.') }
  }

  const handleRecentDelete = async (routeHistoryId) => {
    try {
      await apiFetch(`/recent-routes/${routeHistoryId}`, { method: 'DELETE' })
      fetchRecentRoutes()
    } catch { alert('삭제에 실패했습니다.') }
  }

  const handleRecentClear = async () => {
    if (!window.confirm('최근 경로를 모두 지울까요?')) return
    try {
      await apiFetch('/recent-routes/all', { method: 'DELETE' })
      fetchRecentRoutes()
    } catch { alert('삭제에 실패했습니다.') }
  }

  const handleRecentRoute = (rh) => {
    const start = { lat: rh.startLatitude, lng: rh.startLongitude, name: '출발지' }
    const dest = { lat: rh.endLatitude, lng: rh.endLongitude, name: recentLabels[rh.routeHistoryId] || '도착지' }
    setSelectedStart(start); setSelectedDest(dest)
    setStartSearch(start.name); setDestSearch(dest.name); setStartMode('search')
    // 띄워둔 후보 목록은 접는다 — 안 그러면 직전 검색어의 후보가 새 도착지 밑에 그대로 남는다.
    setStartResult([]); setDestResult([])
    // 출발지 주소는 목록에 없으니 이때 한 번 더 조회해 이름을 채운다.
    reverseGeocode(rh.startLatitude, rh.startLongitude).then(addr => {
      if (!addr) return
      setSelectedStart(prev => (prev && prev.lat === start.lat && prev.lng === start.lng ? { ...prev, name: addr } : prev))
      setStartSearch(addr)
    })
  }

  // 북마크를 누르면 이 화면에 경로를 바로 띄운다 — 안내 시작은 사용자가 '지도에서 경로 보기'로
  // 직접 누른다. (예전엔 누르자마자 지도 탭으로 넘겼는데, 어떤 길로 가는지 확인할 틈이 없었다.)
  // 북마크에는 출발·도착 좌표만 저장돼 있고 경로 선(path)은 없어서 경로는 다시 받아야 한다.
  const handleBookmarkRoute = async (bookmark) => {
    if (bookmarkBusyId != null) return
    const [startName, destName] = String(bookmark.routeName ?? '').split(' → ')
    const start = { lat: bookmark.startLatitude, lng: bookmark.startLongitude, name: startName || '출발지' }
    const dest = { lat: bookmark.endLatitude, lng: bookmark.endLongitude, name: destName || '도착지' }
    setBookmarkBusyId(bookmark.id)
    // 출발·도착을 먼저 채운다. 경로를 못 받더라도 사용자가 처음부터 다시 넣지 않아도 되고,
    // 받아 오는 동안 어디→어디를 준비 중인지 보인다.
    setSelectedStart(start); setSelectedDest(dest)
    setStartSearch(start.name); setDestSearch(dest.name)
    setStartMode('search'); setDestMode('search')
    setStartResult([]); setDestResult([])
    try {
      const { routes: found, message } = await requestRoutes(start, dest)
      if (found.length === 0) { alert(message || '경로를 찾을 수 없습니다.'); return }
      fetchRecentRoutes()
      // 저장할 때 보던 경로가 기본으로 잡히게 한다(안 그러면 늘 점수 1등이 잡힌다).
      showRoutes(found, start, dest, bookmark.safetyScore)
    } catch (err) {
      console.error('북마크 경로 조회 실패:', err)
      alert('경로를 불러오지 못했습니다.')
    } finally { setBookmarkBusyId(null) }
  }

  // 검색어 + 정렬. 백엔드 Bookmark 에는 생성 시각 컬럼이 없어 '최신'은 id 순(= 저장한 순서)으로 판단한다.
  // 목록 API 도 이미 id DESC 로 내려주므로 기준이 같다.
  const visibleBookmarks = useMemo(() => {
    const q = bookmarkQuery.trim().toLowerCase()
    const list = q ? bookmarks.filter(b => String(b.routeName ?? '').toLowerCase().includes(q)) : [...bookmarks]
    return bookmarkSort === 'name'
      ? list.sort((a, b) => String(a.routeName ?? '').localeCompare(String(b.routeName ?? ''), 'ko'))
      : list.sort((a, b) => b.id - a.id)
  }, [bookmarks, bookmarkQuery, bookmarkSort])

  // 가중치가 붙으면서 같은 경로라도 값이 3배 가까이 커졌다. 색 기준도 같이 올린다.
  const scoreColor = (score) => (score >= 60 ? 'var(--safe)' : score >= 30 ? 'var(--warning)' : 'var(--danger)')

  // 바 길이는 절대 점수가 아니라 **1순위 경로 대비**로 그린다.
  //
  // safetyScore 는 시설 개수의 가중합이라(CCTV×3 + 편의점×3 + 보안등×1 + 치안시설×4)
  // 100 이 만점이 아니다 — 도심 경로는 수백 점, 외곽은 한 자리도 나온다. 100 을 기준으로 그리면
  // 도심에서는 세 경로가 다 꽉 차고 외곽에서는 다 비어서, 어느 쪽이든 경로 사이의 차이가 안 보인다.
  // 1순위를 100% 로 두면 '2순위가 1순위의 몇 할인지'가 바로 읽힌다.
  //
  // routes 는 안전 점수 내림차순이라 routes[0] 이 곧 1순위다.
  const barRatio = (score) => {
    const top = routes[0]?.safetyScore ?? 0
    if (!(top > 0)) return 0   // 전부 0점이면 채울 것이 없다(0 으로 나누는 것도 막는다)
    return Math.max(0, Math.min(100, (score / top) * 100))
  }

  // 백엔드 RouteService.calculateWeightedSafetyScore:
  //   safetyScore = CCTV×3 + 편의점×3 + 보안등×1 + 치안시설×4
  //
  // 예전에는 셋을 그냥 더한 개수여서 '안전시설 n곳'이라고 적었는데, 가중치가 붙은
  // 지금은 개수가 아니라 점수다. 시설 5곳인 경로가 15로 나오므로 '곳'이라고 하면 틀린다.
  // 그래서 '안전 점수 n점'으로 적고, 무엇이 몇 개라 그 점수인지 내역을 같이 보여준다.
  const facilityCounts = (route) => ({
    cctv: route?.cctvLocations?.length ?? null,
    store: route?.storeLocations?.length ?? null,
    streetLamp: route?.securityLightLocations?.length ?? null,
    police: route?.policeFacilityLocations?.length ?? null,
  })
  const facilityDetail = (route) => {
    const { cctv, store, streetLamp, police } = facilityCounts(route)
    if (cctv == null && store == null && streetLamp == null && police == null) return null
    return `CCTV ${cctv ?? 0} · 가로등 ${streetLamp ?? 0} · 편의점 ${store ?? 0} · 치안시설 ${police ?? 0}`
  }

  return (
    <UserShell user={user} onLogout={onLogout} active="route" scroll={false} contentBg="var(--map-bg)" onPickPlace={setPendingPlace}>
      <div ref={containerRef} style={isMobile ? { position: 'relative', height: '100%' } : { display: 'flex', height: '100%' }}>
        {/* 모바일: 지도 위 드래그 바텀시트 / 데스크탑: 좌측 360px 패널(열기·닫기) */}
        <div ref={sheetRef} style={isMobile ? {
          position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 25, overflow: 'hidden',
          display: 'flex', flexDirection: 'column', height: sheetH,
          background: 'var(--surface)', borderTop: '1px solid var(--border)',
          borderTopLeftRadius: 18, borderTopRightRadius: 18,
          boxShadow: '0 -4px 20px rgba(15,23,42,0.08)',
          transition: sheetDragging ? 'none' : 'height .24s ease',
        } : { flex: panelOpen ? '0 0 360px' : '0 0 0px', width: panelOpen ? 360 : 0, minWidth: 0, overflow: 'hidden', transition: 'width .3s ease, flex-basis .3s ease' }}>
          {/* 드래그 핸들 — 스크롤 영역 밖에 둬야 시트 이동과 본문 스크롤이 서로 안 먹는다 */}
          {isMobile && (
            <div
              {...sheetHandleProps}
              role="button"
              aria-label="경로 패널 크기 조절"
              style={{
                ...sheetHandleProps.style,
                flexShrink: 0, height: SHEET_COLLAPSED, minHeight: SHEET_COLLAPSED,
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'grab',
              }}
            >
              <span style={{ width: 38, height: 4, borderRadius: 2, background: 'var(--border)' }} />
            </div>
          )}
          {/* 모바일은 시트를 다 올렸을 때만 스크롤. 그 전에는 본문을 끌어도 시트가 올라간다. */}
          <div
            className="ls-scroll"
            {...(isMobile ? sheetBodyProps : {})}
            style={{
              ...(isMobile ? sheetBodyProps.style : {}),
              width: isMobile ? '100%' : 360, flex: isMobile ? 1 : undefined, minHeight: 0,
              height: isMobile ? undefined : '100%',
              overflowY: !isMobile || sheetFull ? 'auto' : 'hidden',
              background: 'var(--surface)', borderRight: isMobile ? 'none' : '1px solid var(--border)',
            }}
          >
          <div style={{ padding: isMobile ? '0 16px 16px' : 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* data-sheet-head: 모바일 바텀시트가 이 높이를 재서 mid(조금 올린 상태) 높이로 쓴다.
                sticky 는 시트를 다 올려 본문을 스크롤한 뒤 다시 내렸을 때를 위한 것이다. 이게 없으면
                스크롤된 만큼 제목이 밀려 나가서, 조금만 올린 상태에 제목 대신 본문 중간이 보인다.
                안전 현황 시트(RightPanel)도 같은 이유로 제목에 sticky 를 준다. */}
            <div data-sheet-head style={{
              paddingTop: isMobile ? 2 : 0, paddingBottom: isMobile ? 10 : 0,
              // 데스크탑은 스크롤 칸 위쪽에 18 패딩이 있어 top:0 에 붙이면 제목이 그만큼 위로 뛴다.
              ...(isMobile ? { position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 } : {}),
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.3px' }}>안전 경로 안내</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>CCTV·가로등·편의점·치안시설 밀집도로 안전한 길을 찾습니다</div>
            </div>

            {/* 출발지 */}
            <Card title="① 출발지">
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <ModeBtn active={startMode === 'current'} onClick={() => { setStartMode('current'); setStartResult([]) }}><Icon name="map-pin" size={14} /> 현재 위치</ModeBtn>
                <ModeBtn active={startMode === 'search'} onClick={() => setStartMode('search')}><Icon name="search" size={14} /> 직접 검색</ModeBtn>
              </div>
              {startMode === 'current' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 11, padding: '11px 13px' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: currentLocation ? 'var(--safe)' : 'var(--warning)', flexShrink: 0 }} />
                  {currentLocation ? (
                    <>
                      {/* minWidth:0 — 주소가 길어도 '수정' 버튼을 밀어내지 않게. */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: 'var(--safe)', fontSize: 13, fontWeight: 600 }}>현재 위치 확인됨</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginTop: 2 }}>
                          {startAddress || `${currentLocation.lat.toFixed(4)} · ${currentLocation.lng.toFixed(4)}`}
                        </div>
                      </div>
                      <button
                        onClick={handleEditStart}
                        title="출발지 직접 지정"
                        style={{
                          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, height: 30, padding: '0 10px',
                          border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface)',
                          color: 'var(--blue-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        <Icon name="edit" size={13} /> 수정
                      </button>
                    </>
                  ) : <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>현재 위치를 가져오는 중...</div>}
                </div>
              )}
              {startMode === 'search' && (
                <div>
                  <input style={inputStyle} placeholder="출발지 검색..." value={startSearch} onChange={e => { setStartSearch(e.target.value); searchPlace(e.target.value, setStartResult) }} />
                  {startResult.length > 0 && <ResultList list={startResult} onPick={handleSelectStart} color={START_COLOR} />}
                </div>
              )}
            </Card>

            {/* 도착지 */}
            <Card title="② 도착지">
              <div style={{ display: 'flex', marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
                <TabBtn active={destMode === 'recent'} onClick={() => setDestMode('recent')}><Icon name="clock" size={14} /> 최근</TabBtn>
                <TabBtn active={destMode === 'search'} onClick={() => setDestMode('search')}><Icon name="search" size={14} /> 검색</TabBtn>
              </div>
              {destMode === 'recent' && (
                recentRoutes.length > 0 ? (
                  <>
                    {recentRoutes.map(rh => (
                      <div key={rh.routeHistoryId} onClick={() => handleRecentRoute(rh)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', borderRadius: 10, cursor: 'pointer' }}>
                        <Icon name="clock" size={18} color="var(--text-muted)" />
                        {/* minWidth:0 — 긴 주소가 삭제(✕) 버튼을 밀어내지 않게. */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {recentLabels[rh.routeHistoryId] || rh.routeName}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtSearchedAt(rh.searchedAt)}</div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); handleRecentDelete(rh.routeHistoryId) }} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 0 }}><Icon name="x" size={16} /></button>
                      </div>
                    ))}
                    <button
                      onClick={handleRecentClear}
                      style={{
                        width: '100%', marginTop: 6, height: 34, borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit',
                        border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
                      }}
                    >전체 삭제</button>
                  </>
                ) : <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>최근 검색한 경로가 없습니다.</div>
              )}
              {destMode === 'search' && (
                <div>
                  <input style={inputStyle} placeholder="도착지 검색..." value={destSearch} onChange={e => { setDestSearch(e.target.value); searchPlace(e.target.value, setDestResult) }} />
                  {destResult.length > 0 && <ResultList list={destResult} onPick={handleSelectDest} color={DEST_COLOR} />}
                </div>
              )}
            </Card>

            {/* 북마크 — 출발/도착을 하나씩 고르는 단계가 아니라 저장해 둔 구간을 한 번에 불러오는
                지름길이라 번호 없이 별도 카드로 둔다. 누르면 ①②가 채워지고 ③ 추천 경로까지 나온다. */}
            <Card
              title={<><Icon name="star" size={15} color="var(--blue-primary)" /> 북마크</>}
              right={bookmarks.length > 0
                ? <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600 }}>
                    {bookmarkQuery.trim() ? `${visibleBookmarks.length} / ${bookmarks.length}` : `${bookmarks.length}개`}
                  </span>
                : null}
            >
              {bookmarks.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '18px 0', lineHeight: 1.6 }}>
                  저장된 북마크가 없습니다.
                  <div style={{ fontSize: 11.5, marginTop: 2 }}>경로를 찾은 뒤 ‘북마크 저장’을 눌러보세요.</div>
                </div>
              ) : (
                <>
                  <input
                    style={inputStyle}
                    placeholder="북마크 검색..."
                    value={bookmarkQuery}
                    onChange={e => setBookmarkQuery(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 6, margin: '6px 0 10px' }}>
                    <SortChip active={bookmarkSort === 'recent'} onClick={() => setBookmarkSort('recent')}>
                      <Icon name="clock" size={12} /> 최신순
                    </SortChip>
                    <SortChip active={bookmarkSort === 'name'} onClick={() => setBookmarkSort('name')}>
                      가나다순
                    </SortChip>
                  </div>
                  {visibleBookmarks.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '18px 0' }}>검색 결과가 없습니다.</div>
                  ) : visibleBookmarks.map(bm => {
                    const busy = bookmarkBusyId === bm.id
                    return (
                      <div
                        key={bm.id}
                        onClick={() => handleBookmarkRoute(bm)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', borderRadius: 10,
                          cursor: bookmarkBusyId != null ? 'progress' : 'pointer',
                          background: busy ? 'var(--blue-tint)' : 'transparent',
                          opacity: bookmarkBusyId != null && !busy ? 0.5 : 1,
                        }}
                      >
                        <Icon name="star" size={18} color="var(--blue-primary)" />
                        {/* minWidth:0 — 긴 경로 이름이 삭제(✕) 버튼을 밀어내지 않게. */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bm.routeName}</div>
                          {/* 북마크 응답에는 safetyScore 합계만 있고 CCTV/편의점 내역은 없다. */}
                          <div style={{ fontSize: 11, color: busy ? 'var(--blue-primary)' : 'var(--text-muted)' }}>
                            {busy ? '경로를 불러오는 중…' : `안전 점수 ${bm.safetyScore}점 · 눌러서 경로 보기`}
                          </div>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); handleBookmarkDelete(bm.id) }}
                          disabled={bookmarkBusyId != null}
                          aria-label="북마크 삭제"
                          style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 0, flexShrink: 0 }}
                        ><Icon name="x" size={16} /></button>
                      </div>
                    )
                  })}
                </>
              )}
            </Card>

            {!isSearched && (
              <button onClick={handleSearchRoute} disabled={loading} style={{ width: '100%', height: 48, border: 'none', borderRadius: 12, background: 'var(--blue-primary)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .7 : 1, boxShadow: '0 6px 16px rgba(37,99,235,.28)', fontFamily: 'inherit' }}>
                {loading ? '경로 탐색 중...' : <><Icon name="search" size={16} /> 안전 경로 찾기</>}
              </button>
            )}

            {isSearched && (
              <Card title="③ 추천 경로">
                {routes.map((route, idx) => {
                  const on = selectedRoute?.routeId === route.routeId
                  return (
                    <div key={route.routeId} onClick={() => { setSelectedRoute(route); drawRoute(route) }} style={{
                      borderRadius: 12, padding: 13, marginBottom: 8, cursor: 'pointer',
                      border: `1px solid ${on ? 'var(--blue-primary)' : 'var(--border)'}`, background: on ? 'var(--blue-tint)' : 'var(--bg)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>경로 {idx + 1}</span>
                        {idx === 0 && <span style={{ background: 'var(--blue-primary)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6 }}>추천</span>}
                        <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(route.safetyScore) }}>안전 점수 {route.safetyScore}점</span>
                      </div>
                      <div style={{ width: '100%', height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                        <div style={{ height: 5, borderRadius: 3, background: scoreColor(route.safetyScore), width: `${barRatio(route.safetyScore)}%`, transition: 'width .4s' }} />
                      </div>
                      {/* 점수의 내역을 같이 보여준다 — 합계만 보면 무엇이 많아서 높은지 알 수 없다.
                          넷이 한 줄에 안 들어가면 접는다(flexWrap) — 보안등 수는 네 자리까지 가고
                          모바일 시트는 데스크탑 패널(360)보다 좁아질 수 있다. */}
                      {facilityDetail(route) && (
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 10, rowGap: 3, fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: LAYER_COLOR.cctv }} />CCTV {facilityCounts(route).cctv ?? 0}
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: LAYER_COLOR.streetLamp }} />가로등 {facilityCounts(route).streetLamp ?? 0}
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: LAYER_COLOR.store }} />편의점 {facilityCounts(route).store ?? 0}
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: LAYER_COLOR.police }} />치안시설 {facilityCounts(route).police ?? 0}
                          </span>
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{route.description}</div>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  <button onClick={() => { if (selectedRoute) startGuidance(selectedRoute, selectedStart, selectedDest) }}
                    style={{ width: '100%', height: 44, border: 'none', borderRadius: 11, background: 'var(--blue-primary)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}><Icon name="play" size={15} /> 지도에서 경로 보기</button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={handleBookmarkSave} style={{ flex: 1, height: 42, border: '1px solid var(--blue-primary)', borderRadius: 11, background: 'var(--surface)', color: 'var(--blue-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><Icon name="star" size={15} /> 북마크 저장</button>
                    <button onClick={() => { setIsSearched(false); setRoutes([]); setSelectedRoute(null); clearPolylines(); setSelectedDest(null); setStartSearch(''); setDestSearch(''); setStartMode('current')
                        // 이미 'current' 모드면 위치조회 effect가 다시 돌지 않으므로, 알고 있는 현재 위치를 직접 되살린다.
                        setSelectedStart(currentLocation ? { ...currentLocation, name: startAddress || '현재 위치' } : null) }}
                      style={{ flex: 1, height: 42, border: '1px solid var(--border)', borderRadius: 11, background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><Icon name="refresh" size={15} /> 다시 검색</button>
                  </div>
                </div>
              </Card>
            )}
          </div>
          </div>
        </div>

        {/* 지도 */}
        <div style={isMobile ? { position: 'absolute', inset: 0 } : { flex: 1, position: 'relative' }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

          {/* 좌측 패널 열기/닫기 핸들 (모바일은 시트의 드래그 핸들이 대신한다) */}
          <button
            onClick={() => setPanelOpen(o => !o)}
            title={panelOpen ? '패널 닫기' : '경로 안내 열기'}
            style={{
              position: 'absolute', top: 16, left: 0, zIndex: 11,
              width: 30, height: 46, padding: 0, cursor: 'pointer',
              display: isMobile ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: 'none',
              borderRadius: '0 10px 10px 0', color: 'var(--text-muted)', boxShadow: '2px 0 8px rgba(15,23,42,.06)',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: panelOpen ? 'rotate(180deg)' : 'none' }}>
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>

          {/* 상단 검색에서 고른 장소 → 출발/도착 선택 팝업 */}
          {pendingPlace && (
            <div style={{
              position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 20,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
              padding: 16, minWidth: 260, boxShadow: 'var(--shadow)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <Icon name="map-pin" size={16} color="var(--blue-primary)" style={{ marginTop: 1 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-.2px' }}>{pendingPlace.name}</div>
                  {pendingPlace.address && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{pendingPlace.address}</div>}
                </div>
                <button onClick={() => setPendingPlace(null)} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1, display: 'flex', padding: 0 }}><Icon name="x" size={17} /></button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={applyPendingAsStart} style={{ flex: 1, height: 40, border: 'none', borderRadius: 10, background: START_COLOR, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>출발지로 설정</button>
                <button onClick={applyPendingAsDest} style={{ flex: 1, height: 40, border: 'none', borderRadius: 10, background: DEST_COLOR, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>도착지로 설정</button>
              </div>
            </div>
          )}

          {selectedRoute && (
            <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: isMobile ? 12 : 16, minWidth: isMobile ? 0 : 170, maxWidth: isMobile ? '58%' : 'none', boxShadow: 'var(--shadow)', display: isMobile && panelOpen ? 'none' : 'block' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>선택 경로 안전도</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 2, color: scoreColor(selectedRoute.safetyScore) }}>안전 점수 {selectedRoute.safetyScore}점</div>
              {facilityDetail(selectedRoute) && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{facilityDetail(selectedRoute)}</div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{selectedRoute.description}</div>
            </div>
          )}
          <div style={{ position: 'absolute', bottom: isMobile ? visibleOffset() + 16 : 20, right: isMobile ? 12 : 20, zIndex: 10, display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
            {['+', '−'].map((btn, i) => (
              <button key={btn} onClick={() => { if (!mapInstance.current) return; const level = mapInstance.current.getLevel(); mapInstance.current.setLevel(btn === '+' ? level - 1 : level + 1) }}
                style={{ width: 40, height: 40, border: 'none', borderBottom: i === 0 ? '1px solid var(--border)' : 'none', background: 'transparent', cursor: 'pointer', fontSize: 19, color: 'var(--text-strong)' }}>{btn}</button>
            ))}
          </div>
          <button onClick={() => { if (currentLocation) centerOnVisible(new window.kakao.maps.LatLng(currentLocation.lat, currentLocation.lng)) }}
            style={{ position: 'absolute', bottom: isMobile ? visibleOffset() + 104 : 108, right: isMobile ? 12 : 20, zIndex: 10, width: 40, height: 40, borderRadius: 11, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--blue-primary)', cursor: 'pointer', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>
    </UserShell>
  )
}

function Card({ title, right, children }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0 }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  )
}
// 북마크 정렬용 작은 칩. ModeBtn 보다 낮고 좁아 카드 안 보조 컨트롤로 쓴다.
function SortChip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 4, height: 28, padding: '0 10px',
      borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
      border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
      background: active ? 'var(--blue-tint)' : 'var(--bg)',
      color: active ? 'var(--blue-primary)' : 'var(--text-muted)',
      fontWeight: active ? 700 : 500,
    }}>{children}</button>
  )
}
function ModeBtn({ active, onClick, children }) {
  return <button onClick={onClick} style={{ flex: 1, height: 40, borderRadius: 10, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', border: `1px solid ${active ? 'transparent' : 'var(--border)'}`, background: active ? 'var(--blue-primary)' : 'var(--bg)', color: active ? '#fff' : 'var(--text-muted)', fontWeight: active ? 700 : 500 }}>{children}</button>
}
function TabBtn({ active, onClick, children }) {
  return <button onClick={onClick} style={{ flex: 1, padding: '9px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', color: active ? 'var(--blue-primary)' : 'var(--text-muted)', borderBottom: `2px solid ${active ? 'var(--blue-primary)' : 'transparent'}`, marginBottom: -1, fontWeight: active ? 700 : 500 }}>{children}</button>
}
function ResultList({ list, onPick, color }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginTop: 4 }}>
      {list.map((place, idx) => (
        <div key={idx} onClick={() => onPick(place)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
          <Icon name="map-pin" size={15} color={color} style={{ marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{place.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{place.address}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

const inputStyle = { width: '100%', height: 42, padding: '0 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--text-strong)', outline: 'none', fontFamily: 'inherit', marginBottom: 4 }
