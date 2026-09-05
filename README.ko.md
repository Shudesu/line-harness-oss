🌐 [日本語](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md) | **한국어** | [Español](README.es.md)

# L Harness

> ### **[LINE에서 무료 체험하기](https://shudesu.github.io/line-harness-oss/)** 👈

LINE 공식 계정의 완전 오픈소스 CRM. **유료 LINE CRM SaaS (월 1~2만 엔)의 무료 대체품**.
Cloudflare 무료 플랜에서 동작. **서버 비용 0원**. Claude Code 에서 모든 조작 가능.

### ▶️ [YouTube 에서 영상 보기 (약 20분)](https://youtu.be/DiRuGaeq1sM)

[![클릭하여 YouTube 재생 — L Harness 도입 가이드](https://img.youtube.com/vi/DiRuGaeq1sM/maxresdefault.jpg)](https://youtu.be/DiRuGaeq1sM)

**현재 버전**: v0.13.2 ・ MIT License ・ TypeScript / Cloudflare Workers + D1

---

## 왜 L Harness?

| | 폐쇄형 SaaS A | 폐쇄형 SaaS B | **L Harness** |
|---|---|---|---|
| 월 요금 | ¥20,000+ | ¥10,000+ | **0 원** |
| 스텝 메시지 | ✅ | ✅ | ✅ |
| 세그먼트 발송 | ✅ | ✅ | ✅ |
| 리치 메뉴 전환 | ✅ | ✅ | ✅ |
| 폼 (LIFF) | ✅ | ✅ | ✅ |
| 리드 스코어링 | ✅ | ❌ | ✅ |
| IF-THEN 자동화 | 일부 | 일부 | ✅ |
| 공개 API | ❌ | ❌ | **모든 기능** |
| Claude Code (AI) 연동 | ❌ | ❌ | **MCP 서버 내장** |
| 차단 감지 & 계정 자동 이전 | ❌ | ❌ | **✅** |
| 멀티 계정 | 별도 계약 | 별도 계약 | **기본 내장** |
| 친구 중복 검출 | ❌ | ❌ | **✅** (picture_url 토큰으로 계정 간 매칭) |
| 소스 코드 | 비공개 | 비공개 | **MIT (이 저장소)** |

---

## 빠른 시작

### 명령어 한 줄로 전체 셋업

```bash
npx create-line-harness
```

CLI 가 다음을 모두 처리합니다:
- Cloudflare 계정 인증 (`wrangler login`)
- D1 데이터베이스 생성 + schema 및 migration 적용
- Worker / 관리자 페이지 배포
- LINE 공식 계정 credentials 등록
- LIFF 앱 자동 생성
- 관리자 페이지 첫 로그인용 Owner 사용자 생성

소요 시간 약 5 분. 완료되면 `https://<your-name>-admin.pages.dev` 에서 즉시 운영 시작.

### 필요한 것

- Cloudflare 계정 (무료 플랜으로 충분)
- LINE 공식 계정 + Messaging API channel
- Node.js 22+ / pnpm

---

## 주요 기능

### 메시지 발송
- **스텝 메시지** — `delay_minutes` 분 단위 제어, 조건 분기, 스텔스 발송
- **브로드캐스트** — 전체 / 태그 / 세그먼트, 즉시 또는 예약, 500+ 시 자동 큐잉
- **리마인더** — 지정일 기준 카운트다운 발송 (3일 전 / 1일 전 / 당일)
- **템플릿** — `{{name}}` `{{uid}}` `{{auth_url:CHANNEL_ID}}` 로 개인화
- **트래킹 링크** — 클릭 카운트 → 자동 태깅 → 시나리오 트리거

### CRM
- **친구 관리** — Webhook 자동 등록, 프로필 조회, 커스텀 메타데이터
- **태그** — 발송 조건 및 시나리오 트리거
- **리드 스코어링** — 행동 기반 자동 점수 계산
- **상담원 채팅** — 관리자 페이지에서 직접 1:1 응답
- **대화 인박스** — 미응답 대화를 방치 시간 순으로 정렬 (자동 발송 제외 판정)
- **친구 중복 검출** — `picture_url` 중간 토큰으로 여러 계정 간 동일 사용자 자동 태깅

### 마케팅
- **리치 메뉴** — 사용자별 / 태그별 자동 전환
- **폼 (LIFF)** — LINE 내에서 완결되는 폼, 답변 → 메타데이터 자동 저장
- **캘린더 예약** — Google Calendar 연동 LIFF 예약 시스템
- **스태프 관리** — Owner / Admin / Staff 3단계 역할, 개별 API 키 발급

### 제휴 추적 (ASP)
- **셀프서브 링크 발급** — 제휴 파트너가 관리자 개입 없이 LIFF 추적 링크를 직접 발급
- **캠페인 관리** — 캠페인별 고정 보수 설정, 여러 캠페인 병렬 운영
- **시계열 추적** — 클릭 → 친구 추가 → CV를 순서대로 기록, last-touch 귀속으로 성과 연결
- **승인 플로우** — 귀속된 성과를 승인/거절하여 보수를 확정, 중복 계정 플래그로 부정 의심 성과를 가시화
- **LINE 푸시 알림** — 성과 확정 시 제휴 파트너에게 자동 푸시 알림
- 상세: [docs/wiki/27-Affiliate-ASP.md](docs/wiki/27-Affiliate-ASP.md)

### 자동화
- **IF-THEN 규칙** — 트리거 7종 × 액션 6종
- **자동 응답** — 키워드 완전 일치 / 부분 일치
- **Webhook IN/OUT** — Stripe / Slack 등 외부 서비스 연동
- **알림 규칙** — 조건부 알림 발송
- **발송 타이밍** — `delay_minutes` 와 `scheduled_at` 으로 완전 제어 (v0.13.2 에서 시스템 측 시간 게이트는 모두 제거, 운영 측에서 핸들)

### 멀티 계정
- 단일 대시보드에서 **여러 LINE 공식 계정** 관리
- 시나리오・태그・발송 **계정별 스코프**
- **차단 감지** → pool 의 다음 계정으로 친구 자동 이전
- **트래픽 풀** — 여러 계정에 자동 분산

### AI 통합
- **MCP Server 내장** (`@line-harness/mcp-server`) — Claude Code 에서 자연어로 모든 조작
  - `list_conversations` / `get_conversation` — AI 가 미응답 대화 모니터링
  - `create_scenario` / `update_step` — AI 가 시나리오 설계
  - `broadcast` / `send_message` — 발송 류는 사용자 확인 필수
- **공식 SDK** (`@line-harness/sdk`) — TypeScript 타입드 SDK, ESM + CJS, 의존성 제로

### iOS 앱 지원
- **`GET /api/capabilities`** — iOS 앱 (the-harness-ios) 호환성/버전 협상 엔드포인트
- Owner / Admin / Staff 모든 역할에서 사용 가능

---

## 아키텍처

```
[ LINE Platform ] ⇄ [ Cloudflare Worker (Hono) ] ⇄ [ D1 SQLite ]
                              ⇅
                    [ Cloudflare Pages (Next.js 15) ]
                              ⇅
                    [ MCP Server / SDK / Claude Code ]
```

- **Worker** (`apps/worker`): API + LIFF + Webhook 수신, cron 기반 발송 처리
- **Web** (`apps/web`): Next.js 15 대시보드 (19 섹션)
- **Packages**:
  - `@line-harness/sdk` — TypeScript SDK
  - `@line-harness/mcp-server` — Claude Code 용 MCP 서버
  - `create-line-harness` — 셋업 CLI
  - `@line-harness/plugin-template` — 플러그인 확장 템플릿
  - `@line-harness/db` — D1 migration + 헬퍼
  - `@line-harness/line-sdk` — LINE API 얇은 래퍼
  - `@line-harness/shared` — 공유 타입 정의

---

## 리소스

- [셋업 가이드 영상](https://youtu.be/DiRuGaeq1sM)
- [LINE 에서 데모 체험](https://shudesu.github.io/line-harness-oss/)
- [npm: @line-harness/sdk](https://www.npmjs.com/package/@line-harness/sdk)
- [npm: @line-harness/mcp-server](https://www.npmjs.com/package/@line-harness/mcp-server)
- [npm: create-line-harness](https://www.npmjs.com/package/create-line-harness)

---

## 라이선스

MIT License. 상업적 이용, 수정, 재배포 자유.

---

## 기여

Issue / PR 환영. `Shudesu/line-harness-oss` (이 저장소) 로 보내주세요.

---

> **L Harness** by [@Shudesu](https://github.com/Shudesu) — AI 네이티브 시대의 오픈소스 LINE CRM
