import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 기본값은 IPv6 루프백([::1])만 열어 adb reverse(IPv4 127.0.0.1)가 닿지 못한다.
    host: '127.0.0.1',
    proxy: {
      '/users': 'http://localhost:8080',
      '/friends': 'http://localhost:8080',
      '/messages': 'http://localhost:8080',
      '/posts': 'http://localhost:8080',
      '/cctvs': 'http://localhost:8080',
      '/security-lights': 'http://localhost:8080',
      '/police-facilities': 'http://localhost:8080',
      '/danger-zones': 'http://localhost:8080',
      '/emergency-reports': 'http://localhost:8080',
      '/routes': 'http://localhost:8080',
      '/bookmarks': 'http://localhost:8080',
      '/notifications': 'http://localhost:8080',
      '/recent-routes': 'http://localhost:8080',

      // /admin 은 통째로 넘기면 안 된다. 관리자 화면 라우트(/admin, /admin/users 등)가
      // 같은 주소를 쓰기 때문에 프록시가 가로채면 SPA 진입이 막힌다. API 경로만 집어서 넘긴다.
      '/admin/dashboard': 'http://localhost:8080',
      '/admin/emergency-reports': 'http://localhost:8080',
      // 화면 라우트 /admin/users 와 겹치므로 상태 변경 API 모양일 때만 넘긴다.
      '^/admin/users/\\d+/status': 'http://localhost:8080',
    }
  }
})