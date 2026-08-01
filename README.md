# CNAP DOCS

CNAP(Cloud-Native Application Platform) 설치 가이드 사이트의 소스 저장소.
[Docusaurus](https://docusaurus.io/)로 빌드되는 공개(public) 사이트이며, 문서 원본은 전부
`docs/`에 있다. 원본 콘텐츠는 `hugo-cnap/site/content/guide/`(Hugo)에서 이전한 것이다.

## 구성

| 폴더 | 내용 |
|------|------|
| [docs/cluster/](docs/cluster/) | EKS / K3s / Kind 클러스터 설치와 멀티 클러스터 네트워크(VPN/TGW) 구성 가이드입니다. |
| [docs/gitops/](docs/gitops/) | GitOps 기반 플랫폼 모듈 설치 — 네트워크/인증서, 데이터 플랫폼, 인증/트래픽, CI/CD, 관측성, 메시징, 애플리케이션 |

## 읽는 순서 (처음 접하는 경우)

1. [cluster/eks-provision.md](docs/cluster/eks-provision.md) — Kubernetes 클러스터 준비
2. [gitops/prerequisites.md](docs/gitops/prerequisites.md) — GitOps 플랫폼 설치 전 공통 준비
3. `docs/gitops/` 하위 카테고리를 네트워크 → 데이터 플랫폼 → 인증/트래픽 → CI/CD → 관측성 →
   메시징 → 애플리케이션 순서로 진행

## 문서 사이트 실행

`Makefile` 타겟 또는 npm 스크립트 중 편한 쪽을 쓴다.

```bash
make install   # npm install
make start     # 개발 서버 (http://localhost:3000, 변경사항 즉시 반영)
make build     # 정적 빌드 (build/)
make serve     # 빌드 결과물 로컬 서빙
make clean     # build/, .docusaurus/ 삭제
```

컨테이너 이미지 빌드/푸시:

```bash
make docker-build   # 로컬 이미지 빌드
make docker-push    # 레지스트리 빌드/푸시
```

## 문서 추가/수정

- 문서 파일은 `docs/<섹션>/slug.md` 형식 — 파일명에 번호 접두사를 쓰지 않는다
  (`numberPrefixParser: false`). 사이드바 순서는 파일 프런트매터의 `sidebar_position`,
  섹션(폴더) 순서는 각 폴더 `_category_.json`의 `position`으로 정한다.
- 섹션(폴더) 라벨·설명은 `_category_.json`에서 관리.
- 새 섹션을 추가하면 `docusaurus.config.js`의 navbar/footer 링크도 함께 갱신한다.
- 문서 작성 컨벤션은 [CLAUDE.md](CLAUDE.md) 참고.

## 유지보수 원칙

- `hugo-cnap`의 원본 가이드가 바뀌면 이 저장소도 함께 갱신한다(문서가 원본을 따라가지 못하는
  것을 방지).
