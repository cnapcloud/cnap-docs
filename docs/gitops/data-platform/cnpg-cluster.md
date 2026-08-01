---
title: "CNPG 클러스터"
sidebar_position: 4
---

CloudNativePG 기반 PostgreSQL 3-node HA 클러스터로, Barman Cloud Plugin을 통해 MinIO에 WAL 아카이빙과 베이스 백업을 수행합니다.

- **Helm Chart 버전**: `cluster 0.4.0`
- **PostgreSQL 버전**: `16`
- **네임스페이스**: `database`
- **의존성**: [CNPG Operator](cnpg-operator.md), [MinIO](minio.md)

---

## 1. 개요

3개 인스턴스(Primary 1 + Replica 2)를 StatefulSet으로 구성하며, `podAntiAffinity: required`로 각 인스턴스를 서로 다른 노드에 배치합니다. Barman Cloud Plugin이 WAL을 MinIO에 실시간 아카이빙하고, ScheduledBackup이 매일 자정 베이스 백업을 수행합니다. recovery overlay를 사용하여 특정 시점(PITR)으로 클러스터를 복구할 수 있습니다.

---

## 2. 사전 요구사항

- **CNPG Operator**: 설치 완료 ([cnpg-operator](cnpg-operator.md))
- **MinIO**: `postgresql-backups` 버킷 생성 완료 ([minio](minio.md))

---

## 3. 디렉터리 구조

```
cnpg/cluster/
├── Makefile
└── kustomize/
    ├── base/
    │   └── helm/
    │       └── cluster/                        # CNPG Cluster Chart (pull로 다운로드)
    └── overlays/
        ├── dev/
        │   ├── kustomization.yaml              # secretGenerator, patch 포함
        │   ├── helm/
        │   │   ├── helm-chart.yaml             # HelmChartInflationGenerator 설정
        │   │   └── values.yaml                 # 클러스터 파라미터
        │   └── resources/
        │       ├── barman-object-store.yaml    # ObjectStore CRD (MinIO 연결)
        │       └── backup-schedule.yaml        # ScheduledBackup CRD
        └── recovery/
            ├── kustomization.yaml              # PITR 복구용 patch 포함
            ├── helm/values.yaml
            └── resources/
                ├── barman-object-store.yaml
                └── backup-schedule.yaml
```

---

## 4. 사전 설정

### 4.1 Superuser Secret 생성

```bash
kubectl create secret generic postgres-superuser-secret \
  --from-literal=username=postgres \
  --from-literal=password='<strong-password>' \
  -n database
```

### 4.2 MinIO 버킷 확인

백업 저장소로 사용할 버킷이 존재하는지 확인합니다.

```bash
POD=$(kubectl get pod -n storage -l app=minio -o jsonpath='{.items[0].metadata.name}')
kubectl -n storage exec $POD -- mc alias set local http://localhost:9000 admin <password>
kubectl -n storage exec $POD -- mc ls local/ | grep postgresql-backups
```

버킷이 없으면 생성합니다.

```bash
kubectl -n storage exec $POD -- mc mb local/postgresql-backups
```

또는 MinIO Console(`https://minio.cnapcloud.com`) → Buckets → Create Bucket에서 `postgresql-backups` 버킷을 생성합니다.

### 4.3 MinIO 접근 키 생성

PostgreSQL 백업 전용 서비스 계정을 생성합니다.

```bash
POD=$(kubectl get pod -n storage -l app=minio -o jsonpath='{.items[0].metadata.name}')
kubectl -n storage exec $POD -- mc alias set local http://localhost:9000 admin <password>
kubectl -n storage exec $POD -- mc admin user svcacct add \
  --access-key "<access-key>" \
  --secret-key "<secret-key>" \
  local admin
```

또는 MinIO Console(`https://minio.cnapcloud.com`) → Access Keys → Create access key에서 생성합니다.

### 4.4 S3 자격증명 업데이트

`overlays/dev/kustomization.yaml`의 `secretGenerator`에 위에서 생성한 접근 키를 입력합니다.

```yaml
secretGenerator:
  - name: s3-store-creds
    literals:
      - ACCESS_KEY_ID=<minio-access-key>
      - ACCESS_SECRET_KEY=<minio-secret-key>
    type: Opaque
```

---

## 5. 배포

### 5.1 Namespace 생성

```bash
make namespace
```

### 5.2 Helm Chart 다운로드

```bash
make pull
```

CNPG cluster Chart v0.4.0을 `kustomize/base/helm/cluster/`에 다운로드합니다.

