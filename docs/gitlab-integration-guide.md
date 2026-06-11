# 사내 GitLab 연동 가이드

Updated: 2026-06-11

PokeLog의 git 연동은 별도 GitLab API를 쓰지 않고 순수 `git` CLI(`git-client.ts`)로
동작한다. 따라서 GitHub뿐 아니라 사내(on-prem) GitLab도 HTTPS로 clone/fetch만
가능하면 그대로 연동된다. 이 문서는 사내 GitLab 프로젝트를 연동할 때 필요한
PAT 발급 스코프, repo URL 형식, 사설 CA(자체 서명 인증서) 설정법을 정리한다.

## 1. 동작 개요

연동된 repo는 서버 폴링 워커가 주기적으로(`config.polling.intervalMinutes`, 기본 5분)
다음 순서로 처리한다.

1. `cloneBareRepo` — 최초 1회 `git clone --bare`로 `pokelog-data/repos/<repo>.git`에
   bare 클론. 이때 원격 추적 refspec(`+refs/heads/*:refs/remotes/origin/*`)을 설정한다.
2. `fetchRepo` — 매 폴링마다 `git fetch origin`으로 새 커밋을 가져온다.
3. `getNewCommits` — 마지막 처리 해시 이후의 커밋을 `origin/<branch>` 기준으로 읽는다.
4. `commit-processor` — 머지 커밋(부모 2개 이상)은 건너뛰고, 커밋 작성자 이메일과
   매칭되는 유저에게 바이트 변경량 기반 보상(EXP/포인트/조우)을 적용한다.

> 주의: bare 클론은 `remote.origin.fetch` refspec이 없으면 이후 `git fetch`가
> `refs/remotes/origin/*`를 갱신하지 않아 `origin/<branch>`가 해석되지 않는다.
> 그 경우 폴러가 클론 시점 스냅샷에 영구 고정되어 신규 커밋 보상이 0이 된다.
> `cloneBareRepo`가 클론 직후 위 refspec을 설정하는 이유다(회귀 방지 테스트 포함).

## 2. PAT(Personal Access Token) 발급

사내 GitLab에서 비공개 repo를 연동하려면 HTTPS clone 권한이 있는 토큰이 필요하다.

- 발급 위치: GitLab → User Settings → Access Tokens (또는 Project/Group Access Token).
- 필요 스코프: **`read_repository`** (clone/fetch 전용). 쓰기는 필요 없다.
  - Project Access Token이나 Group Access Token을 쓸 경우에도 동일하게
    `read_repository` 스코프 + 최소 권한(Reporter 이상)이면 충분하다.
- 만료일: 사내 정책에 맞춰 설정하되, 만료 시 폴링이 인증 실패하므로 갱신 일정을
  관리할 것. (연동은 실패 누적 시 `failCount`가 올라가고 `status`가 `error`로 바뀐다.)

발급한 토큰 문자열(`glpat-...`)을 연동 등록 시 `config.token`으로 전달한다.

## 3. repo URL 형식

연동 등록 본문(`POST /api/user/integrations`)의 `config.repoUrl`에 HTTPS clone URL을 넣는다.

```jsonc
{
  "provider": "gitlab",
  "label": "내 사내 프로젝트",
  "config": {
    "repoUrl": "https://gitlab.internal.corp/group/subgroup/project.git",
    "authMode": "token",        // 비공개 repo는 "token", 공개 repo는 "public"
    "token": "glpat-XXXXXXXXXXXXXXXXXXXX",
    "caCertPath": "/etc/ssl/certs/corp-ca.pem",  // (선택) 사설 CA 번들 경로
    "insecureSkipTls": false                      // (선택) TLS 검증 비활성화
  },
  "emails": ["me@corp.example.com"]   // 커밋 작성자 이메일(보상 매칭용)
}
```

- `authMode: "public"` — 토큰 없이 접근 가능한 repo. URL을 그대로 사용한다.
- `authMode: "token"` — 서버가 내부적으로 URL에 `oauth2:<token>@`를 주입한다.
  GitLab HTTPS PAT 규약(`https://oauth2:<PAT>@host/group/project.git`)과 일치한다.
  - 커스텀 포트(예: `https://gitlab.internal.corp:8443/...`)도 포트/경로를 보존한 채
    인증정보만 주입한다.
  - 토큰에 URL-안전하지 않은 문자가 있으면 자동으로 퍼센트 인코딩된다.
