---
title: "MetalLB"
sidebar_position: 1
---

Kubernetes 클러스터에서 `LoadBalancer` 타입 서비스에 외부 IP를 할당하는 소프트웨어 로드밸런서입니다.

- **버전**: 0.14.9
- **네임스페이스**: `metallb-system`
- **의존성**: 없음

---

## 1. 개요

MetalLB는 베어메탈/로컬 환경(Kind 등)에서 클라우드 LoadBalancer를 대체합니다. L2 모드와 BGP 모드를 지원하며, 지정된 IP 대역에서 `LoadBalancer` 서비스에 IP를 할당합니다.

- **L2 모드**: ARP를 이용해 IP를 광고. 설정이 단순하며 별도 라우터 없이 동작
- **BGP 모드**: 라우터와 BGP 피어링을 맺어 IP를 광고. ECMP 라우팅으로 트래픽을 여러 노드에 분산 가능

---

## 2. 사전 요구사항

### L2 모드

`kube-proxy`의 `strictARP`가 활성화되어야 합니다.

```bash
kubectl get configmap kube-proxy -n kube-system -o yaml | \
  sed -e "s/strictARP: false/strictARP: true/" | \
  kubectl apply -f - -n kube-system
```

적용 확인:

```bash
kubectl get configmap kube-proxy -n kube-system -o yaml | grep strictARP
# strictARP: true
```

### BGP 모드

BGP를 지원하는 라우터(또는 소프트 라우터)가 필요합니다. `strictARP` 설정은 필요하지 않습니다.

---

## 3. 디렉터리 구조

```
metallb/
├── Makefile
├── helm/
│   └── values.yaml                        # Helm 렌더링 파라미터 (Prometheus 연동)
└── kustomize/
    ├── base/
    │   ├── kustomization.yaml
    │   ├── resources/
    │   │   ├── metallb.yaml               # IPAddressPool, L2/BGP 리소스 정의
    │   │   └── generated/                 # make manifests 결과물 (자동 생성)
    │   └── patches/
    │       └── metallb-specker.yaml        # Speaker DaemonSet 리소스 설정
    └── overlays/
        └── dev/
            └── kustomization.yaml         # 이미지 태그 고정
```

---

## 4. 배포

### 4.1 Namespace 생성

```bash
make namespace
```

### 4.2 패키지 준비

Helm 템플릿으로 매니페스트를 생성합니다.

```bash
make manifests
```

### 4.3 배포 설정

#### L2 모드: metallb.yaml

`kustomize/base/resources/metallb.yaml`의 `addresses` 항목을 환경에 맞게 수정합니다.

Kind 환경에서는 Docker 네트워크 대역을 먼저 확인합니다.

```bash
docker network inspect kind | grep Subnet
```

```yaml
# kustomize/base/resources/metallb.yaml
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: ip-pool
  namespace: metallb-system
spec:
  addresses:
  - <서브넷 대역 내 IP 범위>  # 예: 192.168.0.220-192.168.0.230
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
```

#### BGP 모드: metallb.yaml

L2 모드 대신 BGP를 사용할 경우 `metallb.yaml`을 아래와 같이 정의합니다.

**BGP 모드의 장점**:
- **트래픽 분산**: ECMP(Equal-Cost Multi-Path) 라우팅으로 L2 모드의 단일 노드 병목 해소
- **확장성**: 대규모 클러스터에서 수백 개의 서비스 IP를 효율적으로 광고 가능
- **페일오버 속도**: 노드 장애 시 BGP가 자동으로 경로를 재계산하므로 L2 ARP 방식보다 빠른 복구

> **주의**: BGP 모드는 BGP를 지원하는 라우터(또는 소프트 라우터)가 반드시 필요합니다. 라우터 없이는 피어링을 맺을 수 없어 IP 광고가 동작하지 않습니다.

```yaml
# kustomize/base/resources/metallb.yaml
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: ip-pool
  namespace: metallb-system
spec:
  addresses:
  - <할당할 IP 범위>  # 예: 10.0.0.220-10.0.0.230
  autoAssign: true
---
apiVersion: metallb.io/v1beta2
kind: BGPPeer
metadata:
  name: bgp-peer
  namespace: metallb-system
spec:
  myASN: 64500          # 클러스터(로컬) ASN
  peerASN: 64501        # 라우터(피어) ASN
  peerAddress: <라우터 IP>  # 예: 192.168.1.1
---
apiVersion: metallb.io/v1beta1
kind: BGPAdvertisement
metadata:
  name: bgp-advertisement
  namespace: metallb-system
spec:
  ipAddressPools:
    - ip-pool
```