### 5.3 배포 설정

`overlays/dev/helm/values.yaml` — 클러스터 구성의 핵심 파라미터입니다.

```yaml
# overlays/dev/helm/values.yaml
fullnameOverride: "pg-cluster"

type: postgresql
version:
  postgresql: "16"

mode: standalone

cluster:
  instances: 3

  # 각 인스턴스를 서로 다른 zone 노드에 배치
  affinity:
    podAntiAffinityType: required
    topologyKey: topology.kubernetes.io/zone

  storage:
    size: 4Gi
    storageClass: ""

  # 백업 사용 시 WAL 스토리지 활성화 필수
  walStorage:
    enabled: true
    size: 1Gi
    storageClass: ""

  # 리소스 설정 (워크로드에 맞게 조정)
  resources: {}
    # limits:
    #   cpu: 2000m
    #   memory: 8Gi
    # requests:
    #   cpu: 2000m
    #   memory: 8Gi

  superuserSecret: "postgres-superuser-secret"

  # 클러스터 초기화 시 실행할 SQL (초기 Role/DB 생성)
  initdb:
    postInitSQL:
      - CREATE ROLE keycloak LOGIN PASSWORD '<password>';
      - CREATE DATABASE keycloak OWNER keycloak;
      # 필요한 Role/Database 추가

  monitoring:
    enabled: true
    prometheusRule:
      enabled: true

  additionalLabels:
    prometheus: main
```

`overlays/dev/resources/barman-object-store.yaml` — MinIO 백업 저장소 연결을 설정합니다.

```yaml
apiVersion: barmancloud.cnpg.io/v1
kind: ObjectStore
metadata:
  name: s3-store
spec:
  configuration:
    destinationPath: s3://postgresql-backups/
    endpointURL: http://minio.storage.svc.cluster.local:9000
    s3Credentials:
      accessKeyId:
        name: s3-store-creds
        key: ACCESS_KEY_ID
      secretAccessKey:
        name: s3-store-creds
        key: ACCESS_SECRET_KEY
    wal:
      compression: gzip
  retentionPolicy: "5d"
```

`overlays/dev/resources/backup-schedule.yaml` — 일별 베이스 백업 스케줄을 설정합니다.

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: ScheduledBackup
metadata:
  name: pg-cluster-daily-backup
spec:
  schedule: "0 0 0 * * *"   # 매일 자정
  backupOwnerReference: self
  cluster:
    name: pg-cluster
  method: plugin
  pluginConfiguration:
    name: barman-cloud.cloudnative-pg.io
```

`overlays/dev/kustomization.yaml` — Barman Cloud Plugin patch와 startup probe를 포함합니다.

```yaml
patches:
- target:
    kind: Cluster
    name: pg-cluster
  patch: |-
    - op: add
      path: /spec/plugins
      value:
        - name: barman-cloud.cloudnative-pg.io
          isWALArchiver: true
          parameters:
            barmanObjectName: s3-store

    # 대용량 DB 기동/복구 시 startup probe 실패 방지 (최대 1200초 대기)
    - op: add
      path: /spec/probes
      value:
        startup:
          initialDelaySeconds: 10
          timeoutSeconds: 5
          periodSeconds: 10
          failureThreshold: 120
```

### 5.4 배포 실행

```bash
make preview  # 적용 전 매니페스트 확인
make apply    # 클러스터에 적용
```

클러스터 초기화에 약 2~3분 소요됩니다. 클러스터가 `Cluster in healthy state` 메시지와 함께 Ready 상태가 되면 완료입니다.

---

## 6. 설치 후 검증

### 6.1 클러스터 상태 확인

```bash
kubectl get cluster pg-cluster -n database
```

예상 결과:

```
NAME         AGE   INSTANCES   READY   STATUS                     PRIMARY
pg-cluster   5m    3           3       Cluster in healthy state   pg-cluster-1
```

`READY`가 `INSTANCES`와 같고 `STATUS`가 `Cluster in healthy state`이면 정상입니다.

### 6.2 Primary/Replica 구성 확인

```bash
kubectl -n database exec pg-cluster-1 -- psql -U postgres -c \
  "SELECT inet_server_addr() AS node_ip, 'primary' AS role
   UNION ALL
   SELECT client_addr, 'replica' FROM pg_stat_replication;"
```

예상 결과 (Primary는 Unix 소켓 연결로 node_ip가 비어 있음):

```
   node_ip    |  role
--------------+---------
              | primary
 10.244.x.x   | replica
 10.244.x.x   | replica
