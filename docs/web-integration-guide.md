# 웹 통합 가이드

Updated: 2026-06-11

외부 웹앱(사내 포털, 배포처별 사이트 등)이 PokeLog REST API를 브라우저에서
안전하게 소비하기 위한 가이드다. 인증은 PokeLog 자체 계정(JWT)을 그대로 쓴다 —
별도 인증 모델은 없으며, 이 문서는 브라우저에서 그 흐름을 어떻게 쓰는지와
서버를 어떻게 열어주는지를 설명한다.

## 1. API 베이스 URL과 버전

모든 라우트는 두 프리픽스로 동일하게 제공된다.

- `/api/...` — 기존 프리픽스(CLI 호환).
- `/api/v1/...` — 외부 웹 소비자용 **안정 버전 별칭**. 외부 통합은 이쪽을 쓰는 것을
  권장한다. 향후 비호환 변경은 `/api/v2`로 나가고 `/api/v1`은 유지된다.

예: `GET https://<서버호스트>/api/v1/meta`

## 2. CORS 설정 (서버 운영자)

브라우저가 다른 오리진의 PokeLog API 응답을 읽으려면 서버가 그 오리진을
허용해야 한다. 허용 오리진은 `config.json`의 `server.corsAllowedOrigins`에
**명시적 화이트리스트**로 둔다.

```jsonc
{
  "server": {
    "port": 3000,
    "corsAllowedOrigins": [
      "https://portal.corp.example",
      "https://pokelog.corp.example"
    ]
  }
}
```

동작:

- 리스트에 있는 오리진의 요청에만 CORS 응답 헤더(`Access-Control-Allow-Origin`
  등)를 내보낸다. 응답에 요청 오리진을 그대로 반영하며 와일드카드 `*`는 쓰지
  않는다(자격증명 요청과 호환되지 않으므로).
- `Access-Control-Allow-Credentials: true` — `Authorization: Bearer` 헤더가
  프리플라이트를 통과한다.
- 프리플라이트(`OPTIONS`)를 자동 처리한다. 허용 메서드(GET/POST/PUT/PATCH/
  DELETE/OPTIONS), 허용 헤더(`Content-Type`, `Authorization`, `X-Admin-Key`),
  노출 헤더(`X-Request-Id`)를 응답한다. 프리플라이트 캐시는 600초.
- 매칭 시 오리진 끝의 슬래시는 무시한다.
- **리스트가 비어 있거나 없으면 CORS는 완전히 비활성화**된다(헤더 미출력).
  동일 오리진 브라우저, CLI 같은 비브라우저 클라이언트, 기존 테스트는 영향 없음.
- 화이트리스트에 없는 오리진의 요청은 서버에서는 정상 처리되지만 CORS 헤더가
  없으므로 브라우저가 응답 읽기를 차단한다(서버 로그에 warn 기록).

## 3. 인증 흐름 (웹앱 개발자)

PokeLog 자체 계정으로 로그인해 JWT를 받고, 이후 요청에 Bearer 토큰을 붙인다.

### 3.1 회원가입 / 로그인

```js
// 회원가입 (최초 1회) — id는 영문/숫자만, starter는 bulbasaur|charmander|squirtle
const reg = await fetch("https://<host>/api/v1/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id, password, nickname, starter: "charmander" }),
});
// 201 → { token }

// 로그인
const res = await fetch("https://<host>/api/v1/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id, password }),
});
const { token } = await res.json(); // 200 → { token }
```

### 3.2 인증 요청

받은 토큰을 `Authorization: Bearer <token>`로 보낸다.

```js
const profile = await fetch("https://<host>/api/v1/user/profile", {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());
```

### 3.3 토큰 만료 / 갱신 정책

- 토큰 수명: **30일**(`expiresIn: "30d"`). 별도 리프레시 토큰은 없다.
- 갱신 방법: 만료되면 `401`이 떨어지므로 **다시 로그인**해 새 토큰을 받는다.
  웹앱은 `401` 응답을 감지해 로그인 화면으로 보내거나 저장된 자격증명으로
  재로그인하는 흐름을 구현한다.
