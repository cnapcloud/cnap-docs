---
title: "Kind 클러스터 프로비저닝"
sidebar_position: 5
---

본 문서는 스크립트를 사용하여 Kind 클러스터를 자동으로 프로비저닝하는 방법을 다룹니다.
수동 설치 가이드는 [kind-install](kind-install.md)를 참고합니다.

관련 소스 코드는 [GitHub Repository](https://github.com/cnapcloud/k8s.git)의 `kind/` 디렉토리에서 확인할 수 있습니다.

## 구성
```
1 Control-plane  +  4 Worker  (Docker 컨테이너 기반)
```

```
provision/run-all.sh
  ├── 00-local-setup.sh   → kind, kubectl, helm 설치
  ├── 01-create-cluster.sh → kind create cluster
  ├── 02-post-setup.sh    → 레이블, CoreDNS, Harbor hosts
  └── 03-addons.sh        → Nginx Ingress, NFS StorageClass
```

---

## 사전 요구사항

- Docker 설치 및 실행 중 (macOS는 아래 참고)
- macOS: `brew` 설치

### macOS Docker 설치

Docker Desktop 대신 [Colima](https://github.com/abiosoft/colima)를 사용합니다.

```bash
brew install colima docker

# 시작
colima start

# 설치 확인
docker info
```

> Colima는 로그인 시 자동 시작되지 않습니다. 재부팅 후에는 `colima start`를 먼저 실행해야 합니다.
- Raspberry Pi 사용 시 `/boot/firmware/cmdline.txt` 끝에 추가 후 재부팅:
  ```
  cgroup_enable=cpuset cgroup_memory=1 cgroup_enable=memory systemd.unified_cgroup_hierarchy=0
  ```

### Linux (Ubuntu/Debian) Docker 설치

`00-local-setup.sh`는 Docker를 설치하지 않습니다. Linux 환경에서는 사전에 Docker를 직접 설치해야 합니다.

```bash
# Docker 설치
curl -fsSL https://get.docker.com | sudo sh

# 현재 사용자를 docker 그룹에 추가 (sudo 없이 사용)
sudo usermod -aG docker $USER

# 그룹 변경 즉시 적용 (로그아웃 없이)
newgrp docker

# 설치 확인
docker info
```

---

## 1. config.env 설정

```bash
vi provision/config.env
```

```bash
CLUSTER_NAME="kind"
KIND_IMAGE="kindest/node:v1.34.0"

# Harbor registry IP (DNS 미사용 시 worker /etc/hosts 등록)
# 비워두면 /etc/hosts 등록 스킵
HARBOR_HOST="harbor.cnapcloud.com"
HARBOR_IP=""

# CoreDNS forward DNS
DNS_SERVERS="1.1.1.1 1.0.0.1"
```

---

## 2. 전체 자동 실행

```bash
bash provision/run-all.sh
```

---

## 3. 단계별 실행

### 3.1 로컬 도구 설치

kind, kubectl, helm을 설치합니다. 이미 설치되어 있으면 스킵합니다.

```bash
bash provision/00-local-setup.sh
```

| 도구 | macOS | Linux |
|------|-------|-------|
| kind | `brew` | GitHub Releases (`~/.local/bin`) |
| kubectl | `brew` | `dl.k8s.io` stable (`~/.local/bin`) |
| helm | `brew` | 공식 설치 스크립트 (`~/.local/bin`) |

### 3.2 클러스터 생성

`kind-4nodes.yaml` 기반으로 클러스터를 생성합니다. 이미 존재하면 스킵합니다.
`apiServerAddress`는 스크립트가 로컬 IP를 자동 감지(`en0`)하여 치환합니다.

```bash
bash provision/01-create-cluster.sh
```

클러스터 구성:
- Control-plane 1개: `ingress-ready=true` 레이블, 포트 80/443 매핑
- Worker 4개: Harbor insecure registry (`certs.d`) 마운트

### 3.3 Post-setup

```bash
bash provision/02-post-setup.sh
```

적용 내용:

| 항목 | 내용 |
|------|------|
| 노드 레이블 | `node-role.kubernetes.io/system=true`, `platform=true` |
| Docker 자동재시작 | `--restart unless-stopped` |
| nfs-common | 전 노드에 설치 (`docker exec`) |
| Harbor hosts | `HARBOR_IP` 설정 시 worker `/etc/hosts` 등록 |
| CoreDNS | `1.1.1.1 1.0.0.1`로 forward (cert-manager DNS-01 챌린지 대응) |

### 3.4 Addon 설치

```bash
bash provision/03-addons.sh
```

| Addon | 방식 | 역할 |
|-------|------|------|
| Nginx Ingress | Helm (v4.9.0) | 외부 트래픽 라우팅 (포트 80/443) |
| NFS StorageClass | Helm | PVC 동적 프로비저닝 (35Gi, NFS v4.1) |

> **Nginx Ingress admission webhook 인증서**
> Helm 기본값으로 자체 서명 인증서가 생성되며 유효기간은 **365일(1년)** 입니다.
> 만료 시 Ingress 리소스 생성/수정이 차단되므로 `helm upgrade`로 재설치하면 갱신됩니다.
> Kind 환경 특성상 1년 내 클러스터를 재생성하는 경우가 많아 보통 문제가 되지 않습니다.

---

## 4. 설치 확인

```bash
# 노드 상태
kubectl get nodes

# StorageClass
kubectl get sc

# Ingress Controller
kubectl get pods -n ingress-nginx

# CoreDNS
kubectl -n kube-system get pods -l k8s-app=kube-dns
```

---

## 5. 클러스터 삭제

```bash
kind delete cluster --name kind
```

---

## 6. 파일 구조

```
provision/
  config.env            ← 클러스터명, 이미지, Harbor IP 등 (여기만 수정)
  run-all.sh            ← 전체 순서대로 자동 실행
  00-local-setup.sh     ← kind, kubectl, helm 설치
  01-create-cluster.sh  ← kind create cluster
  02-post-setup.sh      ← 레이블, 자동재시작, nfs-common, CoreDNS
  03-addons.sh          ← Nginx Ingress, NFS StorageClass
  nginx-values.yaml     ← Nginx Ingress Helm values (Kind 전용)
  nfs-values.yaml       ← NFS StorageClass Helm values
```
