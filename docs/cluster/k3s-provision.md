---
title: "K3s 클러스터 프로비저닝"
sidebar_position: 3
---

본 문서는 `k3sup`을 사용하여 로컬 macOS에서 원격 Ubuntu 24.04 노드에 K3s HA 클러스터를 자동으로 프로비저닝하는 방법을 다룹니다.

수동 설치 가이드는 [k3s-install](k3s-install.md)를 참고합니다.

관련 소스 코드는 [GitHub Repository](https://github.com/cnapcloud/k8s.git)의 `k3s/` 디렉토리에서 확인할 수 있습니다.

---

## 1. 클러스터 구성

Master 3개(HA etcd) + Worker 3개로 구성합니다.

### 방법 A: Multipass 자동 구성

실제 서버 없이 macOS에서 Multipass로 로컬 VM을 자동 생성합니다. 프로비저닝 스크립트 동작을 확인하는 용도입니다.

```
┌────────────────────────────────────────────────────┐
│  Local macOS (k3sup)                               │
│                                                    │
│  [Create Node - Multipass]                         │
│    tools/multipass.sh create                       │
│                                                    │
│  provision/run-all.sh                              │
│    ├── scripts/01-prereq.sh   → SSH → All nodes    │
│    ├── scripts/02-master-init.sh  → k3sup install  │
│    ├── scripts/03-master-join.sh  → k3sup join     │
│    ├── scripts/04-worker-join.sh  → k3sup join     │
│    ├── scripts/05-post-setup.sh   → taint, verify  │
│    └── scripts/06-addons.sh  → NFS, MetalLB, Nginx │
│                                                    │
│  [Delete Node - Multipass]                         │
│    tools/multipass.sh delete                       │
└────────────────────────────────────────────────────┘
```

#### VM 사양 설정

VM을 생성하기 **전에** `provision/tools/multipass.sh` 상단의 사양을 확인하고 필요 시 수정합니다.

| 항목 | 기본값 | 수정 방법 |
|------|--------|-----------|
| CPU | 1 vCPU | `multipass.sh` 상단 `CPU=` 변수 수정 |
| Memory | 4G | `multipass.sh` 상단 `MEMORY=` 변수 수정 |
| Disk | 20G | `multipass.sh` 상단 `DISK=` 변수 수정 |
| Image | Ubuntu 22.04 | `multipass.sh` 상단 `IMAGE=` 변수 수정 |
| SSH 키 | `~/.ssh/id_ed25519.pub` | `multipass.sh` 상단 `SSH_KEY_PUB=` 변수 수정 |

> **참고:** 기본값은 스크립트 동작 확인용 최소 사양입니다. 실제 운영 사양은 노드 요건을 참고하세요.

#### VM 생성 및 관리

```bash
# VM 생성 (기본 6대: master-1~3, worker-1~3) + SSH 키 자동 배포
bash provision/tools/multipass.sh create

# VM 전체 삭제
bash provision/tools/multipass.sh delete
```

#### hosts.env IP 업데이트

VM 생성 후 할당된 IP를 `hosts.env`에 반영합니다.

```bash
# 1. 생성된 VM IP 확인
multipass list

# 2. provision/hosts.env 에서 각 노드 IP 수정
#    MASTER01_IP, MASTER02_IP, MASTER03_IP
#    WORKER01_IP, WORKER02_IP, WORKER03_IP
vi provision/hosts.env
```

### 방법 B: 수동 구성 (실제 서버)

아래 요건을 충족한 후 [2. k3sup 설치](#2-k3sup-설치)로 진행합니다.

| 구분 | 수량 | OS | CPU | Memory | Disk |
|------|------|----|-----|--------|------|
| Master | 3 | Ubuntu 24.04 LTS | 4 vCPU | 8GB | 100GB |
| Worker | 3 | Ubuntu 24.04 LTS | 4 vCPU | 8GB | 100GB |
| LB/Proxy | 1 | Ubuntu 24.04 LTS | 2 vCPU | 2GB | - |

> LB/Proxy가 없으면 `API_SERVER_IP`를 `MASTER01_IP`로 설정합니다 (master01 장애 시 kubectl 불가).
> 16GB 노드 사용 시 `system-reserved`, `eviction-hard` 값이 자동 조정됩니다.

각 노드에서 아래 명령을 실행합니다.

```bash
# hostname 설정
hostnamectl set-hostname <name>

# passwordless sudo
echo "ubuntu ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/ubuntu

# 시간 동기화 (etcd 필수)
sudo apt-get install -y chrony && sudo systemctl enable --now chrony

# 방화벽 (UFW 사용 시)
sudo ufw allow 22/tcp 6443/tcp 10250/tcp
sudo ufw allow 2379:2380/tcp
sudo ufw allow 8472/udp
```

---

## 2. k3sup 설치

**macOS**
```bash
brew install k3sup
```

**Ubuntu / Linux**
```bash
curl -sLS https://get.k3sup.dev | sh
mkdir -p ~/.local/bin
mv k3sup ~/.local/bin/
export PATH="$HOME/.local/bin:$PATH"
```

> 스크립트 실행 시 자동 설치되므로 생략 가능합니다.

---

## 3. SSH 키 준비

모든 노드에 패스워드 없이 접근할 수 있는 SSH 키가 필요합니다.

**키가 없는 경우 생성:**

```bash
ssh-keygen -t ed25519 -C "K3s-provision" -f ~/.ssh/id_K3s
```

**각 노드에 공개키 배포:**

```bash
# 노드별로 반복 실행
ssh-copy-id -i ~/.ssh/id_K3s.pub ubuntu@192.168.0.101
ssh-copy-id -i ~/.ssh/id_K3s.pub ubuntu@192.168.0.102
# ... 나머지 노드
```

**접속 확인:**

```bash
ssh -i ~/.ssh/id_K3s ubuntu@192.168.0.101 "hostname"
```

> 기존 `~/.ssh/id_rsa`를 사용해도 됩니다. `hosts.env`의 `SSH_KEY`에 비밀키 경로를 지정합니다.

---

## 4. hosts.env 설정

```bash
vi provision/hosts.env
```

```bash
SSH_USER="ubuntu"
SSH_KEY="$HOME/.ssh/id_K3s"  # 위에서 생성한 키 경로

MASTER01_IP="192.168.0.101"
MASTER02_IP="192.168.0.102"
MASTER03_IP="192.168.0.103"

# API 서버 진입점
# - LB/Proxy(HAProxy, keepalived 등)가 있으면 VIP로 설정
# - 없으면 기본값(MASTER01_IP) 그대로 사용
API_SERVER_IP="${MASTER01_IP}"

WORKER01_IP="192.168.0.201"
WORKER02_IP="192.168.0.202"
WORKER03_IP="192.168.0.203"

METALLB_IP_RANGE="192.168.0.220-192.168.0.230"

K3s_VERSION=""   # 비워두면 최신 stable

DOMAIN="cnapcloud.com"
```

---

## 5. 전체 자동 실행

```bash
bash provision/run-all.sh
```

완료 후 kubeconfig가 `~/.kube/K3s-config`에 저장됩니다.

```bash
export KUBECONFIG=~/.kube/K3s-config
kubectl get nodes
```

---

## 6. 단계별 실행

전체 자동 실행 대신 단계별로 진행할 수 있습니다.

### 6.1 사전 준비 (전 노드)

swap 비활성화, 패키지 설치, 커널 모듈 로드, sysctl 튜닝을 모든 노드에 적용합니다.

```bash
bash provision/scripts/01-prereq.sh
```

적용 내용:
- swap 비활성화 (`swapoff`, `/etc/fstab`)
- `nfs-common`, `curl` 설치
- 커널 모듈: `br_netfilter`, `overlay`, `nf_conntrack`
- sysctl 튜닝 (`/etc/sysctl.d/99-k8s-tune.conf`)
- journald 로그 제한 (`/etc/systemd/journald.conf.d/99-k8s-limit.conf`)

**sysctl**

| 파라미터 | 값 | 출처 |
|----------|-----|------|
| `nf_conntrack_max` | 1,048,576 | GKE / EKS 기본값 |
| `somaxconn` | 32,768 | 운영 서버 표준 |
| `tcp_tw_reuse` | 1 | 서버 환경 표준 |
| `inotify.max_user_watches` | 524,288 | kubeadm 권장값 |
| `inotify.max_user_instances` | 8,192 | kubeadm 권장값 |
| `inotify.max_queued_events` | 32,768 | kubeadm 권장값 |

**journald**

| 파라미터 | 값 |
|----------|----|
| `SystemMaxUse` | 100M |
| `RuntimeMaxUse` | 100M |

### 6.2 첫 번째 Master 초기화

`--cluster-init`으로 내장 etcd HA 클러스터를 초기화합니다.

```bash
bash provision/scripts/02-master-init.sh
```

- 노드 RAM을 자동 감지하여 kubelet 예약 리소스 결정
- kubeconfig를 `~/.kube/K3s-config`에 자동 저장

| RAM | kube-reserved | system-reserved | eviction-hard |
|-----|--------------|-----------------|---------------|
| ≤ 8GB | cpu=500m, memory=1Gi | cpu=200m, memory=256Mi | memory.available&lt;500Mi, nodefs.available&lt;10%, imagefs.available&lt;10%, nodefs.inodesFree&lt;5% |
| > 8GB | cpu=500m, memory=1Gi | cpu=200m, memory=512Mi | memory.available&lt;1Gi, nodefs.available&lt;10%, imagefs.available&lt;10%, nodefs.inodesFree&lt;5% |

**로그 및 이미지 GC (RAM 무관 공통)**

| 파라미터 | 값 |
|----------|----|
| `container-log-max-size` | 10Mi |
| `container-log-max-files` | 3 |
| `image-gc-high-threshold` | 80% |
| `image-gc-low-threshold` | 70% |

### 6.3 추가 Master 조인

master02, master03을 etcd 클러스터에 조인합니다.

> **주의**: `--cluster-init` 없이 `--server`로 조인합니다. `--cluster-init` 사용 시 새 클러스터가 초기화되어 스플릿 브레인이 발생합니다.

```bash
bash provision/scripts/03-master-join.sh
```

조인 완료 후 etcd는 3-member Raft 클러스터가 됩니다 (1개 장애 허용).

### 6.4 etcd 스냅샷 보관 설정

모든 마스터 노드 조인 완료 후 스냅샷 보관 설정을 적용합니다. K3s는 기본 **6시간마다 자동 스냅샷**을 생성하고 **5개**를 보관합니다. 스냅샷 파일은 `/var/lib/rancher/K3s/server/db/snapshots/`에 저장되며 파일당 수십~수백 MB에 달합니다.

보관 개수는 `hosts.env`의 `ETCD_SNAPSHOT_RETENTION` 변수로 조정합니다 (기본값: `3`).

**모든 Master 노드**에 자동 적용됩니다 (`05-post-setup.sh` 포함):

```bash
bash provision/scripts/05-post-setup.sh
```

> 이미 적용된 노드는 건너뜁니다 (idempotent).

설정 적용 확인:

```bash
# 현재 스냅샷 목록
sudo K3s etcd-snapshot ls

# 스냅샷 디렉터리 크기 확인
sudo du -sh /var/lib/rancher/K3s/server/db/snapshots/
```

| 파라미터 | 기본값 | 운영 설정 | 이유 |
|----------|--------|-----------|------|
| `etcd-snapshot-retention` | `5` | `3` | 보관 수 축소로 디스크 절약 |
| `etcd-snapshot-schedule-cron` | `0 */6 * * *` | `0 */12 * * *` | 6h → 12h 주기로 변경 |

### 6.5 Worker 조인

```bash
bash provision/scripts/04-worker-join.sh
```

| RAM | kube-reserved | system-reserved | eviction-hard |
|-----|--------------|-----------------|---------------|
| ≤ 8GB | cpu=200m, memory=256Mi | cpu=200m, memory=256Mi | memory.available&lt;500Mi, nodefs.available&lt;10%, imagefs.available&lt;10%, nodefs.inodesFree&lt;5% |
| > 8GB | cpu=200m, memory=256Mi | cpu=200m, memory=512Mi | memory.available&lt;1Gi, nodefs.available&lt;10%, imagefs.available&lt;10%, nodefs.inodesFree&lt;5% |

**로그 및 이미지 GC (RAM 무관 공통)**

| 파라미터 | 값 |
|----------|----|
| `container-log-max-size` | 10Mi |
| `container-log-max-files` | 3 |
| `image-gc-high-threshold` | 80% |
| `image-gc-low-threshold` | 70% |

### 6.6 Post-setup

kubeconfig 설정, master taint, 클러스터 상태 확인을 수행합니다.

```bash
bash provision/scripts/05-post-setup.sh
```

정상 출력 예시:

```
NAME       STATUS   ROLES                       AGE   VERSION
master01   Ready    control-plane,etcd,master   5m    v1.34.4+K3s1
master02   Ready    control-plane,etcd,master   4m    v1.34.4+K3s1
master03   Ready    control-plane,etcd,master   4m    v1.34.4+K3s1
worker01   Ready    <none>                      3m    v1.34.4+K3s1
worker02   Ready    <none>                      3m    v1.34.4+K3s1
worker03   Ready    <none>                      3m    v1.34.4+K3s1
```

### 6.7 Addon 설치

NFS StorageClass, MetalLB, Nginx Ingress를 설치합니다.

```bash
bash provision/scripts/06-addons.sh
```

| Addon | 버전 | 역할 |
|-------|------|------|
| NFS Server Provisioner | latest | PVC 동적 프로비저닝 |
| MetalLB | 0.14.9 | LoadBalancer IP 할당 (`METALLB_IP_RANGE`) |
| Nginx Ingress | 4.14.1 | 외부 트래픽 라우팅 |

---

## 7. 설치 확인

```bash
export KUBECONFIG=~/.kube/K3s-config

# 노드 상태
kubectl get nodes -o wide

# etcd 멤버 (master01에서)
ssh ubuntu@192.168.0.101 "sudo K3s etcd-snapshot ls"

# StorageClass
kubectl get sc

# MetalLB
kubectl get pods -n metallb-system

# Nginx Ingress
kubectl get svc -n ingress-nginx
```

---

## 8. 클러스터 검증 (Nginx 테스트)

NFS PVC, MetalLB LoadBalancer, Ingress를 한번에 검증합니다.

```bash
bash provision/test/nginx-test.sh
```

배포 내용 (`test/nginx-test.yaml`):

| 리소스 | 내용 |
|--------|------|
| PVC | NFS StorageClass, 1Gi, ReadWriteMany |
| Deployment | nginx:alpine × 2 replicas, NFS 볼륨 마운트 |
| Service (LoadBalancer) | MetalLB IP 할당 확인 |
| Ingress | `nginx.$DOMAIN` → nginx-lb |

정상 출력 예시:

```
[✓] LoadBalancer (192.168.2.220) OK
[✓] Ingress (nginx.cnapcloud.com) OK
```

## 9. 파일 구조

```
provision/
  hosts.env             ← IP / SSH / 환경 설정 (여기만 수정)
  run-all.sh            ← 전체 순서대로 자동 실행
  README.md
  scripts/
    00-local-setup.sh   ← k3sup, kubectl, helm 설치
    01-prereq.sh        ← 전 노드 공통 준비 (swap, sysctl 등)
    02-master-init.sh   ← master01 초기화 (cluster-init)
    03-master-join.sh   ← master02, master03 조인
    04-worker-join.sh   ← worker 조인
    05-post-setup.sh    ← kubeconfig, taint, 상태 확인
    06-addons.sh        ← NFS, MetalLB, Nginx Ingress
  test/
    nginx-test.sh  ← NFS PVC + MetalLB + Ingress 검증
    nginx-test.yaml
  tools/
    multipass.sh        ← Multipass VM create/delete/list
```