- 토큰 저장: XSS 위험을 고려해 가능하면 메모리/세션 저장을 권장한다. (서버는
  쿠키 세션이 아니라 Bearer 토큰 방식이다.)

## 4. 공개/소비 대상 엔드포인트

외부 웹 통합에서 사용을 보증하는 엔드포인트. **`/api/admin/*`은 운영자 키로
보호되며 외부 노출 대상이 아니다.**

### 인증 불필요 (공개)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/v1/meta` | 서버 메타데이터(serverName, displayName, featureFlags 등) |
| GET | `/api/v1/art/:species` | 포켓몬 ANSI 아트(text/plain) |
| GET | `/api/v1/art/ball/:name` | 볼 아트 |
| GET | `/api/v1/art/egg/:name` | 알 아트 |
| GET | `/api/v1/social/ranking?by=exp\|level\|pokedex\|points` | 랭킹 |
| GET | `/api/v1/social/profile/:nickname` | 공개 프로필 |
| POST | `/api/v1/auth/register` | 회원가입 → `{ token }` |
| POST | `/api/v1/auth/login` | 로그인 → `{ token }` |

### 인증 필요 (Bearer)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/v1/user/profile` | 내 전체 상태(계정·포켓몬·진행도) |
| GET | `/api/v1/user/search?q=&limit=` | 유저 검색 |
| PUT | `/api/v1/user/nickname` | 닉네임 변경 |
| GET | `/api/v1/user/integrations` | 내 연동 목록 |
| POST/PATCH/DELETE | `/api/v1/user/integrations[...]` | 연동 생성/수정/삭제/테스트/동기화 |
| GET | `/api/v1/social/ranking`, `/social/profile/:nickname` | (공개지만 동일 사용 가능) |

> 게임 플레이 라우트(`/api/v1/game/*`, `/shop`, `/battle`)도 Bearer로 접근
> 가능하지만, 외부 웹에서의 사용은 배포처 요구에 따라 선택한다. 위 표는 "사이트가
> 유저 상태/랭킹을 보여주는" 표준 소비 시나리오 기준이다.

### 속도 제한

- 인증 라우트(`/auth`): 분당 10회(브루트포스 방어)
- 게임/유저/소셜 라우트: 분당 60회
- 공개 라우트(`/meta`, `/art`): 분당 120회

`429` 응답 시 `Retry-After`/표준 RateLimit 헤더를 참고해 백오프한다.

## 5. 최소 통합 예제

```html
<script type="module">
const BASE = "https://pokelog.corp.example/api/v1";

async function login(id, password) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, password }),
  });
  if (!r.ok) throw new Error("login failed");
  return (await r.json()).token;
}

async function myProfile(token) {
  const r = await fetch(`${BASE}/user/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 401) throw new Error("token expired — re-login");
  return r.json();
}

async function ranking() {
  return (await fetch(`${BASE}/social/ranking?by=exp`)).then((r) => r.json());
}
</script>
```

## 6. 운영 체크리스트

- [ ] `config.json`의 `server.corsAllowedOrigins`에 배포 사이트 오리진 추가.
- [ ] 서버를 HTTPS 뒤에 둔다(브라우저 자격증명 요청은 보안 컨텍스트 권장).
- [ ] 외부 통합은 `/api/v1` 프리픽스 사용.
- [ ] `POKELOG_JWT_SECRET` 환경변수 설정(토큰 서명 키).
- [ ] `/api/admin/*`은 외부에 노출하지 않는다(운영자 키 전용).

## 관련 코드

- `packages/server/src/middleware/cors-middleware.ts` — config 기반 CORS
- `packages/server/src/app.ts` — 미들웨어/라우트 마운트, `/api` + `/api/v1`
- `packages/server/src/auth/auth.ts` — JWT 발급/검증(30일 만료)
- `packages/server/src/middleware/auth-middleware.ts` — Bearer 토큰 검사
- `packages/server/tests/api/cors.test.ts` — CORS 동작 테스트
