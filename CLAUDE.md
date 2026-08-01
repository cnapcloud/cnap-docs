# CNAP DOCS — Claude Code 가이드

## 프로젝트 개요

Docusaurus 기반 CNAP(Cloud-Native Application Platform) 설치 가이드 사이트. 콘텐츠는
`hugo-cnap/site/content/guide/`(Hugo)에서 이전한 것이며, 두 개의 큰 진입점으로 구성된다.

- `docs/cluster/` — Kubernetes 클러스터 설치(EKS / k3s / kind, 멀티 클러스터 네트워크)
- `docs/gitops/` — GitOps 기반 플랫폼 모듈 설치, 기능군별 하위 카테고리(`network/`,
  `data-platform/`, `auth-routing/`, `cicd/`, `observability/`, `messaging/`, `application/`)

**`.md` 파일은 MDX로 컴파일된다.** 주석은 HTML 주석(`<!-- -->`)이 아니라 `{/* ... */}`로
쓴다 — `<!-- -->`는 MDX 파서가 JSX로 해석을 시도하다 컴파일 에러를 내고 dev 서버 전체가
죽는다. 마찬가지로 본문에 닫히지 않은 `<...>` 형태(예: 툴콜 찌꺼기, 잘못된 플레이스홀더)가
남아있으면 안 된다 — 꺾쇠 플레이스홀더는 반드시 코드 스팬(`` `<VALUE>` ``)이나 코드 블록
안에만 둔다. 파일을 만들거나 고친 뒤에는 dev 서버 로그나 `npm run build`로 컴파일 에러가
없는지 확인한다.

## 문서 구조 원칙

- 문서 파일명에 번호 접두사를 쓰지 않는다(`numberPrefixParser: false`). 순서는 프런트매터
  `sidebar_position`과 각 폴더 `_category_.json`의 `position`으로 제어한다.
- 기능군별로 폴더(카테고리)를 나누어 사이드바에서 묶어 보이게 한다 — 개별 모듈 문서를 하나로
  병합하지 않는다(문서당 분량이 이미 상당하므로 병합하면 유지보수성이 떨어진다).
- 내부 문서 간 링크는 상대경로 + `.md` 확장자로 쓴다(예: `[cert-manager](../network/cert-manager.md)`).
  Docusaurus는 파일시스템 기준 상대경로로 링크를 해석하므로 Hugo의 pretty-URL 상대경로
  (`../slug`)를 그대로 가져오면 깨진다.

## 제목(헤딩) 구성

- 문서(H1)당 정확히 1개. 페이지 제목은 프런트매터 `title`로 설정하고 본문에서 H1을
  반복하지 않는다.
- 헤딩 문구는 간결하게 — 구두점이 많아지면 헤딩이 너무 복잡하다는 신호다.

## 참고

원본 콘텐츠와 이전 계획은 [content-proposal.md](content-proposal.md)에 정리돼 있다.