(3 rows)
```

**확인 사항**: replica 2개가 표시되면 정상입니다.

### 6.3 서비스 엔드포인트 확인

```bash
kubectl get svc -n database | grep pg-cluster
```

예상 결과:

```
pg-cluster-r    ClusterIP   10.96.x.x   <none>   5432/TCP   # 읽기 전용 (Primary + Replica)
pg-cluster-ro   ClusterIP   10.96.x.x   <none>   5432/TCP   # 읽기 전용 (Replica only)
pg-cluster-rw   ClusterIP   10.96.x.x   <none>   5432/TCP   # 읽기/쓰기 (Primary only)
```

### 6.4 백업 상태 확인

ObjectStore와 ScheduledBackup 리소스가 정상 생성되었는지 확인합니다.

```bash
kubectl get objectstore,scheduledbackup -n database
```

첫 번째 백업이 실행된 후(자정 이후) 실행 이력을 확인합니다.

```bash
kubectl get backup -n database
```

예상 결과 (`phase: completed`):

```
NAME                               AGE   CLUSTER      METHOD   PHASE       BACKUP ID
pg-cluster-daily-backup-<ts>       1h    pg-cluster   plugin   completed   20260326T000000
```

### 6.5 Barman 메트릭 확인

```bash
kubectl -n database exec pg-cluster-1 -- python3 -c \
  "import urllib.request; print(urllib.request.urlopen('http://localhost:9187/metrics').read().decode())" \
  | grep barman_cloud
```

예상 결과:

```
barman_cloud_cloudnative_pg_io_first_recoverability_point 1.77397e+09
barman_cloud_cloudnative_pg_io_last_available_backup_timestamp 1.77440e+09
barman_cloud_cloudnative_pg_io_last_failed_backup_timestamp 0
```

**확인 사항**:
- `last_available_backup_timestamp`: `0`이 아니면 최근 성공 백업 존재
- `last_failed_backup_timestamp`: `0`이면 실패 없음

---

## 7. 운영

### 7.1 PITR 복구 (Point-in-Time Recovery)

recovery overlay를 사용하여 특정 시점으로 클러스터를 복구합니다.

`overlays/recovery/kustomization.yaml`의 `targetTime`을 복구 목표 시점으로 설정합니다.

```yaml
patches:
- target:
    kind: Cluster
    name: pg-cluster
  patch: |-
    - op: add
      path: /spec/bootstrap
      value:
        recovery:
          source: source
          recoveryTarget:
            targetTime: "2026-02-28 15:00:00+00"  # 복구 목표 시점 (UTC)

    - op: add
      path: /spec/plugins
      value:
        - name: barman-cloud.cloudnative-pg.io
          isWALArchiver: true
          parameters:
            barmanObjectName: s3-store-recovery
            serverName: pg-cluster-recovery   # 기존 serverName과 달라야 함

    - op: replace
      path: /spec/externalClusters
      value:
        - name: source
          plugin:
            name: barman-cloud.cloudnative-pg.io
            parameters:
              barmanObjectName: s3-store-recovery
              serverName: pg-cluster           # 복구 원본 백업 폴더명
```

복구를 재시도하는 경우 MinIO의 `postgresql-backups` 버킷에서 `pg-cluster-recovery` 폴더를 삭제한 후 진행합니다.

```bash
kubectl -n storage exec $POD -- mc rm --recursive --force local/postgresql-backups/pg-cluster-recovery/
make apply DEPLOY_ENV=recovery
```

### 7.2 설정 롤백

`values.yaml` 변경 후 문제가 발생한 경우:

```bash
git checkout <이전 커밋> -- cnpg/cluster/kustomize/overlays/dev/helm/values.yaml
make apply
```

**주의**: PVC를 삭제하면 데이터가 영구 삭제됩니다. `make delete`는 PVC를 보존합니다.

---

## 8. Troubleshooting

### 8.1 백업 실패 — MinIO 버킷 없음

`kubectl get backup -n database`에서 `phase: failed`, ObjectStore 로그에 S3 접근 오류가 발생합니다.

**원인**: MinIO PV 재초기화 또는 버킷 삭제 후 barman이 버킷 자동 생성에 실패합니다 (botocore 버그).

**해결**: 버킷을 수동으로 생성합니다.

```bash
POD=$(kubectl get pod -n storage -l app=minio -o jsonpath='{.items[0].metadata.name}')
kubectl -n storage exec $POD -- mc mb local/postgresql-backups
```

### 8.2 Pod 기동 시간 초과 — startup probe 실패

WAL 복구 또는 대용량 DB 기동 시 Pod가 반복 재시작됩니다.

**원인**: startup probe `failureThreshold` 내에 PostgreSQL 기동이 완료되지 않음

**해결**: `kustomization.yaml`의 patch에서 `failureThreshold`를 늘립니다 (현재 120 = 1200초). 이미 적용되어 있으면 정상 기동을 기다립니다.

### 8.3 PV 손상 — 인스턴스 재구축

특정 Pod가 CrashLoopBackOff 상태로 반복 재시작됩니다.

**원인**: PV 손상으로 PostgreSQL이 데이터 파일 체크섬 오류를 감지하고 기동을 거부

**해결**: Pod와 PVC를 함께 삭제합니다. PVC만 단독 삭제하면 Pod가 남아 Pending 상태가 되며 CNPG가 재생성하지 않습니다.

```bash
# 손상된 인스턴스 번호 확인 (예: pg-cluster-2)
kubectl get pods -n database -l cnpg.io/cluster=pg-cluster

