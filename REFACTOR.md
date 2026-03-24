PokeLog CLI 서버 연결 UX 개편 설계 지시서
배경
현재 PokeLog는 CLI가 서버 API를 호출하는 구조이며, 사용자는 서버 URL 설정 후 로그인해서 사용하는 흐름이다.
​
기존 계획은 pokelog init --server <url>로 단일 서버 URL을 저장하고, ~/.pokelog/auth.json에 토큰을 저장하는 방식이다.

하지만 PokeLog는 MIT 라이선스로 공개될 예정이며, 개인/동아리/회사 등 다양한 운영자가 각자 서버를 구축해 배포할 수 있다. 따라서 사용자는 하나의 서버만 쓰지 않을 수 있고, 서버마다 기능 확장이나 규칙 차이가 있을 수 있다. 이에 따라 CLI는 단일 서버 고정형 설정이 아니라 멀티 서버 프로필 기반 연결 모델을 지원해야 한다.

목표
이번 변경의 목표는 다음과 같다.

사용자의 최초 진입 UX를 init --server 중심에서 join <url> 중심으로 바꾼다.

CLI가 여러 서버를 저장하고 전환할 수 있도록 한다.

로그인 토큰은 서버별로 분리 저장한다.

현재 어떤 서버에 연결 중인지 항상 명확히 보이게 한다.

향후 서버별 기능 차이와 커스텀 확장을 수용할 수 있도록 서버 메타데이터 조회 구조를 추가한다.

핵심 UX 방향
1. 서버 연결 개념 변경
기존:

사용자가 서버 URL을 로컬 설정에 입력하고 사용 시작

변경:

사용자가 pokelog join <url>로 서버에 “참가”한다

CLI는 해당 서버를 로컬 프로필에 저장한다

저장 후 그 서버를 현재 활성 서버로 전환한다

즉, 사용자가 느끼는 개념은 “설정”이 아니라 “서버 참가”여야 한다.

2. 멀티 서버 프로필 지원
CLI는 여러 서버를 저장할 수 있어야 한다.

예시:

회사 서버

동아리 서버

개인 테스트 서버

사용자는 저장된 서버 목록을 보고 현재 서버를 전환할 수 있어야 한다.

3. 서버별 인증 분리
토큰은 전역 단일 토큰이 아니라, 서버별 토큰으로 관리한다.
서버 A에서 로그인한 정보가 서버 B에 사용되면 안 된다.

4. 현재 서버 명시
인터랙티브 셸 또는 상태 화면에서 현재 활성 서버를 항상 표시한다.

예시:

pokelog[company]>

pokelog[club]>

새로운 명령어 정책
필수 추가
pokelog join <url>

서버 등록

서버 메타 조회

로컬 프로필 저장

현재 서버로 활성화

pokelog servers

저장된 서버 목록 표시

현재 활성 서버 표시

pokelog use <server-name-or-alias>

활성 서버 전환

pokelog leave <server-name-or-alias>

저장된 서버 제거

필요 시 해당 서버 토큰도 함께 제거

pokelog whereami

현재 활성 서버 정보 출력

유지하되 역할 변경
pokelog init --server <url>

하위 호환 목적 또는 고급 수동 설정용으로만 유지

내부적으로는 join <url>과 유사한 동작으로 수렴해도 됨

문서/온보딩에서는 더 이상 주 경로로 사용하지 않음

기존 인증 명령의 기준
pokelog login

pokelog register

pokelog logout

위 명령은 모두 현재 활성 서버 기준으로 동작해야 한다.

로컬 설정 구조 변경
기존 설계는 다음과 같다.

~/.pokelog/config.json → 단일 서버 URL

~/.pokelog/auth.json → 단일 로그인 토큰

이를 아래처럼 변경한다.

