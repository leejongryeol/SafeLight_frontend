import { useEffect, useRef, useCallback, useState } from 'react'
import useIsMobile from '../../hooks/useIsMobile'
import Icon from '../Icon'
import { iconSvg } from '../iconSvg'
import { LAYER_COLOR, FACILITY_MAX_LEVEL, lampMaxLevel, POLICE_Z, MY_LOCATION_Z, ROUTE_ENDPOINT_Z, SEARCH_PIN_Z, dotContent } from './layerStyle'
import { createFacilityLoader } from '../../utils/facilityApi'
import { renderFacilityDots } from './facilityLayer'
import { collectStores } from './storeSearch'

// CCTV·가로등은 '지금 보이는 범위'만 받는다. 백엔드가 서울 CSV 대신 전국 공공데이터를
// 쓰게 되면서 각각 25만·184만 건이 되어 전체 조회 자체가 없어졌다(범위를 안 보내면 400).
// 캐시·중복요청 처리는 facilityApi 안에 있다.
const loadCctv = createFacilityLoader('/cctvs', item => ({
  lat: item.latitude,
  lng: item.longitude,
  name: item.cctvName,
}))

// 가로등은 좌표만 온다(LocationDto).
const loadLamps = createFacilityLoader('/security-lights', item => ({
  lat: item.latitude,
  lng: item.longitude,
}))

// 치안시설(지구대·파출소 등). CCTV·가로등과 같은 범위 규칙(minLat… 필수, 0.1도 상한)이다.
const loadPolice = createFacilityLoader('/police-facilities', item => ({
  lat: item.latitude,
  lng: item.longitude,
  name: item.name,
}))