> **Kind 환경**: Kind는 실제 BGP 라우터가 없으므로 BGP 모드 테스트는 별도의 소프트 라우터(예: [GoBGP](https://github.com/osrg/gobgp), [FRR](https://frrouting.org/)) 컨테이너가 필요합니다. 로컬 개발 환경에서는 L2 모드를 권장합니다.

#### helm/values.yaml

`helm/values.yaml` — `make manifests` 시 Helm 렌더링에 사용합니다. Prometheus ServiceMonitor·PrometheusRule을 활성화하고 `prometheus: main` 레이블로 수집 대상을 지정합니다.

```yaml
# helm/values.yaml
prometheus:
  serviceMonitor:
    enabled: true
    speaker:
      additionalLabels:
        prometheus: main
    controller:
      additionalLabels:
        prometheus: main
  prometheusRule:
    enabled: true
    additionalLabels:
      prometheus: main
```

#### patches/metallb-specker.yaml

Speaker DaemonSet의 컨테이너별 리소스를 오버라이드합니다.

| 컨테이너 | CPU request/limit | Memory request/limit |
|---------|-------------------|----------------------|
| `speaker` | 50m / 200m | 64Mi / 128Mi |
| `frr` | 50m / 200m | 64Mi / 128Mi |
| `reloader` | 10m / 100m | 32Mi / 64Mi |
| `frr-metrics` | 10m / 100m | 32Mi / 64Mi |

### 4.4 배포 실행

```bash
make preview  # 적용 전 매니페스트 확인
make apply    # 클러스터에 적용
```

> **참고**: `make apply` 시 CRD 또는 Webhook 관련 에러가 발생하면 [Troubleshooting](#6-troubleshooting)을 참조합니다.

---

## 5. 설치 후 검증

### L2 모드

IPAddressPool과 L2Advertisement가 정상 등록되었는지 확인합니다.

```bash
kubectl get ipaddresspool,l2advertisement -n metallb-system
```

예상 결과:

```
NAME                              AUTO ASSIGN   AVOID BUGGY IPS   ADDRESSES
ipaddresspool.metallb.io/ip-pool  true          false             ["192.168.0.220-192.168.0.230"]

NAME                                   IPADDRESSPOOLS   IPADDRESSPOOL SELECTORS   INTERFACES
l2advertisement.metallb.io/l2-network  ["ip-pool"]
```

### BGP 모드

BGPPeer와 BGPAdvertisement가 정상 등록되었는지 확인합니다.

```bash
kubectl get bgppeer,bgpadvertisement -n metallb-system
```

BGP 세션이 정상이면 `kubectl get bgppeer` 출력에서 `STATUS`가 `Established`로 표시됩니다.

### 공통

`LoadBalancer` 서비스에 IP가 할당되는지 확인합니다.

```bash
kubectl get svc -A --field-selector spec.type=LoadBalancer
```

`EXTERNAL-IP` 컬럼에 `<pending>` 대신 IP 주소가 표시되면 정상입니다.

---

## 6. Troubleshooting

### 6.1 CRD가 아직 등록되지 않음

`make apply` 시 CRD 관련 에러가 발생합니다. 잠시 후 `make apply`를 재시도합니다.

### 6.2 Webhook Pod가 아직 준비되지 않음

`make apply` 시 `metallb-webhook-configuration` 에러가 발생합니다. 모든 Pod가 Ready 상태가 된 후 `make apply`를 재시도합니다.

```bash
kubectl wait --for=condition=ready pod --all -n metallb-system --timeout=120s
make apply
```

### 6.3 strictARP 미설정 또는 IP 풀 범위 오류 (L2)

`LoadBalancer` 서비스가 `<pending>` 상태입니다.

- 사전 요구사항의 `strictARP` 설정 확인
- `metallb.yaml`의 IP 범위가 실제 네트워크 대역 내에 있는지 확인

### 6.4 BGP 세션이 Established가 되지 않음

`kubectl get bgppeer -n metallb-system`에서 `STATUS`가 `Established`가 아닌 경우:

- `peerAddress`가 실제 라우터 IP와 일치하는지 확인
- `myASN` / `peerASN`이 라우터 설정과 일치하는지 확인
- 클러스터 노드와 라우터 간 네트워크 연결(방화벽, 포트 179) 확인

---

## 참고 자료

- [MetalLB 공식 문서](https://metallb.universe.tf/)
