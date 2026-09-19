// 지도 위 안전시설(CCTV·가로등)을 '지금 보이는 범위'만 받아온다.
//
// 예전에는 /cctvs 와 /security-lights 가 전건을 통째로 내려줬고 프론트가 그걸 들고 있다가
// 화면 범위로 걸러 그렸다. 백엔드가 서울 CSV 대신 전국 공공데이터를 쓰게 되면서
// CCTV 25만·보안등 184만 건이 되었고, 전건 응답은 각각 5.7MB / 80MB 라 그 방식은 못 쓴다.
// 이제 백엔드가 범위를 안 주면 400 을 돌려주므로 항상 범위를 함께 보낸다.

import { apiFetch } from './api'

// 백엔드 CctvService·SecurityLightService 의 MAX_BBOX_RANGE 와 같은 값. 이보다 넓게 요청하면 400 이다.
// (CCTV·가로등을 그리는 레벨 4 이하에서는 2560px 화면도 경도 0.06° 정도라 걸릴 일이 없다.)
export const MAX_SPAN_DEGREE = 0.1

// 여유분을 붙여 상한에 딱 맞춘 범위는 부동소수점 오차로 0.1 을 살짝 넘을 수 있다.
// 그러면 백엔드가 400 을 돌려주므로 여유분 계산에서만 조금 덜 채운다.
const PAD_LIMIT = MAX_SPAN_DEGREE * 0.99

// 받아 둘 범위를 화면보다 이만큼 넓게 잡는다. 조금 끌 때마다 다시 받지 않기 위한 여유분.
const PAD_RATIO = 0.5

export function kakaoBoundsToBox(bounds) {
  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()
  return {
    minLatitude: sw.getLat(),
    maxLatitude: ne.getLat(),
    minLongitude: sw.getLng(),
    maxLongitude: ne.getLng(),
  }
}

// 화면 범위를 여유분만큼 넓히되, 백엔드 상한을 넘지 않게 자른다.
function padBox(box) {
  const latSpan = box.maxLatitude - box.minLatitude
  const lngSpan = box.maxLongitude - box.minLongitude

  const latPad = Math.min(
    (latSpan * PAD_RATIO) / 2,
    Math.max(0, (PAD_LIMIT - latSpan) / 2),
  )
  const lngPad = Math.min(
    (lngSpan * PAD_RATIO) / 2,
    Math.max(0, (PAD_LIMIT - lngSpan) / 2),
  )

  return {
    minLatitude: box.minLatitude - latPad,
    maxLatitude: box.maxLatitude + latPad,
    minLongitude: box.minLongitude - lngPad,
    maxLongitude: box.maxLongitude + lngPad,
  }
}

function contains(outer, inner) {
  return (
    outer.minLatitude <= inner.minLatitude &&
    outer.maxLatitude >= inner.maxLatitude &&
    outer.minLongitude <= inner.minLongitude &&
    outer.maxLongitude >= inner.maxLongitude
  )
}

// 범위가 백엔드 상한을 넘으면 요청 자체를 하지 않는다. 어차피 400 이고,
// 그 축척에서는 점을 그리지도 않는다.
export function isTooWide(box) {
  return (
    box.maxLatitude - box.minLatitude > MAX_SPAN_DEGREE ||
    box.maxLongitude - box.minLongitude > MAX_SPAN_DEGREE
  )
}

// 백엔드 파라미터 이름은 minLat/maxLat/minLng/maxLng 다. 예전 이름(minLatitude…)으로 보내면
// 백엔드가 범위 없음으로 보고 400 을 돌려준다.
function toQuery(box) {
  return new URLSearchParams({
    minLat: box.minLatitude,
    maxLat: box.maxLatitude,
    minLng: box.minLongitude,
    maxLng: box.maxLongitude,
  }).toString()
}

/**
 * 한 레이어의 '범위별 조회 + 캐시'를 만든다.
 *
 * - 이미 받아 둔 범위 안이면 다시 부르지 않는다(지도를 조금 끌 때 매번 요청하지 않도록).
 * - 늦게 도착한 이전 응답은 버린다. 빠르게 패닝하면 순서가 뒤집혀 옛 결과가 남는다.
 * - 실패는 빈 배열로 뭉뚱그리지 않고 예외로 알린다. 호출부가 '아직 못 받음'과
 *   '이 지역에 없음'을 구분해야 하기 때문이다.
 *
 * @param {string} path      '/cctvs' 또는 '/security-lights'
 * @param {(item:object)=>object} mapItem 응답 한 건을 화면용 모양으로
 */
export function createFacilityLoader(path, mapItem) {
  let cache = null // { box, data }
  let seq = 0

  return async function load(box) {
    if (cache && contains(cache.box, box)) return cache.data

    const target = padBox(box)
    const mySeq = ++seq

    const json = await apiFetch(`${path}?${toQuery(target)}`)
    if (!json.success || !json.data) {
      throw new Error(json.message || '조회에 실패했습니다')
    }

    const data = json.data.map(mapItem)

    // 내가 보낸 요청보다 나중 요청이 이미 나갔으면 이 결과는 버린다.
    if (mySeq !== seq) return cache ? cache.data : data

    cache = { box: target, data }
    return data
  }
}
