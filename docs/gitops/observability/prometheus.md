---
title: "Prometheus"
sidebar_position: 1
---

## 1. 개요
본 문서는 `/prometheus` 디렉터리 구조를 기반으로 kube-prometheus-stack을 Kubernetes 클러스터에 설치하는 전체 과정을 안내합니다. kube-prometheus-stack은 Prometheus Operator, Prometheus, Grafana, Alertmanager, Node Exporter 등을 포함한 완전한 모니터링 스택을 제공합니다. Kustomize, Helm, Makefile을 활용한 배포 자동화, 환경별 설정, 주요 커스텀 옵션, 운영 팁을 포함합니다.

---

## 2. 사전 요구사항
- **Kubernetes 클러스터**: v1.30 이상
- **로컬 도구**: kubectl, kustomize, helm 설치 완료
- **DNS 등록**: 
  - prometheus.cnapcloud.com
  - grafana.cnapcloud.com
  - alertmanager.cnapcloud.com

- **Keycloak Client 설정**:grafana client 생성
---

## 3. 디렉터리 구조 및 역할
```
prometheus/
├── Makefile                           # 배포 자동화 스크립트
├── kustomize/
│   ├── base/                          # 공통 리소스(CRDs, ConfigMaps 등)
│   │   ├── configmap/                 # 추가 ConfigMap
│   │   ├── helm/                      # kube-prometheus-stack Helm 차트
│   │   ├── patches/                   # 패치 파일들
│   │   └── resources/                 # 추가 리소스
│   └── overlays/
│       └── dev/                       # dev 환경 설정
│           ├── kustomization.yaml     # Kustomize 구성
│           └── helm/
│               ├── values.yaml        # Prometheus 스택 설정
│               └── helm-chart.yaml    # HelmChartInflationGenerator
```
- **Makefile**: `apply`, `delete`, `preview` 등 배포 자동화 명령어
- **kustomize/base/**: 모든 환경에 공통 적용될 리소스(CRDs, ConfigMaps 등)
- **kustomize/overlays/dev/**: dev 환경 특화 설정
- **helm/values.yaml**: kube-prometheus-stack Helm Chart 커스터마이징 설정

---

## 4. 설치 단계

### 4.1. values.yaml 커스터마이징
`kustomize/overlays/dev/helm/values.yaml` 파일을 열어 주요 설정을 수정합니다.

#### 4.1.1. Prometheus 설정
```yaml
prometheus:
  prometheusSpec:
    serviceMonitorSelector:
      matchLabels:
        prometheus: main
    storageSpec:
      volumeClaimTemplate:
        spec:
          resources:
            requests:
              storage: 4Gi
    retention: 5d
```

#### 4.1.2. Grafana 설정
```yaml
grafana:
  grafana.ini:
    server:
      root_url: https://grafana.cnapcloud.com
    auth:
      signout_redirect_url: https://keycloak.cnapcloud.com/realms/cnap/protocol/openid-connect/logout?post_logout_redirect_uri=https://grafana.cnapcloud.com&id_token_hint=${raw_id_token}
    auth.generic_oauth:
      enabled: true
      name: keycloak
      allow_sign_up: true
      client_id: grafana
      client_secret: ${GRAFANA_CLIENT_SECRET}
      scopes: openid profile email groups
      auth_url: https://keycloak.cnapcloud.com/realms/cnap/protocol/openid-connect/auth
      token_url: https://keycloak.cnapcloud.com/realms/cnap/protocol/openid-connect/token
      api_url: https://keycloak.cnapcloud.com/realms/cnap/protocol/openid-connect/userinfo
      role_attribute_path: >
        contains(groups[*], 'admin') && 'Admin' ||
        contains(groups[*], 'viewer') && 'Viewer'
      login_attribute_path: preferred_username
      name_attribute_path: name
      email_attribute_path: email
      groups_attribute_path: groups
```

#### 4.1.3. Alertmanager 설정
```yaml
alertmanager:
  alertmanagerSpec:
    replicas: 1
  ingress:
    enabled: true
    hosts:
      - alertmanager.cnapcloud.com
```

#### 4.1.4. Ingress 및 모니터링 설정
모니터링 스택의 외부 접근과 메트릭 수집을 위한 설정입니다.

**Prometheus Ingress 설정:**
```yaml
prometheus:
  ingress:
    enabled: true
    hosts:
    - prometheus.cnapcloud.com
```


#### 4.1.5. 모니터링 리소스 Selector 설정
Prometheus가 메트릭을 수집할 ServiceMonitor, PodMonitor, PrometheusRule을 선택하는 라벨 셀렉터 설정입니다. `prometheus: main` 라벨이 설정된 리소스만 모니터링 대상으로 포함됩니다.

```yaml
prometheus:
  namespaceOverride: ""
  prometheusSpec:
    serviceMonitorSelector:
      matchLabels:
        prometheus: main     
    podMonitorSelector:
      matchLabels:
        prometheus: main
    ruleSelector:
      matchLabels:
        prometheus: main
```

**commonLabels 설정:**
kube-prometheus-stack에 의해 자동으로 배포되는 모든 ServiceMonitor, PodMonitor, PrometheusRule에 `prometheus: main` 라벨을 추가합니다. 

```yaml
global:
  imageRegistry: ""

commonLabels:
  prometheus: main
```

### 4.2. Kustomize 구성

#### 4.2.1. kustomization.yaml 구성
`kustomize/overlays/dev/kustomization.yaml`에서 namespace, generators, resources, patches 등 지정
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: lma
generators:
  - ./helm/helm-chart.yaml
resources:
  - ../../base
patches:
  - target:
      kind: ConfigMap
      name: kube-prometheus-stack-grafana-datasources
    patch: |-
      - op: add
        path: /data/datasource.yaml
        value: |
          apiVersion: 1
          datasources:
          - name: Prometheus
            type: prometheus
            url: http://kube-prometheus-stack-prometheus.lma.svc.cluster.local:9090
            access: proxy
            isDefault: true
```

#### 4.2.2. HelmChartInflationGenerator 설정
`helm/helm-chart.yaml`에서 Helm 차트 경로와 values 파일 지정
```yaml
apiVersion: builtin
kind: HelmChartInflationGenerator
metadata:
  name: kube-prometheus-stack
name: kube-prometheus-stack
chartHome: ../../base/helm
chart: kube-prometheus-stack
releaseName: kube-prometheus-stack
valuesFile: ./helm/values.yaml
includeCRDs: true
namespace: lma
```

#### 4.2.3. 알림 설정
Alertmanager는 ./kustomize/base/resources/alertmanagerconfig.yaml 설정을 통해 이메일, Slack 등으로 알림을 받도록 구성합니다.


### 4.3. 배포 프로세스 (Makefile 활용)

#### Step 1: Namespace 생성
```bash
make namespace DEPLOY_ENV=dev
```

#### Step 2: 배포 미리보기
```bash
make preview DEPLOY_ENV=dev
```

#### Step 3: 배포 실행
```bash
make apply DEPLOY_ENV=dev
```

#### Step 4: 배포 상태 확인
```bash
kubectl get pods -n lma -w
```

---

## 5. 설치 후 검증

### 5.1. 리소스 상태 확인
```bash
kubectl get pods,svc,ingress,pvc -n lma
```
**확인 사항:**
- **Pod 상태**:
  - `alertmanager-prometheus-kube-prometheus-alertmanager-0`: Running (Alertmanager)
  - `prometheus-grafana-*`: Running (Grafana)
  - `prometheus-kube-prometheus-operator-*`: Running (Prometheus Operator)
  - `prometheus-prometheus-kube-prometheus-prometheus-0`: Running (Prometheus)
- **Service 상태**:
  - `alertmanager-operated`: ClusterIP (Alertmanager 내부 서비스)
  - `prometheus-operated`: ClusterIP (Prometheus 내부 서비스)
  - `prometheus-grafana`: ClusterIP (Grafana 서비스)
  - `prometheus-kube-prometheus-alertmanager`: ClusterIP (Alertmanager 서비스)
  - `prometheus-kube-prometheus-operator`: ClusterIP (Operator 서비스)
  - `prometheus-kube-prometheus-prometheus`: ClusterIP (Prometheus 서비스)
- **Ingress 상태**:
  - `prometheus-grafana`: grafana.cnapcloud.com (Grafana 접근용)
- **PVC 상태**:
  - `grafana`: Bound (grafana 데이터)
  - `kube-prometheus-stack-prometheus-0`: Bound (Prometheus 데이터)

### 5.2. Prometheus 상태 확인
Prometheus의 설정과 메트릭 수집 상태를 확인합니다.

#### 5.2.1. Prometheus UI 접근 확인
```bash
kubectl -n lma port-forward svc/prometheus-kube-prometheus-prometheus 9090:9090
```
**설명:** Port-forward를 통해 Prometheus UI에 접근합니다. 브라우저에서 `http://localhost:9090`으로 접속하여 Status > Targets에서 메트릭 수집 상태를 확인합니다.

**확인 사항:**
- Targets 페이지에서 모든 ServiceMonitor가 UP 상태
- 메트릭 수집이 정상 작동

#### 5.2.2. 메트릭 쿼리 테스트
Prometheus UI에서 간단한 쿼리를 실행합니다.
```
up
```
**설명:** 클러스터의 모든 타겟 상태를 확인하는 기본 쿼리입니다.

**예상 결과:**
- 각 타겟의 up 메트릭이 1로 표시 (정상)

### 5.3. Grafana 상태 확인
Grafana의 대시보드와 데이터 소스 연결을 확인합니다.

#### 5.3.1. Grafana UI 접근 확인
```bash
kubectl -n lma port-forward svc/lma-grafana  3000:80
```
**설명:** Port-forward를 통해 Grafana UI에 접근합니다. 브라우저에서 `http://localhost:3000`으로 접속합니다.

**확인 사항:**
- Grafana 로그인 페이지 표시
- 기본 admin/prom-operator 계정으로 로그인 가능

#### 5.3.2. 데이터 소스 확인
Grafana에서 Configuration > Data Sources로 이동하여 Prometheus 데이터 소스가 정상 연결되었는지 확인합니다.

**확인 사항:**
- Prometheus 데이터 소스가 Green 상태 (연결 성공)
- Test 버튼으로 연결 테스트 통과

#### 5.3.3. 대시보드 확인
Grafana에서 Dashboards > Browse로 이동하여 Kubernetes 관련 대시보드가 로드되었는지 확인합니다.

**확인 사항:**
- 여러 Kubernetes 모니터링 대시보드 표시
- 메트릭 그래프가 정상 표시

### 5.4. Alertmanager 상태 확인
Alertmanager의 설정과 알림 라우팅을 확인합니다.

#### 5.4.1. Alertmanager UI 접근 확인
```bash
kubectl -n lma port-forward svc/prometheus-kube-prometheus-alertmanager 9093:9093
```
**설명:** Port-forward를 통해 Alertmanager UI에 접근합니다. 브라우저에서 `http://localhost:9093`으로 접속합니다.

**확인 사항:**
- Alertmanager UI 표시
- Status 페이지에서 설정 확인

---

## 6. 모니터링 리소스 구성

Prometheus가 메트릭을 수집하고 알림을 생성하기 위해 ServiceMonitor, PodMonitor, PrometheusRule을 사용할 수 있습니다. 아래는 각 리소스의 기본 구성 예시입니다.

### 6.1. ServiceMonitor
ServiceMonitor는 Kubernetes Service를 통해 노출된 애플리케이션의 메트릭을 수집합니다.

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: example-app
  namespace: lma
  labels:
    prometheus: main
spec:
  selector:
    matchLabels:
      app: example-app
  endpoints:
  - port: metrics
    path: /metrics
    interval: 30s
```

### 6.2. PodMonitor
PodMonitor는 직접 Pod의 메트릭 엔드포인트를 모니터링합니다.

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: example-pod
  namespace: lma
  labels:
    prometheus: main
spec:
  selector:
    matchLabels:
      app: example-pod
  podMetricsEndpoints:
  - port: metrics
    path: /metrics
    interval: 30s
```

### 6.3. PrometheusRule
PrometheusRule은 메트릭 기반 알림 규칙을 정의합니다.

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: example-alerts
  namespace: lma
  labels:
    prometheus: main
spec:
  groups:
  - name: example
    rules:
    - alert: HighRequestLatency
      expr: http_request_duration_seconds{quantile="0.5"} > 0.5
      for: 10m
      labels:
        severity: warning
      annotations:
        summary: "High request latency"
        description: "Request latency is {{ $value }}s"
```

---

## 7. 운영 및 Troubleshooting

### 7.1. Pod가 Running 상태가 아닌 경우
```bash
kubectl get pods -n lma
kubectl describe pod <pod명> -n lma
kubectl logs <pod명> -n lma
```
**주요 원인:**
- PVC 미바인딩 → StorageClass 확인
- 리소스 부족 → `kubectl top nodes`로 노드 상태 확인
- CRD 충돌 → 기존 Prometheus Operator 확인

### 7.2. 메트릭 수집 실패
- ServiceMonitor 확인: `kubectl get servicemonitor -n lma`
- Target 상태 확인: Prometheus UI의 Status > Targets
- 로그 확인: `kubectl logs deployment/prometheus-kube-prometheus-operator -n lma`

### 7.3. Grafana 로그인 실패
- Secret 확인: `kubectl get secret -n lma | grep grafana`
- OIDC 설정 검증: values.yaml의 auth.generic_oauth 섹션
- Keycloak client 설정 확인: Client ID, Secret, Redirect URIs
- 로그 확인: `kubectl logs deployment/prometheus-grafana -n lma`



## 8. 배포 제거

### 8.1. Prometheus 스택 삭제
```bash
make delete DEPLOY_ENV=dev
```

### 8.2. Namespace 삭제 (선택사항)
```bash
kubectl delete namespace lma
```
> **주의**: Namespace를 삭제하면 PVC를 포함한 모든 데이터가 영구 삭제됩니다.

---

## 9. 부록: 최종 체크리스트

**설치 전:**
- [ ] Kubernetes 클러스터 준비 (v1.19+)
- [ ] kubectl, kustomize, helm 설치
- [ ] Keycloak grafana client 설정 완료
- [ ] 네임스페이스(lma) 생성
- [ ] DNS 설정 완료

**설치:**
- [ ] values.yaml 커스터마이징 완료 (Prometheus, Grafana, Alertmanager)
- [ ] kustomization.yaml 구성 완료
- [ ] make namespace 실행
- [ ] make preview 실행 및 확인
- [ ] make apply 실행

**검증:**
- [ ] 모든 Pod이 Running 상태
- [ ] PVC가 Bound 상태
- [ ] Service/Ingress 생성 확인
- [ ] Prometheus 메트릭 수집 확인
- [ ] Grafana 대시보드 확인
- [ ] Alertmanager 상태 확인

**운영:**
- [ ] 인증 설정 적용
- [ ] Network Policy 구성
- [ ] 알림 설정 구성
