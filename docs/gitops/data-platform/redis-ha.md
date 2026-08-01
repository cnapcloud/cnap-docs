---
title: "Redis HA"
sidebar_position: 1
---

Sentinel 기반 자동 failover와 HAProxy 로드 밸런싱을 갖춘 Redis High Availability 클러스터입니다.

- **버전**: `8.2.2`
- **Helm Chart 버전**: `4.35.5` (dandydeveloper/redis-ha)
- **네임스페이스**: `database`

---

## 1. 개요

Redis HA는 3개의 Redis 인스턴스(1 Master + 2 Slave)를 StatefulSet으로 구성하고, Sentinel 3개가 Master 장애를 감지하여 자동으로 새 Master를 선출합니다. HAProxy가 읽기·쓰기 트래픽을 Master 인스턴스로 라우팅하며, redis-exporter와 HAProxy Exporter가 ServiceMonitor를 통해 Prometheus 메트릭을 수집합니다. 각 컴포넌트는 `hardAntiAffinity`로 서로 다른 노드에 배치됩니다.

---

## 2. 디렉터리 구조

```
redis-ha/
├── Makefile                                  # pull / preview / apply / delete
└── kustomize/
    ├── base/
    │   └── helm/
    │       └── redis-ha/                     # make pull로 다운로드하는 Helm Chart (4.35.5)
    └── overlays/
        └── dev/
            ├── kustomization.yaml            # namespace, generators, secretGenerator
            ├── helm/
            │   ├── helm-chart.yaml           # HelmChartInflationGenerator 설정
            │   └── values.yaml              # Redis HA 환경별 파라미터
            └── secrets/
                └── redis.env                 # REDIS_PASSWORD — Git 커밋 금지
```

---

## 3. 사전 설정

### 3.1 Redis 비밀번호 파일 준비

`kustomize/overlays/dev/kustomization.yaml`의 `secretGenerator`가 `redis.env`를 읽어 `redis-auth` Secret을 생성합니다.

```bash
echo "REDIS_PASSWORD=<strong-password>" > kustomize/overlays/dev/secrets/redis.env
```

---

## 4. 배포

### 4.1 Namespace 생성

```bash
make namespace
```

### 4.2 패키지 준비

```bash
make pull
```

dandydeveloper Helm 리포지터리에서 `redis-ha 4.35.5` 차트를 `kustomize/base/helm/`에 다운로드합니다.

### 4.3 배포 설정

`kustomize/overlays/dev/helm/values.yaml` — dev 환경 Redis HA 파라미터입니다.

```yaml
# kustomize/overlays/dev/helm/values.yaml

# Redis StatefulSet 인스턴스 수: Master 1개 + Slave 2개
replicas: 3

haproxy:
  enabled: true
  # HAProxy Deployment 인스턴스 수 — replicas와 동일하게 유지하여 각 노드에 분산
  replicas: 3
  # Slave 전용 읽기 포트 — 읽기 트래픽을 Slave로 분산할 때 사용
  readOnly:
    port: 6380
  # HAProxy 리소스 설정
  resources:
    limits:
      memory: 256Mi
    requests:
      cpu: 50m
      memory: 128Mi
  # HAProxy Prometheus 메트릭 수집 설정
  metrics:
    enabled: true
    serviceMonitor:
      enabled: true
      labels:
        prometheus: main

# 비밀번호 인증 활성화
auth: true
# 비밀번호를 읽어올 Secret 이름 (3.1에서 생성한 파일)
existingSecret: redis-auth
# Secret 내 비밀번호 키
authKey: REDIS_PASSWORD

redis:
  # Sentinel이 모니터링하는 Master 그룹명 — 클라이언트 접속 시 이 이름으로 Master를 조회
  masterGroupName: "mymaster"
  # 운영 중 데이터 전체 삭제 명령 비활성화 — 실수로 인한 데이터 유실 방지
  disableCommands:
    - FLUSHDB
    - FLUSHALL
  # Redis 리소스 설정
  resources:
    limits:
      memory: 512Mi
    requests:
      cpu: 50m
      memory: 128Mi

sentinel:
  # failover 결정에 필요한 최소 동의 Sentinel 수
  # replicas=3일 때 quorum=2 → Sentinel 1개가 장애여도 failover 가능
  quorum: 2
  # Sentinel 리소스 설정
  resources:
    limits:
      memory: 256Mi
    requests:
      cpu: 50m
      memory: 128Mi

# redis-exporter: Redis 메트릭을 Prometheus 형식으로 노출하는 사이드카
exporter:
  enabled: true
  serviceMonitor:
    enabled: true
    labels:
      prometheus: main

persistentVolume:
  enabled: true
  # 기본 StorageClass 사용 — 클러스터에 기본 StorageClass가 없으면 명시적으로 지정
  storageClass: ~
  accessModes:
    - ReadWriteOnce
  size: 1Gi
```

### 4.4 배포 실행

```bash
make preview  # 적용 전 매니페스트 확인
make apply    # 클러스터에 적용
```

---

## 5. 설치 후 검증

### 5.1 Master/Slave 구성 확인

각 Redis Pod의 replication 역할을 확인합니다.

```bash
REDIS_PASSWORD=$(kubectl -n database get secret redis-auth -o jsonpath='{.data.REDIS_PASSWORD}' | base64 -d)
for i in 0 1 2; do
  echo "=== redis-ha-server-$i ==="
  kubectl -n database exec redis-ha-server-$i -c redis -- \
    redis-cli -a "$REDIS_PASSWORD" info replication 2>/dev/null \
    | grep -E "^role|connected_slaves|master_link_status"
done
```

예상 결과:

