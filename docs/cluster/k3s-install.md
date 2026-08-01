---
title: "K3s 클러스터 설치(수동)"
sidebar_position: 4
---

**목차**
- [1. 사전 준비 (모든 노드 공통)](#1-사전-준비-모든-노드-공통)
  - [1.1 노드 요건](#11-노드-요건)
  - [1.2 기본 준비](#12-기본-준비)
  - [1.3 커널 모듈 로드](#13-커널-모듈-로드)
  - [1.4 커널 파라미터 (sysctl) 튜닝](#14-커널-파라미터-sysctl-튜닝)
  - [1.5 kubelet 파라미터](#15-kubelet-파라미터)
  - [1.6 journald 로그 제한 (모든 노드)](#16-journald-로그-제한-모든-노드)
- [2. K3s 클러스터 설치 및 노드 구성](#2-k3s-클러스터-설치-및-노드-구성)
  - [2.1 Master Node 구성](#21-master-node-구성)
    - [2.1.1 첫 번째 Master Node (cluster-init)](#211-첫-번째-master-node-cluster-init)
    - [2.1.2 추가 Master Node 조인 (master-2, master-3)](#212-추가-master-node-조인-master-2-master-3)
    - [2.1.3 etcd 스냅샷 보관 설정](#213-etcd-스냅샷-보관-설정)
  - [2.2 Worker Node 조인](#22-worker-node-조인)
  - [2.3 Kubeconfig 및 프로필 설정 (Master)](#23-kubeconfig-및-프로필-설정-master)
  - [2.4 Master Node 스케줄링 제외](#24-master-node-스케줄링-제외)
  - [2.5 클러스터 상태 확인](#25-클러스터-상태-확인)
- [3. NFS 서버 설치](#3-nfs-서버-설치)
  - [3.1 NFS 클라이언트 설치 (모든 노드)](#31-nfs-클라이언트-설치-모든-노드)
  - [3.2 Helm 리포지토리 추가](#32-helm-리포지토리-추가)
  - [3.3 NFS 서버 설치](#33-nfs-서버-설치)
- [4. MetalLB 설정](#4-metallb-설정)
  - [BGP 모드 (BGP 라우터가 있는 경우 활성화)](#bgp-모드-bgp-라우터가-있는-경우-활성화)
- [5. Nginx Ingress 설정](#5-nginx-ingress-설정)
- [6. Ingress 리소스 배포 예제](#6-ingress-리소스-배포-예제)
  - [6.1 테스트 애플리케이션 배포](#61-테스트-애플리케이션-배포)
  - [6.2 Ingress 리소스 생성 및 배포](#62-ingress-리소스-생성-및-배포)
  - [6.3 Nginx Ingress LoadBalancer IP 확인 및 호스트 등록](#63-nginx-ingress-loadbalancer-ip-확인-및-호스트-등록)
  - [6.4 접속 테스트](#64-접속-테스트)
- [7. 메트릭 설정 (Prometheus 연동)](#7-메트릭-설정-prometheus-연동)
  - [7.1 etcd 멤버 확인](#71-etcd-멤버-확인)
  - [7.2 메트릭 노출 설정](#72-메트릭-노출-설정)
  - [7.3 메트릭 노출 확인](#73-메트릭-노출-확인)
  - [7.4 Prometheus scrape 설정 예시](#74-prometheus-scrape-설정-예시)
- [8. 최종 상태 확인](#8-최종-상태-확인)
- [9. 운영 — 디스크 관리](#9-운영--디스크-관리)
  - [9.1 디스크 사용량 점검](#91-디스크-사용량-점검)
  - [9.2 미사용 컨테이너 이미지 정리](#92-미사용-컨테이너-이미지-정리)
  - [9.3 디스크 설정 전체 요약](#93-디스크-설정-전체-요약)
- [10. 결론](#10-결론)
  - [구축된 클러스터의 주요 컴포넌트 요약](#구축된-클러스터의-주요-컴포넌트-요약)
  - [K3s의 장점](#k3s의-장점)
  - [추가 권장사항](#추가-권장사항)
- [부록 A. kubelet 파라미터 설치 후 적용](#부록-a-kubelet-파라미터-설치-후-적용)


본 문서는 K3s를 사용하여 온프레미스 환경에 **운영 수준의 Kubernetes 클러스터**를 구성하는 가이드입니다. Master 노드 3개(HA) + Worker 노드 3개 구성으로 고가용성 클러스터를 구축하고, NFS StorageClass · MetalLB · Nginx Ingress 등 기본 컴포넌트를 수동으로 설치하는 전 과정을 다룹니다.

K3s는 Rancher Labs에서 개발한 경량 Kubernetes 배포판으로, 단일 바이너리로 배포 가능한 Kubernetes입니다. 기존 Kubernetes보다 메모리와 CPU 사용량이 낮아 리소스가 제한된 환경(예: IoT, 엣지 컴퓨팅, 개발 환경)에서 효율적으로 작동하며, 표준 Kubernetes API를 지원하므로 기존 도구와 호환됩니다. K3s는 개발, 테스트, 그리고 소규모 프로덕션 환경에서 널리 사용되며, 내장된 보안 기능과 쉬운 설치로 운영 환경에서도 채택되고 있습니다.

## 1. 사전 준비 (모든 노드 공통)

### 1.1 노드 요건

| 구분 | 수량 | OS | CPU | Memory | Disk |
|------|------|----|-----|--------|------|
| Master | 3 | Ubuntu 22.04 LTS | 4 vCPU | 8GB | 100GB |
| Worker | 3 | Ubuntu 22.04 LTS | 4 vCPU | 8GB | 100GB |
| LB/Proxy | 1 | Ubuntu 22.04 LTS | 2 vCPU | 2GB | - |

운영 수준에서는 API 서버 HA를 위해 master 노드 앞에 LB/Proxy 서버(HAProxy, Nginx, keepalived 등)가 별도로 필요합니다. 없으면 특정 master IP를 직접 지정하게 되어 해당 노드 장애 시 kubectl 및 신규 노드 조인이 불가합니다.

16GB 노드 사용 시 `system-reserved`를 `memory=512Mi`, `eviction-hard`를 `memory.available<1Gi`로 변경합니다 (1.3 참고).

### 1.2 기본 준비

```bash
# swap 비활성화
sudo swapoff -a

# fstab 수정 (재부팅 시에도 유지)
sudo sed -i '/swap/s/^/#/' /etc/fstab

# NFS 클라이언트 설치
sudo apt-get update && sudo apt-get install -y nfs-common curl
```

### 1.3 커널 모듈 로드

K3s Flannel 네트워킹에 필요한 커널 모듈을 로드합니다.

```bash
sudo modprobe br_netfilter
sudo modprobe overlay
sudo modprobe nf_conntrack

# 재부팅 후에도 유지
sudo tee /etc/modules-load.d/k8s.conf <<'EOF'
br_netfilter
overlay
nf_conntrack
EOF
```

### 1.4 커널 파라미터 (sysctl) 튜닝

운영 수준의 커널 파라미터를 적용합니다. 값은 GKE/EKS 기본값 및 kubeadm 권장값 기준입니다.

```bash
sudo tee /etc/sysctl.d/99-k8s-tune.conf <<'EOF'
# K8s 네트워킹 필수
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1

# Connection tracking — GKE/EKS 기본값
net.netfilter.nf_conntrack_max      = 1048576

# Socket backlog
net.core.somaxconn                  = 32768

# TCP TIME_WAIT 소켓 재사용
net.ipv4.tcp_tw_reuse               = 1

# inotify — kubeadm 권장값
fs.inotify.max_user_watches         = 524288
fs.inotify.max_user_instances       = 8192
fs.inotify.max_queued_events        = 32768
EOF

sudo sysctl -p /etc/sysctl.d/99-k8s-tune.conf
```

| 파라미터 | 값 | 기준 |
|----------|-----|------|
| `nf_conntrack_max` | 1,048,576 | GKE / EKS 기본값 |
| `somaxconn` | 32,768 | 운영 서버 표준 |
| `tcp_tw_reuse` | 1 | 서버 환경 표준 |
| `inotify.max_user_watches` | 524,288 | kubeadm 권장값 |
| `inotify.max_user_instances` | 8,192 | kubeadm 권장값 |
| `inotify.max_queued_events` | 32,768 | kubeadm 권장값 |

### 1.5 kubelet 파라미터

K3s에서 kubelet은 내장되어 있으며 `--kubelet-arg`로 파라미터를 전달합니다.
자동 프로비저닝 시 `provision/02-master-init.sh`, `03-master-join.sh`, `04-worker-join.sh`에서 **노드 RAM을 자동 감지하여 설치 시점에 적용**됩니다.

수동 설치 시 각 노드 설치 커맨드에 포함됩니다 → [2.1.1](#211-첫-번째-master-node-cluster-init), [2.1.2](#212-추가-master-node-조인-master-2-master-3), [2.2](#22-worker-node-조인) 참고.

설치 후 변경이 필요한 경우 → [부록 A. kubelet 파라미터 설치 후 적용](#부록-a-kubelet-파라미터-설치-후-적용) 참고.

### 1.6 journald 로그 제한 (모든 노드)

컨테이너 로그와 별개로 systemd-journald가 수집하는 OS/서비스 로그도 제한합니다.
기본값은 디스크의 10%(수십 GB)까지 무제한 누적될 수 있으므로 반드시 설정합니다.

> 자동 프로비저닝 시 `provision/01-prereq.sh`에서 **모든 노드에 자동 적용**됩니다.

```bash
sudo mkdir -p /etc/systemd/journald.conf.d
sudo tee /etc/systemd/journald.conf.d/99-k8s-limit.conf <<'EOF'
[Journal]
SystemMaxUse=100M
RuntimeMaxUse=100M
EOF

sudo systemctl restart systemd-journald
```

설정 적용 확인:

```bash
journalctl --disk-usage
```

출력 예시:

```
Archived and active journals take up 98.5M in the file system.
```

> `SystemMaxUse`: 영구 저장소(`/var/log/journal`) 최대 사용량
> `RuntimeMaxUse`: tmpfs(`/run/log/journal`) 최대 사용량
> 즉시 축소가 필요하면 `sudo journalctl --vacuum-size=100M` 실행


## 2. K3s 클러스터 설치 및 노드 구성

### 2.1 Master Node 구성

설치 전 `API_SERVER_IP`를 결정합니다. 이후 모든 노드 조인과 kubeconfig에 이 값을 사용합니다.

```bash
# kube-vip 등 VIP가 있으면 VIP로, 없으면 master-1 IP로
API_SERVER_IP="<VIP 또는 MASTER01_IP>"
```

#### 2.1.1 첫 번째 Master Node (cluster-init)

`--cluster-init`으로 내장 etcd 기반 HA 클러스터를 초기화합니다. 이 명령은 **첫 번째 마스터에서만** 실행합니다.

```bash
# master-1 에서 실행
sudo curl -sfL https://get.K3s.io | sh -s - server \
  --cluster-init \
  --tls-san=$API_SERVER_IP \
  --disable=traefik \
  --disable=servicelb \
  --flannel-backend=vxlan \
  --etcd-expose-metrics \
  --node-taint node-role.kubernetes.io/control-plane=:NoSchedule \
  --kube-scheduler-arg=bind-address=0.0.0.0 \
  --kube-scheduler-arg=authorization-always-allow-paths=/metrics \
  --kubelet-arg=kube-reserved=cpu=500m,memory=1Gi \
  --kubelet-arg=system-reserved=cpu=200m,memory=256Mi \
  --kubelet-arg=eviction-hard=memory.available<500Mi,nodefs.available<10%,imagefs.available<10%,nodefs.inodesFree<5% \
  --kubelet-arg=container-log-max-size=10Mi \
  --kubelet-arg=container-log-max-files=3 \
  --kubelet-arg=image-gc-high-threshold=80 \
  --kubelet-arg=image-gc-low-threshold=70

# 토큰 조회 (master-2, master-3 조인 시 사용)
sudo cat /var/lib/rancher/K3s/server/node-token
# 예: K10ea6ad1b45...::server:7604d858...
```

#### 2.1.2 추가 Master Node 조인 (master-2, master-3)

두 번째, 세 번째 마스터는 `--server`로 첫 번째 마스터에 조인합니다.

```bash
# master-2, master-3 각각에서 실행
sudo curl -sfL https://get.K3s.io | K3s_TOKEN="<MASTER01_TOKEN>" sh -s - server \
  --server https://$API_SERVER_IP:6443 \
  --disable=traefik \
  --disable=servicelb \
  --flannel-backend=vxlan \
  --etcd-expose-metrics \
  --node-taint node-role.kubernetes.io/control-plane=:NoSchedule \
  --kube-scheduler-arg=bind-address=0.0.0.0 \
  --kube-scheduler-arg=authorization-always-allow-paths=/metrics \
  --kubelet-arg=kube-reserved=cpu=500m,memory=1Gi \
  --kubelet-arg=system-reserved=cpu=200m,memory=256Mi \
  --kubelet-arg=eviction-hard=memory.available<500Mi,nodefs.available<10%,imagefs.available<10%,nodefs.inodesFree<5% \
  --kubelet-arg=container-log-max-size=10Mi \
  --kubelet-arg=container-log-max-files=3 \
  --kubelet-arg=image-gc-high-threshold=80 \
  --kubelet-arg=image-gc-low-threshold=70
```

조인 완료 후 master-1에서 etcd 멤버 목록을 확인합니다:

```bash
sudo K3s kubectl get nodes
```

출력 예시:

```
NAME       STATUS   ROLES                       AGE   VERSION
master-1   Ready    control-plane,etcd          44h   v1.34.5+K3s1
master-2   Ready    control-plane,etcd          43h   v1.34.5+K3s1
master-3   Ready    control-plane,etcd          43h   v1.34.5+K3s1
```

#### 2.1.3 etcd 스냅샷 보관 설정

모든 마스터 노드 조인 완료 후 스냅샷 보관 설정을 적용합니다. K3s는 기본 **6시간마다 자동 스냅샷**을 생성하고 **5개**를 보관합니다. 스냅샷 파일은 `/var/lib/rancher/K3s/server/db/snapshots/`에 저장되며 파일당 수십~수백 MB에 달합니다.

**모든 Master 노드**에서 실행합니다:

```bash
sudo tee -a /etc/rancher/K3s/config.yaml <<'EOF'

# etcd 스냅샷 보관 설정
etcd-snapshot-retention: 3
etcd-snapshot-schedule-cron: "0 */6 * * *"
EOF

sudo systemctl restart K3s
```

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
| `etcd-snapshot-schedule-cron` | `0 */6 * * *` | `0 */6 * * *` | 기본값 유지 |

### 2.2 Worker Node 조인

각 워커 노드(3개)에서 아래 명령어를 실행합니다. (TOKEN을 환경에 맞게 수정)

```bash
sudo curl -sfL https://get.K3s.io | K3s_TOKEN="<MASTER01_TOKEN>" sh -s - agent \
  --server https://$API_SERVER_IP:6443 \
  --kubelet-arg=kube-reserved=cpu=200m,memory=256Mi \
  --kubelet-arg=system-reserved=cpu=200m,memory=256Mi \
  --kubelet-arg=eviction-hard=memory.available<500Mi,nodefs.available<10%,imagefs.available<10%,nodefs.inodesFree<5% \
  --kubelet-arg=container-log-max-size=10Mi \
  --kubelet-arg=container-log-max-files=3 \
  --kubelet-arg=image-gc-high-threshold=80 \
  --kubelet-arg=image-gc-low-threshold=70
```

> 16GB 노드의 경우 `system-reserved`를 `memory=512Mi`, `eviction-hard`를 `memory.available<1Gi`로 변경합니다.

### 2.3 Kubeconfig 및 프로필 설정 (Master)

```bash
mkdir -p ~/.kube
sudo cp /etc/rancher/K3s/K3s.yaml ~/.kube/config
sudo chown $USER:$USER ~/.kube/config

# 환경 변수 및 자동 완성 적용
echo 'export KUBECONFIG=~/.kube/config' >> ~/.bashrc
source <(kubectl completion bash)
```

### 2.4 Master Node 스케줄링 제외

`--node-taint node-role.kubernetes.io/control-plane=:NoSchedule`이 설치 시 적용되므로 별도 작업이 필요 없습니다.

적용 여부를 확인합니다:

```bash
kubectl describe nodes master-1 master-2 master-3 | grep Taints
```

출력 예시:

```
Taints: node-role.kubernetes.io/control-plane:NoSchedule
Taints: node-role.kubernetes.io/control-plane:NoSchedule
Taints: node-role.kubernetes.io/control-plane:NoSchedule
```

### 2.5 클러스터 상태 확인

Kubeconfig 설정이 완료되면 클러스터 상태를 확인합니다:

```bash
# 클러스터 정보 확인
kubectl cluster-info
```

출력 예시:

```
Kubernetes control plane is running at https://<MASTER_IP>:6443
CoreDNS is running at https://<MASTER_IP>:6443/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy
Metrics-server is running at https://<MASTER_IP>:6443/api/v1/namespaces/kube-system/services/https:metrics-server:https/proxy

To further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.
```

```bash
# 노드 상태 확인 (Master 3개 HA, Worker 3개)
kubectl get nodes
```

출력 예시:

```
NAME       STATUS   ROLES                  AGE   VERSION
master-1   Ready    control-plane,etcd     44h   v1.34.5+K3s1
master-2   Ready    control-plane,etcd     43h   v1.34.5+K3s1
master-3   Ready    control-plane,etcd     43h   v1.34.5+K3s1
worker-1   Ready    <none>                 23h   v1.34.5+K3s1
worker-2   Ready    <none>                 23h   v1.34.5+K3s1
worker-3   Ready    <none>                 22h   v1.34.5+K3s1
```

## 3. NFS 서버 설치

### 3.1 NFS 클라이언트 설치 (모든 노드)

```bash
sudo apt-get update && sudo apt-get install -y nfs-common
```

### 3.2 Helm 리포지토리 추가

NFS 서버 및 프로비저너를 위한 Helm 리포지토리를 추가합니다:

```bash
helm repo add nfs-ganesha-server-and-external-provisioner https://kubernetes-sigs.github.io/nfs-ganesha-server-and-external-provisioner/
helm repo update
```

### 3.3 NFS 서버 설치

NFS 서버를 Helm을 사용하여 설치합니다 (persistence 비활성화, 기본 StorageClass로 설정하지 않음):

> **⚠️ 주의**: NFS 서버가 클러스터 내부 Pod로 실행되므로 해당 노드 장애 시 모든 PVC가 중단됩니다 (SPOF).
> 운영 환경에서는 외부 NFS 서버 또는 분산 스토리지([Longhorn](https://longhorn.io/) 권장)를 사용하세요.

NFS v4 프로토콜 기반으로 storageClass를 클래스를 구성하도록 values.yaml을 작성합니다.

```bash
cat > nfs-v4-values.yaml <<'EOF'
# 기존 설정 유지
persistence:
  enabled: true
  storageClass: local-path
  size: 50Gi

storageClass:
  name: nfs
  defaultClass: true
  # NFS v4.1로 변경 (핵심!)
  mountOptions:
    - nfsvers=4.1
    - hard
    - timeo=600
    - retrans=2
    - rsize=1048576
    - wsize=1048576
    - noatime
    - nodiratime

nodeSelector:
  node-role.kubernetes.io/control-plane: "true"

tolerations:
  - key: node-role.kubernetes.io/control-plane
    operator: Exists
    effect: NoSchedule
EOF
```

Helm Chart로 NFS Server와 StorageClass를 설치합니다.

```bash
helm install nfs-server nfs-ganesha-server-and-external-provisioner/nfs-server-provisioner \
  --namespace kube-system \
  -f nfs-v4-values.yaml
```

기본 StorageClass를 'local-path'에서 'nfs'로 변경합니다:

```bash
kubectl patch storageclass local-path -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"false"}}}'
```

## 4. MetalLB 설정

Helm을 사용하여 MetalLB를 metallb-system 네임스페이스에 설치하고 IP Pool을 구성합니다.

```bash
helm repo add metallb https://metallb.github.io/metallb
helm repo update
helm install metallb metallb/metallb \
    --version 0.14.9 \
    --namespace metallb-system \
    --create-namespace

# MetalLB 리소스 배포
kubectl apply -f - <<EOF
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: ip-pool
  namespace: metallb-system
spec:
  addresses:
  -  192.168.0.220-192.168.0.230
  autoAssign: true
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: l2-network
  namespace: metallb-system
spec:
  ipAddressPools:
    - ip-pool
EOF
```

> **L2 모드 한계**: speaker가 선거로 대표 노드 1개를 선출하여 IP를 소유합니다. 대표 노드 장애 시 재선거 동안 수초 다운타임이 발생합니다.

### BGP 모드 (BGP 라우터가 있는 경우 활성화)

> 모든 speaker가 라우터와 직접 peering — 선거 없이 즉시 failover, 노드 간 부하 분산 가능.
> MikroTik, FRRouting 등 BGP 지원 라우터 필요.

```bash
# L2Advertisement 대신 아래 리소스를 적용
kubectl apply -f - <<EOF
apiVersion: metallb.io/v1beta2
kind: BGPPeer
metadata:
  name: router
  namespace: metallb-system
spec:
  myASN: 64512          # 클러스터 ASN (사설: 64512-65534)
  peerASN: 64513        # 라우터 ASN
  peerAddress: 192.168.0.1  # 라우터 IP
---
apiVersion: metallb.io/v1beta1
kind: BGPAdvertisement
metadata:
  name: bgp-network
  namespace: metallb-system
spec:
  ipAddressPools:
    - ip-pool
EOF
```

## 5. Nginx Ingress 설정

Helm을 사용하여 Nginx Ingress를 설치합니다.

```bash
rm -rf kustomize/base/helm
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm pull ingress-nginx/ingress-nginx \
    --version 4.14.1 \
    --untar \
    --destination kustomize/base/helm

# Nginx Ingress 설치
helm install ingress-nginx ingress-nginx/ingress-nginx \
    --version 4.14.1 \
    --namespace ingress-nginx \
    --create-namespace \
    --values nginx-values.yaml
```

values.yaml 파일을 다음과 같이 구성합니다:

```bash
cat > nginx-values.yaml <<EOF
fullnameOverride: ingress-nginx

controller:
  replicaCount: 1
  progressDeadlineSeconds: 600 
  service:
    type: LoadBalancer
    annotations:
      service.beta.kubernetes.io/aws-load-balancer-scheme: internet-facing
      service.beta.kubernetes.io/aws-load-balancer-target-type: ip
  resources:
    requests:
      cpu: 100m
      memory: 90Mi
  admissionWebhooks:
    enabled: true
    certManager:
      enabled: false
      clusterIssuer: "selfsigned-issuer"
  config:
    allow-snippet-annotations: "true"
    annotations-risk-level: "Critical"

  ingressClass: nginx
  ingressClassResource:
    name: nginx
    enabled: true
    default: true   # default

  extraArgs:
    watch-ingress-without-class: "true"
EOF
```

## 6. Ingress 리소스 배포 예제

Nginx Ingress가 설치된 후, Ingress 리소스를 만들어 서비스를 외부에 노출합니다.

### 6.1 테스트 애플리케이션 배포

먼저, 테스트할 애플리케이션을 배포합니다.

```bash
# Nginx 애플리케이션 배포
kubectl create deployment nginx-test --image=nginx
kubectl expose deployment nginx-test --port=80

# 배포 확인
kubectl get pods
kubectl get svc
```

### 6.2 Ingress 리소스 생성 및 배포

Ingress 리소스를 생성하여 외부에서 서비스에 접근할 수 있도록 합니다.

```bash
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: nginx-test-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
  - host: test.cnapcloud.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: nginx-test
            port:
              number: 80
EOF
```

Ingress가 정상적으로 생성되었는지 확인합니다:

```bash
kubectl get ingress
```

### 6.3 Nginx Ingress LoadBalancer IP 확인 및 호스트 등록

Nginx Ingress의 LoadBalancer IP를 확인하고, 로컬 호스트 파일에 등록하여 접속합니다.

```bash
# Nginx Ingress 서비스의 EXTERNAL-IP 확인
kubectl get svc -n ingress-nginx

# 예: EXTERNAL-IP가 192.168.0.221이라고 가정
# 로컬 호스트 파일에 등록 (관리자 권한 필요)
echo "192.168.0.221 test.cnapcloud.com" | sudo tee -a /etc/hosts
```

### 6.4 접속 테스트

웹 브라우저나 curl을 사용하여 Ingress를 통해 서비스에 접속합니다.

```bash
# curl로 테스트
curl http://test.cnapcloud.com

# 또는 웹 브라우저에서 http://test.cnapcloud.com 접속
```

## 7. 메트릭 설정 (Prometheus 연동)

K3s 내장 etcd 및 kube-scheduler의 메트릭을 Prometheus가 수집할 수 있도록 노출합니다.
자동 프로저닝이나 초기 설치에 `--K3s-extra-args`에 메트릭 설정을 포함한 경우는 **7.2는 스킵**합니다.

```
--etcd-expose-metrics
--kube-scheduler-arg=bind-address=0.0.0.0
--kube-scheduler-arg=authorization-always-allow-paths=/metrics
```

### 7.1 etcd 멤버 확인

```bash
sudo K3s kubectl get nodes
```

### 7.2 메트릭 노출 설정

수동으로 적용할 경우 `/etc/rancher/K3s/config.yaml`에 추가 후 재시작합니다.

```yaml
etcd-expose-metrics: true
kube-scheduler-arg:
  - "bind-address=0.0.0.0"
  - "authorization-always-allow-paths=/metrics"
```

```bash
sudo systemctl restart K3s
```

> **포트**: etcd 메트릭 **2381**, kube-scheduler 메트릭 **10259** (HTTPS)

### 7.3 메트릭 노출 확인

```bash
curl -L http://<MASTER_IP>:2381/metrics | head -n 10
curl -k https://<MASTER_IP>:10259/metrics | head -n 10
```

출력 예시:

```
# TYPE aggregator_unavailable_apiservice gauge
aggregator_unavailable_apiservice{name="v1."} 0
aggregator_unavailable_apiservice{name="v1.acme.cert-manager.io"} 0
aggregator_unavailable_apiservice{name="v1.admissionregistration.k8s.io"} 0
aggregator_unavailable_apiservice{name="v1.apiextensions.k8s.io"} 0
aggregator_unavailable_apiservice{name="v1.apm.k8s.elastic.co"} 0
aggregator_unavailable_apiservice{name="v1.apps"} 0
```

### 7.4 Prometheus scrape 설정 예시

Prometheus `prometheus.yml`에 아래 job을 추가합니다.

```yaml
scrape_configs:
  - job_name: 'K3s-etcd'
    static_configs:
      - targets: ['<MASTER_IP>:2381']
```

## 8. 최종 상태 확인

```bash
# 노드 상태 확인 (Master 3개 HA, Worker 3개)
kubectl get nodes

# 모든 파드 상태 확인
kubectl get pods -A

# StorageClass 확인
kubectl get sc

# Ingress 확인
kubectl get ingress
```

## 9. 운영 — 디스크 관리

### 9.1 디스크 사용량 점검

```bash
# 노드 전체 디스크 사용량
df -h

# K3s 데이터 디렉터리별 사용량
sudo du -sh /var/lib/rancher/K3s/server/db/snapshots/   # etcd 스냅샷
sudo du -sh /var/lib/rancher/K3s/agent/containerd/       # 컨테이너 이미지/레이어
sudo du -sh /var/log/pods/                               # 컨테이너 로그 심볼릭 링크

# journald 사용량
journalctl --disk-usage
```

### 9.2 미사용 컨테이너 이미지 정리

kubelet image GC가 자동 정리하지만 수동으로 즉시 정리가 필요한 경우:

```bash
# 미사용 이미지 전체 삭제
sudo K3s crictl rmi --prune

# 현재 이미지 목록 확인
sudo K3s crictl images

# 현재 실행 중인 컨테이너 확인
sudo K3s crictl ps
```

### 9.3 디스크 설정 전체 요약

| 항목 | 기본값 | 운영 설정 | 설정 위치 |
|------|--------|-----------|-----------|
| 컨테이너 로그 크기 | 무제한 | `10Mi × 3개` | kubelet-arg |
| 이미지 GC 시작 임계값 | 85% | 80% | kubelet-arg |
| 이미지 GC 목표 임계값 | 80% | 70% | kubelet-arg |
| imagefs eviction | 미설정 | 10% | kubelet-arg |
| inode eviction | 미설정 | 5% | kubelet-arg |
| journald 로그 | 디스크 10% | 100M | journald.conf |
| etcd 스냅샷 보관 수 | 5개 | 3개 | config.yaml |
| etcd 스냅샷 주기 | 6시간 | 12시간 | config.yaml |

## 10. 결론

이 가이드를 통해 Ubuntu 24.04 환경에서 K3s를 활용한 경량 Kubernetes 클러스터를 성공적으로 구축하고, NFS 스토리지, MetalLB 로드 밸런서, Nginx Ingress를 설정하는 방법을 배웠습니다. K3s는 리소스 제약이 있는 환경에서도 효율적으로 작동하는 경량 Kubernetes 배포판으로, 개발 및 테스트 환경에 이상적입니다.

### 구축된 클러스터의 주요 컴포넌트 요약

- **K3s 클러스터**: Master 3개(HA etcd), Worker 3개로 구성된 고가용성 클러스터
- **NFS StorageClass**: 영구 스토리지를 위한 NFS 서버 및 프로비저너
- **MetalLB**: LoadBalancer 타입 서비스를 위한 IP 주소 할당
- **Nginx Ingress**: 외부 트래픽을 클러스터 내부 서비스로 라우팅

### K3s의 장점

- **경량성**: 단일 바이너리로 배포 가능, 메모리와 CPU 사용량이 낮음
- **쉬운 설치**: 복잡한 구성 없이 빠르게 클러스터 구축 가능
- **호환성**: 표준 Kubernetes API 지원으로 기존 도구와 통합 용이
- **보안**: 내장된 보안 기능으로 안전한 운영 환경 제공

### 추가 권장사항

- **모니터링**: Prometheus와 Grafana를 추가하여 클러스터 상태 모니터링
- **보안 강화**: RBAC, 네트워크 정책, 그리고 정기적인 업데이트 적용
- **백업**: etcd 데이터와 중요 구성의 정기 백업
- **확장성**: 필요에 따라 노드 추가 또는 고급 기능(예: cert-manager) 통합

이 가이드를 따라 구축한 클러스터는 개발, 테스트, 그리고 소규모 프로덕션 환경에 적합합니다. Kubernetes 생태계를 탐구하는 첫 걸음으로 활용하시길 바랍니다. 추가 질문이나 개선사항이 있으시면 언제든지 문의해 주세요!

---

## 부록 A. kubelet 파라미터 설치 후 적용

설치 후 kubelet 파라미터를 변경해야 하는 경우 `/etc/rancher/K3s/config.yaml`에 추가하고 재시작합니다.
Master와 Worker 모두 동일하게 적용하며, `kube-reserved` 값과 재시작 커맨드만 다릅니다.

> Master: `kube-reserved=cpu=500m,memory=1Gi` — 컨트롤 플레인 컴포넌트(etcd, API server, scheduler 등)가 함께 동작하므로 더 많이 예약
> Worker: `kube-reserved=cpu=200m,memory=256Mi` — 워크로드(pod)만 실행하므로 예약량 축소

```bash
sudo tee -a /etc/rancher/K3s/config.yaml <<'EOF'

kubelet-arg:
  - "kube-reserved=cpu=500m,memory=1Gi"    # master: 500m/1Gi | worker: 200m/256Mi
  - "system-reserved=cpu=200m,memory=256Mi"
  - "eviction-hard=memory.available<500Mi,nodefs.available<10%,imagefs.available<10%,nodefs.inodesFree<5%"
  - "container-log-max-size=10Mi"
  - "container-log-max-files=3"
  - "image-gc-high-threshold=80"
  - "image-gc-low-threshold=70"
EOF

# master
sudo systemctl restart K3s
# worker
sudo systemctl restart K3s-agent
```

> 16GB 노드의 경우 `system-reserved`를 `memory=512Mi`, `eviction-hard`를 `memory.available<1Gi`로 변경합니다.

설정 적용 확인:

```bash
sudo cat /proc/$(pgrep -f "K3s server")/cmdline | tr '\0' '\n' | grep kubelet
```

**kubelet 기본값과 운영 설정 비교**

| 파라미터 | kubelet 기본값 | 운영 설정 | 이유 |
|----------|--------------|-----------|------|
| `kube-reserved` | 미설정 | cpu=200~500m, memory=256Mi~1Gi | 미설정 시 app pod와 리소스 경쟁 — kubelet 자체가 OOM으로 죽을 수 있음 |
| `system-reserved` | 미설정 | cpu=200m, memory=256~512Mi | 미설정 시 OOM 발생 시 OS 프로세스도 희생 가능 |
| `eviction-hard.memory.available` | `100Mi` | `500Mi` / `1Gi` | 기본값 100Mi는 너무 낮음 — 퇴거 전에 이미 노드가 불안정해짐 |
| `eviction-hard.nodefs.available` | `10%` | `10%` (유지) | 기본값 적절 |
| `eviction-hard.imagefs.available` | 미설정 | `10%` | 이미지 파티션 eviction 트리거 없으면 이미지 쌓임 |
| `eviction-hard.nodefs.inodesFree` | 미설정 | `5%` | inode 고갈 시 파일 생성 불가 — pod 크래시 유발 |
| `container-log-max-size` | `10Mi` | `10Mi` | 컨테이너 로그 파일 1개 최대 크기 |
| `container-log-max-files` | `5` | `3` | 로테이션 보관 파일 수 축소 (디스크 절약) |
| `image-gc-high-threshold` | `85` | `80` | 디스크 80% 초과 시 미사용 이미지 GC 시작 |
| `image-gc-low-threshold` | `80` | `70` | GC 후 목표 사용률 — 70%까지 정리 |

> `kube-reserved` + `system-reserved`를 설정하지 않으면 노드 전체 메모리를 app pod가 점유할 수 있고,
> 메모리 부족 시 kubelet이 OOM Killer에 의해 종료되어 노드가 NotReady 상태가 됩니다.
