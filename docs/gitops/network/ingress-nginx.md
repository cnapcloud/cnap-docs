---
title: "ingress-nginx"
sidebar_position: 4
---

Kubernetes 클러스터의 Ingress 리소스를 처리하여 외부 트래픽을 내부 서비스로 라우팅하는 NGINX 기반 Ingress Controller입니다.

- **버전**: 1.14.1
- **Helm Chart 버전**: 4.14.1
- **네임스페이스**: `ingress-nginx`
- **의존성**: [cert-manager](cert-manager.md), [MetalLB](metallb.md)

---

## 1. 개요

이 환경에서는 두 개의 Ingress Controller를 동일 클러스터에 배포합니다.

| Overlay | IngressClass | LB Scheme | Webhook | 용도 |
|---|---|---|---|---|
| `dev-public` | `nginx` (default) | internet-facing | 활성화 | 외부 공개 트래픽 |
| `dev-internal` | `nginx-internal` | internal | 비활성화 | 클러스터 내부 트래픽 |

두 컨트롤러를 동시 운영할 때 ValidatingWebhook 충돌이 발생할 수 있습니다. 이를 방지하기 위해 internal 컨트롤러의 Webhook을 비활성화하는 것이 핵심 설계 포인트입니다.

---

## 2. 사전 요구사항

- **cert-manager**: 설치 완료 ([cert-manager](cert-manager.md)) — public 컨트롤러 Webhook 인증서 발급에 필요
- **MetalLB**: 설치 완료 ([MetalLB](metallb.md)) — LoadBalancer External IP 할당에 필요

---

## 3. 디렉터리 구조

```
ingress-nginx/
├── Makefile
└── kustomize/
    ├── base/
    │   └── helm/
    │       └── ingress-nginx/              # make pull 로 다운로드하는 Helm Chart
    └── overlays/
        ├── dev-public/                     # 외부 공개용 컨트롤러
        │   ├── kustomization.yaml          # 네임스페이스: ingress-nginx
        │   ├── resources/
        │   │   └── prometheusrules.yaml    # Webhook 인증서 만료 알림 Rule
        │   └── helm/
        │       ├── helm-chart.yaml         # HelmChartInflationGenerator 설정
        │       └── values.yaml             # public 컨트롤러 values
        └── dev-internal/                   # 내부 전용 컨트롤러
            ├── kustomization.yaml          # 네임스페이스: ingress-nginx
            └── helm/
                ├── helm-chart.yaml         # HelmChartInflationGenerator 설정
                └── values.yaml             # internal 컨트롤러 values
```

---

## 4. 배포

### 4.1 패키지 준비

```bash
make pull
```

### 4.2 배포 설정

두 overlay의 values.yaml 핵심 차이점:

| 항목 | dev-public | dev-internal |
|---|---|---|
| `fullnameOverride` | `ingress-nginx` | `ingress-nginx-internal` |
| `ingressClass` | `nginx` | `nginx-internal` |
| `ingressClassResource.default` | `true` | `false` |
| `ingressClassResource.controllerValue` | (기본값) | `k8s.io/ingress-nginx-internal` |
| `service` AWS scheme | `internet-facing` | `internal` |
| `admissionWebhooks.enabled` | `true` | `false` |
| `extraArgs.watch-ingress-without-class` | `"true"` | (없음) |

#### overlays/dev-public/helm/values.yaml

```yaml
# kustomize/overlays/dev-public/helm/values.yaml
fullnameOverride: ingress-nginx

controller:
  replicaCount: 1
  progressDeadlineSeconds: 600

  ingressClass: nginx
  ingressClassResource:
    name: nginx
    enabled: true
    default: true

  extraArgs:
    watch-ingress-without-class: "true"   # IngressClass 없는 Ingress도 처리

  service:
    type: LoadBalancer
    annotations:
      service.beta.kubernetes.io/aws-load-balancer-scheme: internet-facing
      service.beta.kubernetes.io/aws-load-balancer-target-type: ip

  admissionWebhooks:
    enabled: true
    certManager:
      enabled: true   # chart가 자체 Issuer 체인을 생성하여 Webhook 인증서를 자동 발급·갱신

  config:
    allow-snippet-annotations: "true"
    annotations-risk-level: "Critical"

  resources:
    requests:
      cpu: 100m
      memory: 90Mi

  metrics:
    enabled: true
    serviceMonitor:
      enabled: true
      additionalLabels:
        prometheus: main
```


**Kind 환경**: LoadBalancer가 없는 Kind 클러스터에서는 아래 설정을 추가합니다.

```yaml
controller:
  publishService:
    enabled: false
  hostPort:
    enabled: true
  nodeSelector:
    ingress-ready: "true"
  tolerations:
  - key: node-role.kubernetes.io/control-plane
    operator: Exists
    effect: NoSchedule
  extraArgs:
    publish-status-address: "localhost"
```

`publish-status-address: "localhost"` 미설정 시 Ingress Controller가 외부 IP 할당을 기다리며 Ingress status가 비어 있게 됩니다. ArgoCD가 이를 감지하여 해당 Application을 Progressing 상태로 유지합니다.

#### overlays/dev-internal/helm/values.yaml

dev-public과 다른 항목만 기술합니다.

```yaml
# kustomize/overlays/dev-internal/helm/values.yaml
fullnameOverride: ingress-nginx-internal  # public: ingress-nginx

controller:
  ingressClass: nginx-internal            # public: nginx
  ingressClassResource:
    name: nginx-internal
    default: false                        # public: true
    controllerValue: k8s.io/ingress-nginx-internal  # public: 없음

  service:
    annotations:
      service.beta.kubernetes.io/aws-load-balancer-scheme: internal  # public: internet-facing

  admissionWebhooks:
    enabled: false                        # public: true — Webhook 충돌 방지 (Troubleshooting 7.1 참조)
```

