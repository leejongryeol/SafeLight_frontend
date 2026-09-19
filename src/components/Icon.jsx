// 공용 아이콘 — 프로젝트 전반의 이모지를 대체한다.
// 모든 아이콘은 24×24 뷰박스의 라인 아이콘(Lucide 계열)이며 stroke="currentColor" 라서
// 주변 텍스트 색(파랑·흰·회색)을 그대로 상속한다. 데스크탑·모바일 렌더가 완전히 동일하다.
// 사용: <Icon name="map-pin" size={16} />  또는  색 지정 <Icon name="siren" size={24} color="#2563EB" />

const PATHS = {
  'alert-triangle': <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  'map-pin': <><path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  'compass': <><circle cx="12" cy="12" r="10" /><polygon points="16.2 7.8 14.1 14.1 7.8 16.2 9.9 9.9" /></>,
  // 사진 첨부용 일반 카메라. 지도의 CCTV 는 아래 'cctv'(벽걸이 감시카메라)를 쓴다.
  'camera': <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3.2" /></>,
  // 벽걸이 감시카메라 — 기울어진 본체 + 앞쪽 렌즈 후드 + 벽 브래킷.
  'cctv': <><path d="M3.2 9.6 15.4 4.2 17.6 9.2 5.4 14.6Z" /><path d="M15.4 4.2 18.4 2.9 20.6 7.9 17.6 9.2" /><path d="M3.6 14.8v6.4" /><path d="M3.6 18h4c.9 0 1.6-.7 1.6-1.6v-3.5" /></>,
  // 가로등 — 뾰족 지붕 + 처마 + 등피(사다리꼴), 가운데 세로선이 유리 칸막이 겸 기둥.
  'street-lamp': <><path d="M12 2 7 7.2h10z" /><path d="M5.4 7.2h13.2" /><path d="M8 7.2 8.9 17.6h6.2L16 7.2" /><path d="M12 7.2v14.6" /></>,
  // 편의점 — 차양(아래쪽 물결) + 양쪽 벽 + 출입구.
  'store': <><path d="M6 4h12l3.5 5q-1.9 2.4-3.8 0q-1.9 2.4-3.8 0q-1.9 2.4-3.8 0q-1.9 2.4-3.8 0q-1.9 2.4-3.8 0L6 4z" /><path d="M4.6 10.6V20" /><path d="M19.4 10.6V20" /><path d="M9.4 20v-5.6h5.2V20" /></>,
  'volume': <><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" /></>,
  'eye': <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
  'heart': <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z" />,
  'message': <path d="M21 11.5a8 8 0 0 1-8.5 7.9L4 21l1.6-4.2A8 8 0 1 1 21 11.5z" />,
  'flame': <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
  'bar-chart': <><path d="M3 3v18h18" /><path d="M8 17v-5" /><path d="M13 17V7" /><path d="M18 17v-8" /></>,
  'paperclip': <path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />,
  'file': <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  'link': <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  'x': <><path d="M18 6 6 18" /><path d="M6 6l12 12" /></>,
  'search': <><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></>,
  'star': <path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8l-6.2 3.2L7 14.1l-5-4.9 6.9-1z" />,
  'refresh': <><path d="M3 12a9 9 0 0 1 9-9 9.8 9.8 0 0 1 6.7 2.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.8 9.8 0 0 1-6.7-2.7L3 16" /><path d="M3 21v-5h5" /></>,
  'user': <><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
  'ban': <><circle cx="12" cy="12" r="9.5" /><path d="M5.3 5.3l13.4 13.4" /></>,
  'siren': <><path d="M7 18v-6a5 5 0 0 1 10 0v6" /><path d="M4 21h16" /><path d="M12 2v1.5" /><path d="M21 12h-1.5" /><path d="M4.5 12H3" /><path d="M18.4 5.6l-1 1" /><path d="M5.6 5.6l1 1" /></>,
  'shield': <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></>,
  'check-circle': <><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" /><path d="M22 4 12 14 9 11" /></>,
  'megaphone': <><path d="M3 11l18-5v12L3 14z" /><path d="M11.6 16.8A3 3 0 0 1 6 15.5" /></>,
  'inbox': <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z" /></>,
  'clock': <><circle cx="12" cy="12" r="9.5" /><path d="M12 7v5l3.5 2" /></>,
  'play': <path d="M7 5v14l11-7z" />,
  'edit': <><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /><path d="M18.4 2.6a2 2 0 0 1 2.8 2.8L12.5 14 9 15l1-3.5z" /></>,
}

export default function Icon({ name, size = 18, color = 'currentColor', strokeWidth = 1.9, style, ...rest }) {
  const glyph = PATHS[name]
  if (!glyph) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // 텍스트와 나란히 놓일 때 세로 정렬을 맞춘다(대부분 인라인 사용).
      style={{ display: 'inline-block', verticalAlign: '-0.15em', flexShrink: 0, ...style }}
      {...rest}
    >
      {glyph}
    </svg>
  )
}