```
=== redis-ha-server-0 ===
role:master
connected_slaves:2
=== redis-ha-server-1 ===
role:slave
master_link_status:up
=== redis-ha-server-2 ===
role:slave
master_link_status:up
```

하나의 Pod가 `role:master`, 나머지 둘이 `role:slave`이며 `master_link_status:up`이면 정상입니다.

### 5.2 Sentinel 상태 확인

Sentinel이 `mymaster`를 인식하고 모니터링 중인지 확인합니다.

```bash
kubectl -n database exec redis-ha-server-0 -c sentinel -- \
  redis-cli -p 26379 sentinel masters
```

예상 결과:

```
 1) "name"
 2) "mymaster"
...
 9) "flags"
10) "master"
```

`name`이 `mymaster`이고 `flags`에 `master`가 포함되면 Sentinel이 정상 동작 중입니다.

### 5.3 HAProxy 라우팅 확인

HAProxy를 통해 접속했을 때 Master 인스턴스에 연결되는지 확인합니다.

```bash
REDIS_PASSWORD=$(kubectl -n database get secret redis-auth -o jsonpath='{.data.REDIS_PASSWORD}' | base64 -d)
kubectl -n database exec redis-ha-server-0 -c redis -- \
  redis-cli -h redis-ha-haproxy -p 6379 -a "$REDIS_PASSWORD" info replication 2>/dev/null \
  | grep "^role"
```

예상 결과:

```
role:master
```

### 5.4 Prometheus ServiceMonitor 확인

```bash
kubectl get servicemonitor -n database
```

예상 결과:

```
NAME              AGE
redis-ha          <n>m
redis-ha-haproxy  <n>m
```

두 ServiceMonitor가 생성되면 Prometheus가 Redis 인스턴스와 HAProxy 메트릭을 수집합니다.

---

## 6. 운영

### 6.1 Failover 테스트

Master Pod를 삭제하여 Sentinel이 새 Master를 선출하는지 검증합니다.

```bash
# 현재 Master 주소 확인
kubectl -n database exec redis-ha-server-0 -c sentinel -- \
  redis-cli -p 26379 sentinel get-master-addr-by-name mymaster 2>/dev/null

# Master Pod 삭제 (예: redis-ha-server-0이 Master인 경우)
kubectl delete pod redis-ha-server-0 -n database

# 새 Master 선출 확인 (Sentinel 수렴에 약 10초 소요)
kubectl -n database exec redis-ha-server-1 -c sentinel -- \
  redis-cli -p 26379 sentinel get-master-addr-by-name mymaster 2>/dev/null
```

반환된 IP가 이전과 다르면 failover 정상입니다. HAProxy는 자동으로 새 Master로 트래픽을 전환합니다.

### 6.2 롤백

Redis HA는 StatefulSet + PVC 기반 Stateful 워크로드입니다.

**설정 롤백** — `values.yaml` 변경 후 문제가 발생한 경우:

```bash
git checkout <이전 커밋> -- redis-ha/kustomize/overlays/dev/helm/values.yaml
make apply
```

**주의**: PVC를 삭제하면 해당 인스턴스의 데이터가 영구 삭제됩니다. `make delete`는 PVC를 보존하므로, 데이터를 완전히 제거하려면 제거 섹션을 참고합니다.

---

## 7. Troubleshooting

### 7.1 Pod CrashLoopBackOff — 비밀번호 불일치

**증상**: `redis-ha-server-*` Pod가 `CrashLoopBackOff` 또는 `Error` 상태

**원인**: `redis-auth` Secret의 `REDIS_PASSWORD`가 기존 PVC에 저장된 데이터의 비밀번호와 다름

**해결**: PVC를 삭제하고 올바른 비밀번호로 Secret을 재생성하거나, 비밀번호를 기존 값으로 복구합니다.

### 7.2 Sentinel quorum 미달 — Master 선출 실패

**증상**: Master Pod 장애 후 새 Master가 선출되지 않고 서비스가 중단됨

quorum 충족 여부를 직접 확인합니다.

```bash
kubectl -n database exec redis-ha-server-1 -c sentinel -- \
  redis-cli -p 26379 sentinel ckquorum mymaster 2>/dev/null
```

정상 결과:

```
OK 3 usable Sentinels. Quorum and failover authorization can be reached
```

quorum 미달 시 `NOQUORUM` 오류가 반환됩니다. 각 Sentinel의 상태를 확인합니다.

```bash
kubectl -n database exec redis-ha-server-1 -c sentinel -- \
  redis-cli -p 26379 sentinel sentinels mymaster 2>/dev/null | grep -A1 "^flags"
```

`flags` 값이 `sentinel`이면 정상, `s_down,sentinel`이면 해당 Sentinel이 장애 상태입니다.

**원인**: 동시에 2개 이상 Pod가 장애 상태여서 살아있는 Sentinel 수가 `quorum(2)` 미만

**해결**: 장애 Pod를 복구하여 Sentinel 수를 quorum 이상으로 복원합니다.

---

## 8. 제거

```bash
make delete
```

**주의**: `make delete`는 StatefulSet, Service 등을 삭제하지만 PVC는 보존합니다. 데이터를 완전히 삭제하려면 PVC를 별도로 삭제합니다.

```bash
kubectl delete pvc -n database -l app=redis-ha
```

Namespace 전체를 삭제하면 PVC를 포함한 모든 데이터가 영구 삭제됩니다.

```bash
kubectl delete namespace database
```

---

## 참고 자료

- [redis-ha Helm Chart](https://github.com/DandyDeveloper/charts/tree/master/charts/redis-ha)
- [Redis Sentinel 문서](https://redis.io/docs/management/sentinel/)
