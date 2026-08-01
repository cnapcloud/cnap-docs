---
title: "CloudNativePG Operator"
sidebar_position: 3
---

PostgreSQL 클러스터를 Kubernetes에서 선언적으로 관리하는 오퍼레이터입니다. Barman Cloud Plugin과 함께 배포하여 WAL 아카이빙과 베이스 백업을 지원합니다.

- **버전**: `cloudnative-pg 0.27.0`, `plugin-barman-cloud 0.3.1`
- **Helm Chart**: `cnpg/cloudnative-pg 0.27.0`, `cnpg/plugin-barman-cloud 0.3.1`
- **네임스페이스**: `database`
- **의존성**: [cert-manager](../network/cert-manager.md)

---

## 1. 개요

CloudNativePG(CNPG)는 PostgreSQL 클러스터의 생성·운영·장애 조치를 CRD로 관리합니다. Barman Cloud Plugin은 MinIO 등 S3 호환 스토리지를 이용한 WAL 아카이빙과 베이스 백업을 담당합니다.

이 가이드는 Operator 설치만 다룹니다. PostgreSQL 클러스터 생성은 [cnpg-cluster](cnpg-cluster.md)를 참고합니다.

---

## 2. 사전 요구사항

- **cert-manager**: Barman Cloud Plugin이 TLS 인증서 발급에 사용 ([cert-manager](../network/cert-manager.md))

---

## 3. 디렉터리 구조

```
cnpg/operator/
├── Makefile
└── kustomize/
    ├── base/
    │   └── helm/
    │       ├── cloudnative-pg/          # CNPG Operator Chart (pull로 다운로드)
    │       └── plugin-barman-cloud/     # Barman Cloud Plugin Chart (pull로 다운로드)
    └── overlays/
        └── dev/
            ├── kustomization.yaml       # HelmChartInflationGenerator 등록
            └── helm/
                ├── cnpg/
                │   ├── helm-chart.yaml  # CNPG HelmChartInflationGenerator 설정
                │   └── values.yaml      # CNPG Operator 파라미터 (모니터링, 리소스)
                └── barman/
                    ├── helm-chart.yaml  # Barman HelmChartInflationGenerator 설정
                    └── values.yaml      # Barman Cloud Plugin 파라미터 (리소스)
```

---

## 4. 배포

### 4.1 Helm Chart 다운로드

```bash
make pull
```

cnpg 리포지터리에서 두 Chart를 `kustomize/base/helm/`에 다운로드합니다.

### 4.2 배포 설정

`overlays/dev/helm/cnpg/values.yaml` — Prometheus PodMonitor와 Grafana 대시보드를 활성화합니다.

```yaml
monitoring:
  podMonitorEnabled: true
  podMonitorAdditionalLabels:
    prometheus: main
  grafanaDashboard:
    create: true
    configMapName: "cnpg-grafana-dashboard"
    labels:
      prometheus: main
```

`overlays/dev/helm/barman/values.yaml` — 리소스만 설정합니다. Chart에 PodMonitor 템플릿이 없어 monitoring 설정은 불필요합니다.

### 4.3 배포 실행

```bash
make preview  # 적용 전 매니페스트 확인
make apply    # 클러스터에 적용
```

**참고**: `make apply`는 CNPG CRD 크기 제한 문제를 피하기 위해 `--server-side=true`를 사용합니다.

---

## 5. 설치 후 검증

### 5.1 CRD 등록 확인

```bash
kubectl get crd | grep cnpg.io
```

예상 결과:

```
backups.postgresql.cnpg.io
clusterimagecatalogs.postgresql.cnpg.io
clusters.postgresql.cnpg.io
databases.postgresql.cnpg.io
failoverquorums.postgresql.cnpg.io
imagecatalogs.postgresql.cnpg.io
objectstores.barmancloud.cnpg.io
poolers.postgresql.cnpg.io
publications.postgresql.cnpg.io
scheduledbackups.postgresql.cnpg.io
subscriptions.postgresql.cnpg.io
```

### 5.2 Operator 메트릭 확인

Operator Pod의 포트 8080에서 controller_runtime 메트릭을 노출합니다. 모든 controller의 reconcile 오류 카운터가 `0`이면 정상입니다.

```bash
kubectl port-forward -n database \
  $(kubectl get pod -n database -l app.kubernetes.io/name=cloudnative-pg -o name | head -1) \
  18080:8080

curl -s http://localhost:18080/metrics | grep controller_runtime_reconcile_errors_total
```

예상 결과:

```
controller_runtime_reconcile_errors_total{controller="backup"} 0
controller_runtime_reconcile_errors_total{controller="cluster"} 0
controller_runtime_reconcile_errors_total{controller="plugin"} 0
controller_runtime_reconcile_errors_total{controller="pooler"} 0
controller_runtime_reconcile_errors_total{controller="scheduled-backup"} 0
```

---

## 6. Troubleshooting

### 6.1 CRD 적용 오류 — 리소스 크기 초과

**증상**: `kubectl apply` 직접 실행 시 `metadata.annotations: Too long` 오류

**원인**: CNPG CRD 크기가 `kubectl apply`의 annotation 크기 제한 초과

**해결**: `make apply`는 이미 `--server-side=true`를 사용합니다. 직접 실행할 경우 동일 옵션을 추가합니다.

```bash
kustomize build --enable-alpha-plugins kustomize/overlays/dev | kubectl apply --server-side=true -f -
```

### 6.2 Webhook 오류 — 클러스터 생성 실패

**증상**: PostgreSQL 클러스터 생성 시 `Internal error occurred: failed calling webhook` 오류

**원인**: Operator Pod 기동 중이거나 Webhook 인증서 미준비 상태

**해결**: Operator Pod가 `Running` 상태인지 확인 후 재시도합니다.

---

## 7. 제거

**주의**: `make delete`는 Operator를 삭제하지만 CRD는 삭제하지 않습니다. CRD가 남아 있으면 재설치 시 충돌이 발생할 수 있습니다.

**주의**: PostgreSQL 클러스터가 존재하는 상태에서 CRD를 삭제하면 클러스터 리소스가 모두 소멸합니다. 클러스터를 먼저 삭제한 후 CRD를 제거합니다.

```bash
make delete
kubectl delete crd -l app.kubernetes.io/name=cloudnative-pg
kubectl delete crd -l app.kubernetes.io/name=plugin-barman-cloud
```