---

### 4.3 배포 실행

두 컨트롤러를 순서대로 배포합니다. 네임스페이스는 최초 1회만 생성합니다.

```bash
make namespace
make preview DEPLOY_ENV=dev-public   # 적용 전 매니페스트 확인
make apply DEPLOY_ENV=dev-public

make preview DEPLOY_ENV=dev-internal
make apply DEPLOY_ENV=dev-internal
```

---

## 5. 설치 후 검증

### 5.1 LoadBalancer External IP 확인

```bash
kubectl get svc -n ingress-nginx
```

예상 결과:

```
NAME                                TYPE           CLUSTER-IP     EXTERNAL-IP      PORT(S)
ingress-nginx-controller            LoadBalancer   10.96.x.x      <external-ip>    80:xxx/TCP,443:xxx/TCP
ingress-nginx-internal-controller   LoadBalancer   10.96.x.x      <internal-ip>    80:xxx/TCP,443:xxx/TCP
```

두 서비스 모두 `EXTERNAL-IP`에 `<pending>`이 아닌 IP가 할당되면 정상입니다.

### 5.2 Ingress 라우팅 확인

테스트용 Deployment와 Ingress를 생성하여 public 컨트롤러의 라우팅을 확인합니다.

```bash
kubectl create deploy nginx-test --image nginx
kubectl expose deploy nginx-test --port 80

kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: nginx-test
  namespace: default
spec:
  ingressClassName: nginx
  rules:
  - host: nginx.cnapcloud.com
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

```bash
curl -H "Host: nginx.cnapcloud.com" http://<external-ip>
```

`Welcome to nginx!` 응답이 오면 정상입니다.

internal 컨트롤러 확인은 `ingressClassName: nginx-internal`로 Ingress를 생성한 뒤 Cluster IP로 접근합니다.

```bash
CLUSTER_IP=$(kubectl get svc ingress-nginx-internal-controller -n ingress-nginx -o jsonpath='{.spec.clusterIP}')
curl -v --resolve nginx.cnapcloud.com:80:$CLUSTER_IP http://nginx.cnapcloud.com
```

테스트 리소스 정리:

```bash
kubectl delete ingress nginx-test
kubectl delete svc nginx-test
kubectl delete deploy nginx-test
```

---

## 6. 운영

### 6.1 Webhook 인증서 유효기간 및 갱신

`admissionWebhooks.certManager.enabled: true` 설정 시 chart가 아래 Issuer·Certificate 체인을 자동 생성합니다.

```
ingress-nginx-self-signed-issuer (Issuer, SelfSigned)
  └─▶ ingress-nginx-root-cert (Certificate, duration: 8760h = 365일)
        └─▶ ingress-nginx-root-issuer (Issuer, CA)
              └─▶ ingress-nginx-admission (Certificate, duration: 8760h = 365일)
```

| 리소스 | 유효기간 | 갱신 시점 |
|---|---|---|
| `ingress-nginx-root-cert` | 365일 | 만료 ~243일 전 (cert-manager 자동) |
| `ingress-nginx-admission` | 365일 | 만료 ~243일 전 (cert-manager 자동) |

cert-manager는 기본적으로 유효기간의 2/3 시점에 자동 갱신을 시도합니다.

인증서 상태 확인:

```bash
kubectl get certificate,issuer -n ingress-nginx
```

예상 결과:

```
NAME                                              READY   SECRET                    AGE
certificate.cert-manager.io/ingress-nginx-admission   True    ingress-nginx-admission   69d
certificate.cert-manager.io/ingress-nginx-root-cert   True    ingress-nginx-root-cert   69d

NAME                                                        READY   AGE
issuer.cert-manager.io/ingress-nginx-root-issuer          True    69d
issuer.cert-manager.io/ingress-nginx-self-signed-issuer   True    69d
```

두 Certificate 모두 `READY: True`이면 정상입니다.

갱신 실패 시 `kustomize/overlays/dev-public/resources/prometheusrules.yaml`의 `CertExpiry` alert가 만료 30일 전부터 발생합니다.

---

## 7. Troubleshooting

### 7.1 Admission Webhook 충돌 (internal Webhook 활성화 시)

**증상**: public Ingress 생성 시 아래 오류 발생.

```
Internal error occurred: failed calling webhook "validate.nginx.ingress.kubernetes.io":
tls: failed to verify certificate: x509: certificate is valid for
ingress-nginx-internal-controller-admission.ingress-nginx.svc,
not ingress-nginx-internal-controller-admission.ingress-nginx-internal.svc
```

**원인**: NGINX Ingress의 ValidatingWebhook은 IngressClass와 무관하게 모든 Ingress를 검증합니다. internal 컨트롤러의 Webhook이 활성화되어 있으면 SAN 불일치로 검증 실패가 발생합니다.

**해결**: `dev-internal/helm/values.yaml`에서 Webhook을 비활성화하고 재배포합니다.

```yaml
controller:
  admissionWebhooks:
    enabled: false
```

```bash
make apply DEPLOY_ENV=dev-internal
```

### 7.2 설정 변경 후 기존 Ingress가 동작하지 않음

annotation 허용 범위 변경 등 컨트롤러 설정 변경 후 기존 Ingress가 정상 동작하지 않는 경우, 해당 Ingress를 재배포하면 새 설정이 반영됩니다.

```bash
kubectl delete ingress <ingress-name> -n <namespace>
kubectl apply -f <ingress-yaml>
```

---

## 참고 자료

- [ingress-nginx 공식 문서](https://kubernetes.github.io/ingress-nginx/)
- [Multiple Ingress controllers](https://kubernetes.github.io/ingress-nginx/user-guide/multiple-ingress/)
