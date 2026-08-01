---
title: "ECK Operator"
sidebar_position: 5
---

Elasticsearch, Kibana 등 Elastic Stack 컴포넌트를 Kubernetes에서 선언적으로 관리하는 오퍼레이터입니다.

- **버전**: `eck-operator 3.2.0`
- **Helm Chart**: `elastic/eck-operator 3.2.0`
- **네임스페이스**: `database`

---

## 1. 개요

ECK(Elastic Cloud on Kubernetes) Operator는 Elasticsearch, Kibana, APM Server, Beats, Logstash 등 Elastic Stack 컴포넌트의 생성·운영·업그레이드를 CRD로 관리합니다.

이 가이드는 Operator 설치만 다룹니다. Elastic Stack 배포는 [eck-stack](eck-stack.md)를 참고합니다.

---

## 2. 디렉터리 구조

```
eck/operator/
├── Makefile
└── kustomize/
    ├── base/
    │   └── helm/
    │       └── eck-operator/          # ECK Operator Chart (pull로 다운로드)
    └── overlays/
        └── dev/
            ├── kustomization.yaml     # HelmChartInflationGenerator 등록
            └── helm/
                ├── helm-chart.yaml    # HelmChartInflationGenerator 설정
                └── values.yaml        # Operator 파라미터 (리소스, PodMonitor)
```

---

## 3. 배포

### 3.1 Helm Chart 다운로드

```bash
make pull
```

Elastic Helm 리포지터리에서 `eck-operator 3.2.0`을 `kustomize/base/helm/`에 다운로드합니다.

### 3.2 배포 설정

`overlays/dev/helm/values.yaml` — Prometheus PodMonitor와 리소스를 설정합니다.

```yaml
replicaCount: 1

resources:
  limits:
    cpu: 1
    memory: 1Gi
  requests:
    cpu: 100m
    memory: 150Mi

podMonitor:
  enabled: true
  labels:
    prometheus: main
```

### 3.3 배포 실행

```bash
make preview  # 적용 전 매니페스트 확인
make apply    # 클러스터에 적용
```

---

## 4. 설치 후 검증

### 4.1 CRD 등록 확인

```bash
kubectl get crd | grep elastic.co
```

예상 결과:

```
agents.agent.k8s.elastic.co
apmservers.apm.k8s.elastic.co
beats.beat.k8s.elastic.co
elasticmapsservers.maps.k8s.elastic.co
elasticsearchautoscalers.autoscaling.k8s.elastic.co
elasticsearches.elasticsearch.k8s.elastic.co
enterprisesearches.enterprisesearch.k8s.elastic.co
kibanas.kibana.k8s.elastic.co
logstashes.logstash.k8s.elastic.co
stackconfigpolicies.stackconfigpolicy.k8s.elastic.co
```

### 4.2 Operator 메트릭 확인

Operator Pod의 포트 8080에서 ECK 메트릭을 노출합니다. 관리 중인 리소스 정보가 반환되면 정상입니다.

```bash
kubectl port-forward -n database \
  $(kubectl get pod -n database -l app.kubernetes.io/name=elastic-operator -o name | head -1) \
  18080:8080

curl -s http://localhost:18080/metrics | grep elastic_operator_resources_owned
```

---

## 5. Troubleshooting

### 5.1 Webhook 오류 — Elastic Stack 리소스 생성 실패

**증상**: Elasticsearch 등 생성 시 `failed calling webhook` 오류

**원인**: Operator StatefulSet 기동 중이거나 Webhook 인증서 미준비 상태

**해결**: Operator Pod가 `Running` 상태인지 확인 후 재시도합니다.

---

## 6. 제거

**주의**: `make delete`는 Operator를 삭제하지만 CRD는 삭제하지 않습니다. CRD가 남아 있으면 재설치 시 충돌이 발생할 수 있습니다.

**주의**: Elastic Stack 리소스(Elasticsearch, Kibana 등)가 존재하는 상태에서 CRD를 삭제하면 해당 리소스가 모두 소멸합니다. Stack 리소스를 먼저 삭제한 후 CRD를 제거합니다.

```bash
make delete
kubectl delete crd -l app.kubernetes.io/name=eck-operator-crds
```