~/.pokelog/config.json
json
{
  "currentServerId": "company-main",
  "servers": [
    {
      "id": "company-main",
      "name": "company",
      "url": "https://pokelog.company.internal",
      "displayName": "Company PokeLog",
      "apiVersion": "1",
      "joinedAt": "2026-03-24T12:00:00Z"
    },
    {
      "id": "club-room",
      "name": "club",
      "url": "https://pokelog.club.kr",
      "displayName": "Club Server",
      "apiVersion": "1",
      "joinedAt": "2026-03-24T13:00:00Z"
    }
  ]
}
~/.pokelog/auth.json
json
{
  "tokens": {
    "company-main": {
      "accessToken": "jwt-token-here",
      "savedAt": "2026-03-24T12:10:00Z"
    },
    "club-room": {
      "accessToken": "another-jwt-token",
      "savedAt": "2026-03-24T13:10:00Z"
    }
  }
}
저장 규칙
currentServerId가 현재 활성 서버를 의미한다.

서버 식별자는 URL이 아니라 별도 serverId를 기준으로 저장한다.

토큰은 serverId 기준으로 저장한다.

서버 제거 시 해당 서버의 토큰도 정리한다.

서버 메타데이터 API 추가
오픈소스 특성상 서버마다 기능 차이가 생길 수 있으므로, CLI는 서버 접속 시 서버 메타데이터를 조회할 수 있어야 한다.

신규 엔드포인트
GET /api/meta

응답 예시
json
{
  "serverId": "company-main",
  "serverName": "company",
  "displayName": "Company PokeLog",
  "apiVersion": "1",
  "featureFlags": {
    "pvp": false,
    "trade": false,
    "achievements": false,
    "regions": false,
    "notionIntegration": true
  }
}
목적
CLI가 서버를 고유하게 식별할 수 있게 함

동일 URL 변경 또는 별칭 변경과 무관하게 서버를 안정적으로 다룸

향후 서버별 지원 기능을 동적으로 표시 가능하게 함

API 버전 호환성 검사 기반 제공

join 동작 상세
pokelog join <url>의 동작은 아래 순서로 구현한다.

입력 URL 정규화

protocol 보정 여부는 선택 사항

최소한 유효한 URL 형식인지 검사

GET <url>/api/meta 호출

연결 가능 여부 확인

메타데이터 수집

이미 등록된 서버인지 확인

serverId 또는 URL 기준 중복 검사

이미 있으면 정보 갱신 또는 활성화만 수행

config에 서버 저장

serverId, name, displayName, url, apiVersion, joinedAt

현재 활성 서버로 설정

currentServerId 갱신

사용자에게 결과 출력

서버 이름

서버 주소

현재 활성화 여부

다음 단계 안내: login 또는 register

출력 예시
text
Joined server: Company PokeLog
URL: https://pokelog.company.internal
Current server set to: company

Next steps:
- pokelog login
- pokelog register
첫 실행 UX 변경
현재는 서버 URL이 없으면 사용이 불가능한 구조다.

변경 후 첫 실행 UX는 아래처럼 동작해야 한다.

상태 1: 저장된 서버가 없음
pokelog 실행 시:

에러로 끝내지 않는다

“참가할 서버가 없습니다” 메시지 출력

다음 행동 안내:

pokelog join <url>

또는 인터랙티브 입력 유도 가능

예시:

text
No PokeLog server joined yet.

Join a server first:
  pokelog join https://your-server-url
상태 2: 서버는 있으나 현재 서버가 없음
저장된 서버 중 하나를 선택하게 하거나

가장 최근 서버를 자동 선택

추천은 명시적 선택

상태 3: 현재 서버는 있으나 미로그인
현재 서버를 표시

로그인/회원가입 선택 유도

상태 4: 현재 서버 + 로그인 완료
메인 홈 또는 status 화면으로 진입

인터랙티브 셸 반영
인터랙티브 셸을 유지한다면 프롬프트에 현재 서버를 표시한다.

예:

