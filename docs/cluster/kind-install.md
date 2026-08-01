---
title: "Kind 클러스터 설치(수동)"
sidebar_position: 6
---

**목차**
- [1. 전제 조건](#1-전제-조건)
  - [1.1 Kind 및 kubectl 설치](#11-kind-및-kubectl-설치)
  - [1.2 시스템 요구사항](#12-시스템-요구사항)
- [2. Kind 클러스터 생성](#2-kind-클러스터-생성)
  - [2.1 클러스터 구성 파일](#21-클러스터-구성-파일)
  - [2.2 클러스터 생성](#22-클러스터-생성)
  - [2.3 노드 레이블 추가](#23-노드-레이블-추가)
  - [2.4 자동 재시작 설정](#24-자동-재시작-설정)
  - [2.5 Insecure Registry 설정](#25-insecure-registry-설정)
- [3. 추가 구성](#3-추가-구성)
  - [3.1 Ingress Controller 설정](#31-ingress-controller-설정)
  - [3.2 DNS 설정](#32-dns-설정)
- [4. NFS 스토리지 설정](#4-nfs-스토리지-설정)
  - [4.1 Helm 리포지토리 추가](#41-helm-리포지토리-추가)
  - [4.2 NFS 클라이언트 설치](#42-nfs-클라이언트-설치)
  - [4.3 NFS 서버 설치](#43-nfs-서버-설치)
  - [4.5 설치 확인](#45-설치-확인)
  - [4.6 테스트 PVC 생성](#46-테스트-pvc-생성)
- [5. 예제 배포](#5-예제-배포)
  - [5.1 간단한 Nginx 앱 배포](#51-간단한-nginx-앱-배포)
  - [5.2 테스트용 Curl Pod 생성](#52-테스트용-curl-pod-생성)
  - [5.3 PVC 및 Pod 예제](#53-pvc-및-pod-예제)
  - [5.4 Ingress 예제](#54-ingress-예제)
- [6. 클러스터 삭제](#6-클러스터-삭제)
- [7. 참고 자료](#7-참고-자료)

이 문서는 ARM64 Linux 환경에서 Kind(Kubernetes in Docker)를 사용하여 로컬 Kubernetes 클러스터를 빠르게 설치하고 설정하는 **수동 설치 가이드**입니다.

> **자동 프로비저닝(스크립트)**: [kind-provision](kind-provision.md)


## 1. 전제 조건

### 1.1 Kind 및 kubectl 설치

**Kind**(Kubernetes in Docker)를 설치하여 로컬 테스트 및 개발용 Kubernetes 클러스터를 생성합니다.

```bash
curl -Lo ./kind https://github.com/kubernetes-sigs/kind/releases/download/v0.27.0/kind-linux-arm64
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind
```

다음으로, Kubernetes 클러스터와 상호작용하기 위한 명령줄 도구인 **kubectl**을 설치합니다.

```bash
KUBECTL_VERSION="v1.30.0"
curl -sLO "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/arm64/kubectl"
sudo mv kubectl /usr/local/bin/
sudo chmod +x /usr/local/bin/kubectl
```

### 1.2 시스템 요구사항

- Docker가 설치되고 실행 중이어야 합니다.
- Raspberry Pi 5를 사용하는 경우, `/boot/firmware/cmdline.txt` 파일 끝에 다음을 추가하고 재부팅하세요:
  ```bash
  cgroup_enable=cpuset cgroup_memory=1 cgroup_enable=memory systemd.unified_cgroup_hierarchy=0
  ```

## 2. Kind 클러스터 생성

### 2.1 클러스터 구성 파일

이 폴더에는 `kind-4nodes.yaml` 파일이 포함되어 있으며, 다음과 같은 구성을 제공합니다:

- **1개의 control-plane 노드**: Ingress 준비 레이블 및 포트 매핑 (80, 443)
- **4개의 worker 노드**: insecure registry 설정을 위한 certs.d 마운트
- **네트워킹**: API 서버 주소 및 포트 설정
- **Containerd 설정**: Registry 구성 패치

### 2.2 클러스터 생성

제공된 구성 파일을 사용하여 Kubernetes 클러스터를 생성합니다.

```bash
kind create cluster --name kind --config ./kind-4nodes.yaml --image kindest/node:v1.34.0
```

### 2.3 노드 레이블 추가

클러스터 생성 후, 노드에 추가 레이블을 부여하여 시스템 및 플랫폼 노드를 구분합니다.

다음 스크립트를 사용하여 control-plane 노드에 `node-role.kubernetes.io/system=true` 레이블을, worker 노드에 `node-role.kubernetes.io/platform=true` 레이블을 추가합니다:

```bash
for node in $(kubectl get nodes -o name | sed 's|node/||'); do
  if [[ "$node" != "kind-control-plane" ]]; then
    kubectl label node "$node" node-role.kubernetes.io/system=true --overwrite
    kubectl label node "$node" node-role.kubernetes.io/platform=true --overwrite
  fi
done
```

레이블이 정상적으로 추가되었는지 확인합니다:

```bash
kubectl get nodes --show-labels
```

### 2.4 자동 재시작 설정

Kind 노드 컨테이너가 시스템 재부팅 시 자동으로 시작되도록 설정합니다.

```bash
docker ps -a --filter "name=^kind-" --format "{{.Names}}" \
| xargs -r -n1 docker update --restart unless-stopped
```

### 2.5 Insecure Registry 설정

Kind에서 보안되지 않은 컨테이너 레지스트리를 사용하려면 `certs.d/<domain>/hosts.toml` 파일을 수정해야 합니다.``

이 폴더에는 `certs.d/harbor.cnapcloud.com/hosts.toml` 파일이 포함되어 있으며, Harbor 레지스트리를 위한 설정 예시입니다:

```toml
server = "https://harbor.cnapcloud.com"

[host."https://harbor.cnapcloud.com"]
  capabilities = ["pull", "resolve"]
  skip_verify = true
```

또한 DNS 서버를 kind worker가 접근하지 못하는 경우, 각 kind-worker의 /etc/hosts 파일에 Harbor Registry를 등록하세요.
```bash
$ docker exec -it kind-worker[,2,3,4] bash
root@kind-worker:/#  sh -c 'echo "<DOCKER_HOST_IP> harbor.cnapcloud.com" >> /etc/hosts'
```

## 3. 추가 구성

### 3.1 Ingress Controller 설정

Nginx Ingress Controller를 배포하여 클러스터 외부에서 서비스에 접근할 수 있도록 합니다.

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/refs/tags/helm-chart-4.9.0/deploy/static/provider/kind/deploy.yaml
```

선택적으로, Ingress Controller ConfigMap에서 snippet annotations를 활성화합니다:

```bash
kubectl -n ingress-nginx edit cm ingress-nginx-controller
```

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ingress-nginx-controller
  namespace: ingress-nginx
data:
  allow-snippet-annotations: "true"
  annotations-risk-level: "Critical"
```

```bash
kubectl -n ingress-nginx rollout restart deploy ingress-nginx-controller
```

**참고**: GitOps의 `ingress-nginx` 모듈을 사용할 경우 Ingress Controller 배포 전 아래 선행 작업이 필요합니다.

1. GPG 암호화 구성 (Cloudflare DNS Issuer API 토큰 등)
2. reflector 설치 (Certificate가 생성한 Secret 복제)
3. cert-manager 설치

이후, `ingress-nginx/kustomize/overlays/dev-public/helm/values.yaml`에서 하단의 주석을 제거하면 Control Plane 노드에 Ingress Controller가 정상적으로 배포됩니다.

### 3.2 DNS 설정

Kind의 Docker DNS(172.18.0.1)는 일반 재귀 해석은 수행하지만 SOA 조회와 같은 권한 있는 쿼리를 올바르게 처리하지 않습니다. 따라서 Cert-Manager의 DNS-01 챌린지가 요구하는 SOA 검사를 위해 CoreDNS ConfigMap을 수정하여 DNS 쿼리를 공용 리졸버로 전달해야 합니다.

이를 위해 CoreDNS ConfigMap에 다음과 같이 Forward DNS Server를 구성합니다.

```text
kubectl -n kube-system edit cm coredns

forward . 1.1.1.1 1.0.0.1 {
    max_concurrent 1000 
    policy sequential # localdns 서버를 사용하는 경우 추가(default는 random 또는 round_robin)
}
```

ConfigMap을 저장하면 CoreDNS가 자동으로 reload 되지만, 반영이 바로 되지 않을 경우 아래 명령어로 수동 재시작할 수 있습니다.

``` bash
kubectl -n kube-system rollout restart deployment coredns
```

## 4. NFS 스토리지 설정

### 4.1 Helm 리포지토리 추가

NFS 서버 및 프로비저너를 위한 Helm 리포지토리를 추가합니다:

```bash
helm repo add nfs-ganesha-server-and-external-provisioner https://kubernetes-sigs.github.io/nfs-ganesha-server-and-external-provisioner/
helm repo update
```

### 4.2 NFS 클라이언트 설치

모든 Kind 노드에 NFS 클라이언트를 설치합니다:

```bash
for node in $(kind get nodes); do
  echo "Installing nfs-common on $node"
  docker exec $node bash -c "apt-get update && apt-get install -y nfs-common"
done
```

### 4.3 NFS 서버 설치

NFS 서버를 Helm을 사용하여 설치합니다 (persistence 비활성화, 기본 StorageClass로 설정하지 않음):

NFS v4 프로토콜 기반으로 storageClass를 구성하는 values 파일은 `provision/nfs-values.yaml`을 사용합니다.

Helm Chart로 NFS Server와 StorageClass를 설치합니다.
```bash
helm install nfs-server nfs-ganesha-server-and-external-provisioner/nfs-server-provisioner \
  --namespace kube-system \
  -f provision/nfs-values.yaml
```

기본 StorageClass를 'standard'에서 'nfs'로 변경합니다:
```bash
kubectl patch storageclass standard -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"false"}}}'
```

### 4.5 설치 확인

NFS 서버가 정상적으로 설치되었는지 확인합니다:

```bash
kubectl -n kube-system get pods -w
```

StorageClass가 생성되었는지 확인합니다:

```bash
kubectl get sc
```

### 4.6 테스트 PVC 생성

NFS 스토리지를 테스트하기 위한 PVC를 생성합니다:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-pvc
  namespace: default
spec:
  storageClassName: nfs
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 1Gi
EOF
```

PVC 상태를 확인합니다:

```bash
kubectl -n default get pvc
```


## 5. 예제 배포

이 폴더의 `examples/` 디렉토리에는 기본적인 Kubernetes 리소스 예제가 포함되어 있습니다.

### 5.1 간단한 Nginx 앱 배포

Nginx 배포를 생성하고 ClusterIP 서비스로 노출합니다.

```bash
kubectl create deploy nginx --image nginx
kubectl expose deploy nginx --type ClusterIP --port 80
```

### 5.2 테스트용 Curl Pod 생성

클러스터 내부에서 서비스 연결을 테스트하기 위한 curl pod를 생성합니다.

```bash
kubectl run curl --image=curlimages/curl:latest --restart=Never -- sleep infinity
kubectl exec -it curl -- curl http://nginx
```

### 5.3 PVC 및 Pod 예제

`examples/pvc.yaml`과 `examples/pod.yaml`을 사용하여 PersistentVolumeClaim과 이를 사용하는 Pod를 배포할 수 있습니다.

```bash
kubectl apply -f examples/pvc.yaml
kubectl apply -f examples/pod.yaml
```

### 5.4 Ingress 예제

`examples/ingress.yaml`을 사용하여 외부 접근을 위한 Ingress를 생성할 수 있습니다.

```bash
kubectl apply -f examples/ingress.yaml
```

## 6. 클러스터 삭제

실험이 끝나면 시스템 리소스를 확보하기 위해 Kind 클러스터를 안전하게 제거합니다.

```bash
kind delete cluster --name kind
```

## 7. 참고 자료

- [Kind 공식 문서](https://kind.sigs.k8s.io/)
- [Kubernetes kubectl](https://kubernetes.io/docs/reference/kubectl/)
- [Ingress-Nginx Kind 설정](https://kind.sigs.k8s.io/docs/user/ingress/)
- [Containerd Registry 설정](https://github.com/containerd/containerd/blob/main/docs/cri/registry.md)