- `emails`는 보상을 받을 커밋 작성자 이메일 목록이다. 커밋의 `author email`이 이
  목록(또는 레거시 `account.matchings.git.emails`)과 일치해야 보상이 적용된다.

### 토큰 노출 방지

토큰이 주입된 URL은 에러 메시지/로그/HTTP 응답에 노출되지 않는다. 모든 git
호출은 `runGit`을 거쳐 에러 메시지의 `scheme://userinfo@` 구간을 `***`로
치환(`redactUrlCredentials`)한다. `testRepoAccess` 실패 응답의 `error`에도 토큰이
포함되지 않는다.

## 4. 사설 CA / 자체 서명 인증서

사내 GitLab이 사설 CA가 발급한 인증서나 자체 서명 인증서를 쓰는 경우, 기본
git TLS 검증이 실패한다. `git-client.ts`는 두 가지 옵션을 지원한다(`GitTlsOptions`).

| 옵션 | 효과 | git 설정 | 권장도 |
| --- | --- | --- | --- |
| `caCertPath` | 사설 CA 번들을 신뢰 | `-c http.sslCAInfo=<경로>` | **권장** |
| `insecureSkipTls` | TLS 검증 완전 비활성화 | `-c http.sslVerify=false` | **프로덕션 금지** |

- **권장: `caCertPath`.** 사내 CA 번들(PEM)을 지정한다. 서버가 접근 가능한 경로여야
  한다(예: `/etc/ssl/certs/corp-ca.pem`). 사설/자체 서명 인증서 환경의 정석 해법이며,
  중간자 공격(MITM)에 노출되지 않는다.
- **`insecureSkipTls`는 임시 디버깅 전용이며 프로덕션에서 사용 금지.** TLS 검증을
  완전히 끄므로 MITM에 취약하다. 인증서 문제를 한시적으로 우회해 원인을 진단할 때만,
  신뢰된 사내망에서 일시적으로 켜고 즉시 끈다. 영구 해법은 반드시 `caCertPath`다.
  - 활성화되면 서버가 연동 테스트와 폴링 시 `logger.warn`으로 명시적 경고를 남긴다.
- 둘 다 설정되면 `insecureSkipTls`가 우선한다(검증이 꺼지므로 `caCertPath`는 무시됨).

연동별 동작: `GitIntegration.config`의 `caCertPath` / `insecureSkipTls` 필드가 등록
파서에서 보존되고, `testRepoAccess`와 폴링 워커의 clone/fetch에 `GitTlsOptions`
(→ `-c http.sslCAInfo` / `-c http.sslVerify=false`)로 전달된다. 따라서 연동마다 다른
사내 CA를 신뢰시킬 수 있다.

호스트의 모든 연동이 같은 사내 CA를 쓴다면, 연동별 `caCertPath` 대신 서버 프로세스
환경변수 **`GIT_SSL_CAINFO=<경로>`**를 지정하는 host-wide 대안도 있다. git이 이
환경변수를 네이티브로 읽으므로 모든 git 호출(clone/fetch/ls-remote)에 전역 적용된다.
권장 1순위는 여전히 연동별 `caCertPath`이며, `GIT_SSL_CAINFO`는 단일 CA 환경의
간편 대안이다.

## 5. 연동 확인 / 트러블슈팅

- 등록 직후 `status`는 `untested`다. 연동 테스트(`testRepoAccess`)가 성공하면 접근
  가능한 브랜치 목록을 반환한다.
- 인증 실패: PAT 만료/스코프 부족/오타를 확인한다. `authMode`가 `token`인지도 확인.
- TLS 실패(`SSL certificate problem`): 4절의 사설 CA 설정을 적용한다.
- 폴링은 되는데 보상이 없음: 커밋 작성자 이메일이 연동 `emails`(또는 매칭 이메일)과
  일치하는지 확인한다. 머지 커밋은 의도적으로 제외된다.
- 호스트 접근 불가: 서버에서 해당 GitLab 호스트로 네트워크가 열려 있는지 확인한다.

## 관련 코드

- `packages/server/src/polling/git-client.ts` — clone/fetch/log, 토큰 주입, TLS, 리댁션
- `packages/server/src/polling/commit-processor.ts` — 커밋→유저 매칭 및 보상
- `packages/server/src/integrations/integration-parsers.ts` — 연동 등록 입력 파싱
- `packages/server/tests/polling/gitlab-pipeline.e2e.test.ts` — E2E 폴링 파이프라인
- `packages/server/src/polling/git-client-security.test.ts` — 토큰/TLS 단위 테스트