text
pokelog[company]>
pokelog[club]>
또한 셸 내에서 아래 보조 명령을 제공하면 좋다.

server → 현재 서버 정보

servers → 등록된 서버 목록

use <name> → 서버 전환

API 클라이언트 변경 사항
현재 CLI API 클라이언트는 단일 서버 URL과 단일 토큰 기반으로 동작하는 구조다.
​
이를 아래 원칙으로 수정한다.

모든 API 요청은 resolveCurrentServer()로 현재 서버를 먼저 찾는다.

모든 인증 헤더는 getTokenForServer(serverId)로 가져온다.

현재 서버가 없으면 API 호출 전에 사용자 친화적 오류를 띄운다.

현재 서버의 apiVersion, featureFlags를 필요 시 클라이언트 로컬 캐시로 활용 가능하게 한다.

하위 호환 정책
기존 사용자가 이미 config.json에 단일 serverUrl만 가지고 있을 수 있으므로, 1회 마이그레이션을 지원한다.

마이그레이션 규칙
기존 config:

json
{ "serverUrl": "http://localhost:3000" }
기존 auth:

json
{ "token": "..." }
변경 후 첫 실행 시:

단일 serverUrl을 하나의 서버 프로필로 변환

currentServerId 설정

기존 단일 토큰을 해당 서버의 token entry로 이동

가능하면 자동 마이그레이션 후 파일을 새 포맷으로 rewrite한다.

개발 작업 항목
CLI
packages/cli/src/config.ts

단일 서버 URL 구조 제거

멀티 서버 프로필 로드/저장 구현

현재 서버 resolve 함수 추가

서버별 토큰 관리 함수 추가

구버전 config/auth 마이그레이션 추가

packages/cli/src/api-client.ts

현재 서버 기준 URL/토큰 선택하도록 수정

packages/cli/src/index.ts

join, servers, use, leave, whereami 명령 등록

packages/cli/src/commands/

join.ts

servers.ts

use.ts

leave.ts

whereami.ts

기존 init.ts는 deprecated 메시지 또는 wrapper 처리

인터랙티브 셸 프롬프트

현재 서버명 표시

Server
packages/server/src/routes/meta-routes.ts 신규 추가

GET /api/meta 구현

app.ts에 meta route 등록

Shared types
서버 메타 응답 타입 추가

로컬 CLI config 타입도 필요 시 별도 정의

수용 기준
다음이 충족되면 완료로 본다.

사용자는 pokelog join <url>만으로 서버를 등록할 수 있다.

여러 서버를 저장하고 전환할 수 있다.

로그인 토큰이 서버별로 분리 저장된다.

현재 서버가 셸/명령에서 명확히 표시된다.

기존 단일 서버 설정 사용자는 자동 마이그레이션된다.

GET /api/meta를 통해 CLI가 서버 메타데이터를 조회할 수 있다.

기존 login, register, status 등은 현재 활성 서버 기준으로 정상 동작한다.

권장 구현 순서
GET /api/meta 추가

CLI config/auth 구조 개편

join 구현

servers / use / whereami 구현

API client current server 기준으로 변경

기존 auth 명령 서버별 토큰 대응

구버전 마이그레이션

셸 프롬프트 현재 서버명 표시

leave 및 정리 UX 추가

참고 메모
현재 설계 문서는 CLI 로컬 설정을 ~/.pokelog/config.json의 서버 URL과 ~/.pokelog/auth.json의 토큰으로 정의하고 있으므로, 이번 작업은 이 구조를 확장하는 방향으로 진행해야 한다.
​
또 기존 구현 계획에서도 CLI core infrastructure의 config.ts, api-client.ts, index.ts, commands/가 이 변경의 직접 대상이다.
​

원하면 다음 답변에서 이걸 바로 이어서 개발 에이전트용 체크리스트 버전으로 더 짧고 실행형으로 바꿔드릴게요.