# Pod + 데이터 PVC + WAL PVC 함께 삭제 (pg-cluster-2인 경우)
kubectl delete pod/pg-cluster-2 pvc/pg-cluster-2 pvc/pg-cluster-2-wal -n database
```

삭제 후 CNPG가 새 번호의 인스턴스(예: `pg-cluster-4`)와 PVC를 새로 프로비저닝하고 primary에서 스트리밍 복제로 재구축합니다. `kubectl get cluster pg-cluster -n database`에서 `READY 3`, `STATUS Cluster in healthy state`가 되면 완료입니다.

**주의**: replica에만 적용합니다. primary가 손상된 경우 CNPG가 정상 replica를 자동 promote하므로, promote 완료 후 구 primary(현재 replica)에 위 절차를 적용합니다.

### 8.4 Primary 장애 — 자동 Failover

Primary Pod가 삭제되거나 노드 장애가 발생하면 CNPG가 자동으로 replica를 promote합니다.

```bash
# 장애 후 클러스터 상태 확인
kubectl get cluster pg-cluster -n database
```

예상 복구 순서:

```
STATUS: Failing over          → replica promote 중
STATUS: Waiting for ...       → 새 primary(pg-cluster-3) 확정
STATUS: Cluster in healthy state  PRIMARY: pg-cluster-3
```

구 primary는 자동으로 새 replica로 재참여합니다. Failover 및 재참여 완료까지 수 분 소요될 수 있으므로 `STATUS`가 `Cluster in healthy state`로 돌아올 때까지 기다립니다.

### 8.5 노드 Drain 중 무중단 Failover

CNPG는 노드 drain 시 Eviction 이벤트를 감지하여 계획된 switchover를 수행합니다. Primary를 마지막에 종료하므로 PodDisruptionBudget이 보장되는 한 무중단입니다.

```bash
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data
```

drain 중 클러스터 상태를 모니터링합니다.

```bash
kubectl get cluster pg-cluster -n database -w
```

---

## 9. 제거

```bash
make delete
```

**주의**: `make delete`는 PVC를 삭제하지 않습니다. 데이터를 완전히 삭제하려면 PVC를 별도로 삭제합니다.

```bash
kubectl delete pvc -n database -l cnpg.io/cluster=pg-cluster
```

MinIO의 백업 데이터는 별도로 삭제합니다.

```bash
kubectl -n storage exec $POD -- mc rm --recursive --force local/postgresql-backups/pg-cluster/
```

---

## 부록. 체크리스트

**배포 전:**
- [ ] CNPG Operator 설치 완료
- [ ] MinIO `postgresql-backups` 버킷 존재 확인
- [ ] `postgres-superuser-secret` 생성 완료
- [ ] MinIO 접근 키 생성 완료
- [ ] `kustomization.yaml` S3 자격증명 업데이트 (SOPS 암호화)
- [ ] `values.yaml` initdb SQL 확인 (Role/Database 목록)

**배포:**
- [ ] `make namespace` 실행
- [ ] `make pull` 실행
- [ ] `make preview` 확인
- [ ] `make apply` 실행

**검증:**
- [ ] `kubectl get cluster` — `Cluster in healthy state` 확인
- [ ] Primary 1개 + Replica 2개 구성 확인 (`pg_stat_replication`)
- [ ] `pg-cluster-r/ro/rw` 서비스 3개 확인
- [ ] `kubectl get backup` — `phase: completed` 확인 (첫 백업 후)
- [ ] Barman 메트릭 `last_available_backup_timestamp` != `0` 확인
