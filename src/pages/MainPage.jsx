import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import UserShell from '../components/layout/UserShell'
import MapView from '../components/Map/MapView'
import RightPanel from '../components/RightPanel/RightPanel'
import SosButton from '../components/SosButton/SosButton'
import { useSafetyData } from '../hooks/useSafetyData'
import ConfirmDialog from '../components/layout/ConfirmDialog'
import { loadActiveRoute, clearActiveRoute } from '../utils/activeRoute'

export default function MainPage({ user, onLogout }) {
  const location = useLocation()
  const { dangerZones, isLoading, refresh } = useSafetyData()
  // 넷 다 켜둔다 — 칩이 켜져 있어야 무엇을 보고 있는지 읽힌다.
  // (기본 레벨 4에서는 가로등이 LAMP_MAX_LEVEL 밖이라 '확대하면 표시됩니다' 안내만 뜬다.)
  const [filters, setFilters] = useState({ cctv: true, streetLamp: true, store: true, police: true })

  // 상단 검색(모든 페이지 공용) 또는 다른 페이지에서 넘어온 장소로 지도 이동
  const [mapTarget, setMapTarget] = useState(null)
  useEffect(() => {
    const p = location.state?.searchPlace
    if (p) setMapTarget({ lat: p.lat, lng: p.lng, name: p.name })
  }, [location.state])

  // 안내 중인 경로 — 세션에서 복원한다. navigate state 로만 받으면 다른 화면에 갔다 오는 순간
  // 사라지므로, 사용자가 직접 취소할 때까지 유지되도록 세션에 보관한 값을 읽는다.
  const [routeState, setRouteState] = useState(loadActiveRoute)
  const [askCancelRoute, setAskCancelRoute] = useState(false)

  const confirmCancelRoute = () => {
    clearActiveRoute()
    setRouteState(null)
    setAskCancelRoute(false)
  }

  return (
    <UserShell
      user={user}
      onLogout={onLogout}
      active="map"
      scroll={false}
      contentBg="var(--map-bg)"
      rightDrawer={<RightPanel dangerZones={dangerZones} isLoading={isLoading} />}
    >
      <MapView
        filters={filters}
        onToggleFilter={key => setFilters(prev => ({ ...prev, [key]: !prev[key] }))}
        dangerZones={dangerZones}
        routeState={routeState}
        onCancelRoute={() => setAskCancelRoute(true)}
        searchTarget={mapTarget}
      />
      {/* 접수 직후 위험구역을 다시 읽는다 — 내가 만든 구역이 30초 뒤에 나타나면 안 된다. */}
      <SosButton user={user} onReported={refresh} />

      <ConfirmDialog
        open={askCancelRoute}
        title="경로 안내를 취소하겠습니까?"
        message="지도에 표시된 안전 경로가 사라집니다."
        confirmLabel="안내 취소"
        cancelLabel="계속 안내"
        onConfirm={confirmCancelRoute}
        onCancel={() => setAskCancelRoute(false)}
      />
    </UserShell>
  )
}