export default function MapView({ filters, onToggleFilter, dangerZones = [], routeState = null, onCancelRoute, searchTarget = null }) {
  // 모바일에서는 레이어 칩을 데스크탑의 3/4 크기로 줄인다(34 → 26px).
  const isMobile = useIsMobile()
  const CHIP_H = isMobile ? 26 : 34
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const cctvOverlaysRef = useRef([])
  const cctvReqRef = useRef(0)           // 늦게 도착한 이전 조회 결과를 버리기 위한 순번
  const lampOverlaysRef = useRef([])
  const lampReqRef = useRef(0)
  const storeOverlaysRef = useRef([])
  const storeReqRef = useRef(0)
  const policeOverlaysRef = useRef([])
  const policeReqRef = useRef(0)
  const [cctvNotice, setCctvNotice] = useState('')
  const [lampNotice, setLampNotice] = useState('')
  const [storeNotice, setStoreNotice] = useState('')
  const [policeNotice, setPoliceNotice] = useState('')
  // 예전에는 '가로등 목록을 받아왔는지'(lampReady)로 칩을 잠갔다. 전용 엔드포인트가
  // 아직 없던 시절, 눌러도 아무 일이 없는 칩을 감추기 위한 장치였다.
  // 지금은 엔드포인트가 있고 화면을 옮길 때마다 조회하므로, 한 번 실패했다고 칩을 잠그면
  // 다시 시도할 방법까지 막힌다. 대신 실패는 실패라고 문구로 알린다 —
  // '이 지역에는 가로등이 없습니다' 로 뭉뚱그리지 않는 것이 원래 목적이었다.
  const locationMarkerRef = useRef(null)
  const dangerZoneOverlaysRef = useRef([])
  const routePolylinesRef = useRef([])
  const routeMarkersRef = useRef([])
  const searchMarkerRef = useRef(null)
  const searchTargetRef = useRef(searchTarget) // 초기 지오로케이션이 검색 위치를 덮어쓰지 않도록 추적

  // 지도 인스턴스가 준비됐는지. 카카오 SDK 가 늦게 뜨면 initMap 이 setInterval 로 미뤄지는데,
  // 그 사이 경로·위험구역·검색 위치 effect 가 먼저 돌면서 mapInstance 가 없어 조용히 빠져나가
  // 다시 그릴 계기가 영영 없었다. 준비되면 이 값이 바뀌면서 해당 effect 들이 다시 돈다.
  const [mapReady, setMapReady] = useState(false)

  // 경로 안내 중에는 초기 위치 조회 결과로 지도를 되돌리면 안 된다 —
  // 안내를 시작하면 출발·도착이 잠깐 보였다가 내 위치로 튕겨 나갔다.
  const routeStateRef = useRef(routeState)
  routeStateRef.current = routeState

  // 지도 'idle' 리스너는 초기화 때 한 번만 등록되므로 filters 를 클로저로 잡으면 첫 값에 영원히 묶인다.
  // (그래서 CCTV 를 꺼도 지도를 움직이는 순간 마커가 되살아났다.) 항상 최신 값을 ref 로 읽는다.
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  // 뷰포트 내 CCTV 점. 필터가 꺼져 있으면 지우기만 한다 —
  // 켬/끔 판단을 renderFacilityDots 안에 모아둬야 호출부마다 조건을 빠뜨리지 않는다.
  const renderCctvInBounds = useCallback(() => renderFacilityDots({
    map: mapInstance.current,
    overlaysRef: cctvOverlaysRef, seqRef: cctvReqRef,
    load: loadCctv, maxLevel: FACILITY_MAX_LEVEL,
    dot: dotContent(LAYER_COLOR.cctv), zIndex: 2,
    enabled: filtersRef.current?.cctv,
    setNotice: setCctvNotice, label: 'CCTV',
    notice: {
      zoomOut: '지도를 확대하면 주변 CCTV가 표시됩니다',
      fail: 'CCTV 정보를 불러오지 못했습니다',
      empty: '이 지역에는 CCTV가 없습니다',
      count: n => `CCTV ${n}대`,
    },
  }), [])

  // 가로등은 CCTV 와 같은 처리인데 상한 레벨만 다르다 — 개수가 7배라 같은 레벨에서 그리면
  // 지도가 멎는다(layerStyle.js 의 실측 표). 데스크탑은 화면이 넓어 3배쯤 더 깔리므로 한 단계 더 조인다.
  // zIndex 1 = CCTV(2)·편의점(3)보다 아래. 제일 많아서 위에 얹으면 몇 안 되는 CCTV 점을 덮는다.
  const renderLampsInBounds = useCallback(() => renderFacilityDots({
    map: mapInstance.current,
    overlaysRef: lampOverlaysRef, seqRef: lampReqRef,
    load: loadLamps, maxLevel: lampMaxLevel(isMobile),
    dot: dotContent(LAYER_COLOR.streetLamp), zIndex: 1,
    enabled: filtersRef.current?.streetLamp,
    setNotice: setLampNotice, label: '가로등',
    notice: {
      zoomOut: '지도를 확대하면 주변 가로등이 표시됩니다',
      fail: '가로등 정보를 불러오지 못했습니다',
      empty: '이 지역에는 가로등이 없습니다',
      count: n => `가로등 ${n}개`,
    },
  }), [isMobile])

  // 치안시설은 동네에 몇 곳뿐이라 개수 부담이 없다. 그래서 제일 위(zIndex 4)에 얹는다 —
  // 수백 개의 가로등·CCTV 점 밑에 묻히면 정작 찾아가야 할 곳이 안 보인다.
  const renderPoliceInBounds = useCallback(() => renderFacilityDots({
    map: mapInstance.current,
    overlaysRef: policeOverlaysRef, seqRef: policeReqRef,
    load: loadPolice, maxLevel: FACILITY_MAX_LEVEL,
    dot: dotContent(LAYER_COLOR.police), zIndex: POLICE_Z,
    enabled: filtersRef.current?.police,
    setNotice: setPoliceNotice, label: '치안시설',
    notice: {
      zoomOut: '지도를 확대하면 주변 치안시설이 표시됩니다',
      fail: '치안시설 정보를 불러오지 못했습니다',
      empty: '이 지역에는 치안시설이 없습니다',
      count: n => `치안시설 ${n}곳`,
    },
  }), [])

  const clearStores = useCallback(() => {
    storeOverlaysRef.current.forEach(o => o.setMap(null))
    storeOverlaysRef.current = []
  }, [])

  // 편의점(안전거점) 마커 — 지도 영역이 바뀔 때마다 다시 조회한다.
  const renderStoresInBounds = useCallback(() => {
    const map = mapInstance.current
    if (!map || !window.kakao?.maps?.services) return

    // 이 시점 이후 도착하는 이전 요청의 콜백은 무시된다
    const reqId = ++storeReqRef.current
    clearStores()

    if (!filtersRef.current?.store) { setStoreNotice(''); return }
    if (map.getLevel() > FACILITY_MAX_LEVEL) {
      setStoreNotice('지도를 확대하면 주변 편의점이 표시됩니다')
      return
    }

    // 예전에는 많이 확대하면 상호가 붙은 알약을 띄웠다. 알약 하나가 100px 가까이 돼서
    // 지도의 상호·도로명을 덮었고, 편의점이 몰린 곳에서는 알약끼리 겹쳐 오히려 못 읽었다.
    // CCTV·가로등과 같은 점으로 통일한다 — 상호는 지도가 이미 제 글씨로 보여준다.
    collectStores(map.getBounds()).then(({ places, capped, failed }) => {
      if (reqId !== storeReqRef.current) return
      if (failed) { setStoreNotice('편의점 정보를 불러오지 못했습니다'); return }

      places.forEach(place => {
        const overlay = new window.kakao.maps.CustomOverlay({
          position: new window.kakao.maps.LatLng(Number(place.y), Number(place.x)),
          content: dotContent(LAYER_COLOR.store), yAnchor: 0.5, xAnchor: 0.5, zIndex: 3,
        })
        overlay.setMap(map)
        storeOverlaysRef.current.push(overlay)
      })

      // 끝까지 쪼개고도 넘쳤다면 그 사실을 숨기지 않는다 — 실제로는 더 있다.
      setStoreNotice(
        places.length === 0 ? '이 지역에는 편의점이 없습니다'
          : capped ? `편의점 ${places.length}곳 이상 · 확대하면 더 정확합니다`
            : `편의점 ${places.length}곳`
      )
    })
  }, [clearStores])

  // 위험구역 그리기
  const drawDangerZones = useCallback((zones) => {
    if (!mapInstance.current || !window.kakao) return

    dangerZoneOverlaysRef.current.forEach(item => {
      item.circle?.setMap(null)
      item.overlay?.setMap(null)
    })
    dangerZoneOverlaysRef.current = []

    const LEVEL_COLOR = {
      HIGH:   { stroke: '#E11D48' },
      MEDIUM: { stroke: '#F59E0B' },
      LOW:    { stroke: '#10B981' },
    }

    zones.filter(z => z.isActive).forEach(zone => {
      const color = LEVEL_COLOR[zone.dangerLevel] ?? LEVEL_COLOR.LOW
      const center = new window.kakao.maps.LatLng(
        zone.centerLatitude, zone.centerLongitude
      )

      const circle = new window.kakao.maps.Circle({
        center,
        radius: zone.radius,
        strokeWeight: 2,
        strokeColor: color.stroke,
        strokeOpacity: 0.9,
        strokeStyle: 'solid',
        fillColor: color.stroke,
        fillOpacity: 0.15,
      })
      circle.setMap(mapInstance.current)

      const content = `
        <div style="
          background:${color.stroke};color:#fff;
          padding:3px 8px;border-radius:6px;
          font-size:11px;font-weight:700;
          box-shadow:0 2px 6px rgba(0,0,0,0.3);
          white-space:nowrap;
        ">${iconSvg('alert-triangle', { size: 12, color: '#fff' })} ${zone.dangerLevel}</div>
      `
      const overlay = new window.kakao.maps.CustomOverlay({
        position: center, content, yAnchor: 1.5,
      })
      overlay.setMap(mapInstance.current)

      dangerZoneOverlaysRef.current.push({ circle, overlay })
    })
  }, [])

  // 경로 그리기
  const drawRouteOnMap = useCallback((routePath, start, dest) => {
    if (!mapInstance.current || !window.kakao || !routePath) return

    routePolylinesRef.current.forEach(p => p.setMap(null))
    routePolylinesRef.current = []
    routeMarkersRef.current.forEach(m => m.setMap(null))
    routeMarkersRef.current = []

    const linePath = routePath.map(point =>
      new window.kakao.maps.LatLng(point.latitude, point.longitude)
    )

    if (linePath.length === 0) return

    const polyline = new window.kakao.maps.Polyline({
      path: linePath,
      strokeWeight: 6,
      strokeColor: '#00E676',
      strokeOpacity: 0.85,
      strokeStyle: 'solid',
    })
    polyline.setMap(mapInstance.current)
    routePolylinesRef.current.push(polyline)

    if (start) {
      const startOverlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(start.lat, start.lng),
        content: `
          <div style="
            background:#00E676;border-radius:50%;
            width:36px;height:36px;
            display:flex;align-items:center;justify-content:center;
            color:#000;font-size:11px;font-weight:700;
            border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);
          ">출발</div>
        `,
        yAnchor: 1, zIndex: ROUTE_ENDPOINT_Z,
      })
      startOverlay.setMap(mapInstance.current)
      routeMarkersRef.current.push(startOverlay)
    }

    if (dest) {
      const destOverlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(dest.lat, dest.lng),
        content: `
          <div style="
            background:#FF3B3B;border-radius:50%;
            width:36px;height:36px;
            display:flex;align-items:center;justify-content:center;
            color:#fff;font-size:11px;font-weight:700;
            border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);
          ">도착</div>
        `,
        yAnchor: 1, zIndex: ROUTE_ENDPOINT_Z,
      })
      destOverlay.setMap(mapInstance.current)
      routeMarkersRef.current.push(destOverlay)
    }

    const bounds = new window.kakao.maps.LatLngBounds()
    linePath.forEach(latlng => bounds.extend(latlng))
    // 모바일은 아래쪽을 '내 주변 안전 현황' 시트가 덮는다. 그만큼 여백을 주지 않으면
    // 도착 마커가 시트 뒤로 숨는다(경로 화면은 이미 같은 보정을 하고 있다).
    // --ls-sheet-peek 은 셸 요소에 걸려 있어 documentElement 가 아니라 지도 컨테이너에서 읽는다.
    const peek = mapRef.current
      ? parseInt(getComputedStyle(mapRef.current).getPropertyValue('--ls-sheet-peek'), 10) || 0
      : 0
    mapInstance.current.setBounds(bounds, 32, 24, 32 + peek, 24)
  }, [])

  // 지도 초기화
  useEffect(() => {
    const initMap = () => {
      if (!window.kakao || !window.kakao.maps) return

      const container = mapRef.current
      const options = {
        center: new window.kakao.maps.LatLng(37.4979, 127.0276),
        // FACILITY_MAX_LEVEL 보다 넓게 시작하면 지도를 열자마자 아무 점도 안 보인다.
        level: FACILITY_MAX_LEVEL,
      }
      mapInstance.current = new window.kakao.maps.Map(container, options)

      // CCTV·가로등·편의점·치안시설 모두 아래 mapReady effect 가 곧바로 한 번 그린다.
      // 여기서 또 부르면 같은 범위를 두 번 조회한다.
      window.kakao.maps.event.addListener(mapInstance.current, 'idle', () => {
        renderCctvInBounds()
        renderLampsInBounds()
        renderStoresInBounds()
        renderPoliceInBounds()
      })

      setMapReady(true)

      navigator.geolocation?.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords
          const latlng = new window.kakao.maps.LatLng(latitude, longitude)
          // 위치 조회는 느리게 끝나므로, 그 사이 사용자가 보려던 화면을 덮어쓰지 않게 막는다.
          // - 검색으로 진입(다른 페이지에서 장소를 골라 넘어옴)
          // - 경로 안내 중(북마크·경로 화면에서 넘어옴) — 안 막으면 출발·도착이 잠깐 보였다가
          //   내 위치로 튕겨 나간다. 마커는 그대로 찍되 화면만 건드리지 않는다.
          const keepView = searchTargetRef.current || routeStateRef.current?.routePath?.length
          if (!keepView) {
            mapInstance.current.setCenter(latlng)
            mapInstance.current.setLevel(FACILITY_MAX_LEVEL)
          }

          const content = `
            <div style="position:relative;width:24px;height:24px;">
              <div style="
                position:absolute;top:50%;left:50%;
                transform:translate(-50%,-50%);
                width:24px;height:24px;border-radius:50%;
                background:rgba(66,133,244,0.2);
                animation:pulse 2s infinite;
              "></div>
              <div style="
                position:absolute;top:50%;left:50%;
                transform:translate(-50%,-50%);
                width:14px;height:14px;border-radius:50%;
                background:#4285F4;border:2px solid #fff;
                box-shadow:0 2px 6px rgba(0,0,0,0.3);
              "></div>
              <style>
                @keyframes pulse {
                  0% { transform:translate(-50%,-50%) scale(1); opacity:1; }
                  100% { transform:translate(-50%,-50%) scale(2.5); opacity:0; }
                }
              </style>
            </div>
          `
          const locationOverlay = new window.kakao.maps.CustomOverlay({
            // zIndex 를 안 주면 0 이라 시설 점(가로등 1 · CCTV 2 · 편의점 3) 아래로 묻힌다.
            position: latlng, content, yAnchor: 0.5, xAnchor: 0.5, zIndex: MY_LOCATION_Z,
          })
          locationOverlay.setMap(mapInstance.current)
          locationMarkerRef.current = locationOverlay
        },
        (error) => console.log('위치 권한 없음:', error),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      )
    }

    if (window.kakao && window.kakao.maps) {
      initMap()
    } else {
      const check = setInterval(() => {
        if (window.kakao && window.kakao.maps) {
          clearInterval(check)
          initMap()
        }
      }, 300)
      return () => clearInterval(check)
    }
  }, [renderCctvInBounds, renderLampsInBounds, renderStoresInBounds, renderPoliceInBounds])

  // 필터 변경 시 (각 render 함수가 켬/끔을 알아서 처리한다)
  useEffect(() => {
    renderCctvInBounds()
    renderLampsInBounds()
    renderStoresInBounds()
    renderPoliceInBounds()
  }, [mapReady, filters, renderCctvInBounds, renderLampsInBounds, renderStoresInBounds, renderPoliceInBounds])

  // 위험구역 변경 시
  useEffect(() => {
    if (!mapReady) return
    drawDangerZones(dangerZones)
  }, [mapReady, dangerZones, drawDangerZones])

  // 경로 안내에서 넘어온 경우. 안내가 취소되면(routeState === null) 그려둔 선과 마커를 지운다.
  useEffect(() => {
    if (!mapReady) return
    if (routeState?.routePath) {
      drawRouteOnMap(routeState.routePath, routeState.start, routeState.dest)
      return
    }
    routePolylinesRef.current.forEach(p => p.setMap(null))
    routePolylinesRef.current = []
    routeMarkersRef.current.forEach(m => m.setMap(null))
    routeMarkersRef.current = []
  }, [mapReady, routeState, drawRouteOnMap])

  // 컨테이너 크기 변화(우측 패널 접기/펼치기, 창 리사이즈) 시 지도 다시 그리기.
  // filters 를 의존성에 두면 칩을 누를 때마다 옵저버를 떼었다 붙이므로 ref 로 읽는다.
  useEffect(() => {
    if (!mapRef.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!mapInstance.current) return
      requestAnimationFrame(() => {
        mapInstance.current.relayout()
        renderCctvInBounds()
        renderLampsInBounds()
        renderPoliceInBounds()
      })
    })
    ro.observe(mapRef.current)
    return () => ro.disconnect()
  }, [renderCctvInBounds, renderLampsInBounds, renderPoliceInBounds])

  // 상단 장소 검색에서 선택한 위치로 이동 + 핀 표시
  useEffect(() => {
    searchTargetRef.current = searchTarget
    if (!searchTarget || !mapReady || !window.kakao) return
    const latlng = new window.kakao.maps.LatLng(searchTarget.lat, searchTarget.lng)
    mapInstance.current.setLevel(3)
    mapInstance.current.setCenter(latlng)

    searchMarkerRef.current?.setMap(null)
    const content = `
      <div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-4px);">
        <div style="background:#2563EB;color:#fff;padding:5px 11px;border-radius:16px;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 3px 10px rgba(37,99,235,0.4);">${iconSvg('map-pin', { size: 13, color: '#fff' })} ${searchTarget.name ?? '검색 위치'}</div>
        <div style="width:2px;height:9px;background:#2563EB;"></div>
      </div>
    `
    const overlay = new window.kakao.maps.CustomOverlay({ position: latlng, content, yAnchor: 1, zIndex: SEARCH_PIN_Z })
    overlay.setMap(mapInstance.current)
    searchMarkerRef.current = overlay
  }, [mapReady, searchTarget])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* 경로 안내 배너 — 모바일에서는 좌상단 레이어 칩과 같은 높이에 놓으면 겹치므로 칩 아래로 내린다 */}
      {routeState?.routeActive && (
        // 배너를 누르면 안내를 취소할 수 있다(데스크탑·모바일 동일). 안내 중 나갈 방법이 이것뿐이라
        // 눌러야 한다는 걸 알 수 있게 ✕ 를 함께 둔다.
        <button
          onClick={onCancelRoute}
          title="경로 안내 취소"
          aria-label="경로 안내 취소"
          style={{
            position: 'absolute', top: isMobile ? 16 + CHIP_H + 10 : 16, left: '50%',
            transform: 'translateX(-50%)', zIndex: 10,
            display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 8,
            background: 'var(--blue-primary)', border: 'none', cursor: 'pointer',
            borderRadius: '20px', padding: isMobile ? '6px 11px 6px 13px' : '8px 14px 8px 18px',
            color: '#fff', fontSize: isMobile ? 11.5 : 13, fontWeight: 700, fontFamily: 'inherit',
            boxShadow: 'var(--shadow)', whiteSpace: 'nowrap',
          }}
        >
          <Icon name="compass" size={isMobile ? 13 : 15} />
          {/* safetyScore 는 개수가 아니라 가중 점수다 — CCTV×3 + 편의점×3 + 보안등×1 + 치안시설×4
              (RouteService.calculateWeightedSafetyScore). '곳'이라고 적으면 시설 수로 오해한다. */}
          <span>경로 안내 중 · 안전 점수 {routeState.safetyScore}점</span>
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: isMobile ? 17 : 19, height: isMobile ? 17 : 19, borderRadius: '50%',
            background: 'rgba(255,255,255,.22)',
          }}>
            <Icon name="x" size={isMobile ? 11 : 12} strokeWidth={2.6} />
          </span>
        </button>
      )}

      {/* 레이어 칩 (좌상단) */}
      <div style={{ position: 'absolute', top: 16, left: isMobile ? 12 : 16, zIndex: 10, display: 'flex', gap: isMobile ? 6 : 8 }}>
        {[
          { key: 'cctv', icon: 'cctv', label: 'CCTV' },
          { key: 'streetLamp', icon: 'street-lamp', label: '가로등' },
          { key: 'store', icon: 'store', label: '편의점' },
          { key: 'police', icon: 'shield', label: '치안시설' },
        ].map(ly => {
          const on = !!filters?.[ly.key]
          return (
            <button
              key={ly.key}
              onClick={() => onToggleFilter?.(ly.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 6,
                height: CHIP_H, padding: isMobile ? '0 9px' : '0 13px',
                borderRadius: 20, fontSize: isMobile ? 11 : 12.5, fontWeight: 600,
                cursor: 'pointer',
                boxShadow: 'var(--shadow)', whiteSpace: 'nowrap',
                border: `1px solid ${on ? 'transparent' : 'var(--border)'}`,
                background: on ? 'var(--blue-primary)' : 'var(--surface)',
                color: on ? '#fff' : 'var(--text-muted)', fontFamily: 'inherit',
              }}
            >
              <Icon name={ly.icon} size={isMobile ? 13 : 15} /><span>{ly.label}</span>
            </button>
          )
        })}
      </div>

      {/* 레이어 안내 — 몇 곳을 찾았는지, 왜 안 보이는지(너무 넓게 봄), 결과가 잘렸는지 알린다.
          앞의 색 점이 지도 위 점 색과 같아서 어느 레이어 얘기인지 바로 읽힌다.
          모바일에서 경로 배너가 떠 있으면 그 아래로 내린다. */}
      {(cctvNotice || lampNotice || storeNotice || policeNotice) && (
        <div style={{
          position: 'absolute', zIndex: 10, left: isMobile ? 12 : 16,
          top: 16 + CHIP_H + (isMobile && routeState?.routeActive ? 46 : 8),
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
          gap: 5, pointerEvents: 'none',
        }}>
          {[[cctvNotice, LAYER_COLOR.cctv], [lampNotice, LAYER_COLOR.streetLamp], [storeNotice, LAYER_COLOR.store], [policeNotice, LAYER_COLOR.police]]
            .filter(([text]) => text)
            .map(([text, color]) => (
              <div key={color} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                height: isMobile ? 24 : 28, padding: isMobile ? '0 9px' : '0 12px',
                borderRadius: 20, background: 'var(--surface)', border: '1px solid var(--border)',
                boxShadow: 'var(--shadow)', fontSize: isMobile ? 10.5 : 12,
                fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                {text}
              </div>
            ))}
        </div>
      )}

      {/* 줌 컨트롤 (우하단) */}
      <div style={{
        position: 'absolute', bottom: 'calc(20px + var(--ls-sheet-peek, 0px))', right: 20, zIndex: 10, display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, overflow: 'hidden', boxShadow: 'var(--shadow)',
      }}>
        {['+', '−'].map((btn, i) => (
          <button
            key={btn}
            style={{
              width: 40, height: 40, border: 'none', borderBottom: i === 0 ? '1px solid var(--border)' : 'none',
              background: 'transparent', cursor: 'pointer', fontSize: 19, color: 'var(--text-strong)',
            }}
            onClick={() => {
              if (!mapInstance.current) return
              const level = mapInstance.current.getLevel()
              mapInstance.current.setLevel(btn === '+' ? level - 1 : level + 1)
            }}
          >
            {btn}
          </button>
        ))}
      </div>

      {/* 현재 위치 버튼 (줌 위) */}
      <button
        title="현재 위치로"
        style={{
          position: 'absolute', bottom: 'calc(108px + var(--ls-sheet-peek, 0px))', right: 20, zIndex: 10,
          width: 40, height: 40, borderRadius: 11,
          background: 'var(--surface)', border: '1px solid var(--border)',
          color: 'var(--blue-primary)', cursor: 'pointer', boxShadow: 'var(--shadow)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        onClick={() => {
          navigator.geolocation?.getCurrentPosition(pos => {
            if (!mapInstance.current) return
            const latlng = new window.kakao.maps.LatLng(
              pos.coords.latitude, pos.coords.longitude
            )
            mapInstance.current.setCenter(latlng)
          })
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" /></svg>
      </button>
    </div>
  )
}