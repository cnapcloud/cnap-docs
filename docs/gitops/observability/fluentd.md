---
title: "Fluentd"
sidebar_position: 3
---

클러스터 전체 컨테이너 로그를 수집해 OpenSearch로 전송하는 DaemonSet 기반 로그 수집기입니다.

- **버전**: `v1.19.2-debian-opensearch-1.3`
- **Helm Chart 버전**: `fluent/fluentd 0.5.3`
- **네임스페이스**: `lma`
- **의존성**: [OpenSearch](../data-platform/opensearch-cluster.md)

---

## 1. 개요

Fluentd는 모든 노드에 DaemonSet으로 배포되어 `/var/log/containers/*.log`를 tail로 수집합니다. `kubernetes_metadata` 필터로 Pod/Namespace 메타데이터를 붙인 뒤, OpenSearch에 `fluentd-logs-YYYY-MM-DD` 형식의 일별 인덱스로 저장합니다.

로그 보관 기간은 Curator CronJob(`fluentd-log-cleaner`)이 매일 23:55 KST에 실행해 `RETENTION_DAYS`일(기본 3일) 이상 된 인덱스를 삭제하는 방식으로 관리합니다. Prometheus 메트릭(포트 24231)과 Grafana 대시보드가 함께 배포됩니다.

Helm Chart는 `kustomize/base/helm/`에 저장되어 있으며, Kustomize의 `HelmChartInflationGenerator` 플러그인으로 배포 시 렌더링됩니다.

---

## 2. 사전 요구사항

- **OpenSearch**: `opensearch-cluster-master.database.svc:9200` 접근 가능 ([opensearch-cluster](../data-platform/opensearch-cluster.md))
- **네임스페이스**: `lma` 존재 (Prometheus 배포 시 생성됨 — [prometheus](prometheus.md))

---

## 3. 디렉터리 구조

```
fluentd/
├── Makefile                                   # pull / preview / apply / delete / diff
└── kustomize/
    ├── base/
    │   └── helm/
    │       └── fluentd/                       # Helm 차트 (make pull로 다운로드)
    └── overlays/
        └── dev/
            ├── kustomization.yaml             # namespace: lma, generator/resource/patch 선언
            ├── helm/
            │   ├── helm-chart.yaml            # HelmChartInflationGenerator 설정
            │   └── values.yaml                # 파이프라인·버퍼·OpenSearch 설정
            ├── patches/
            │   └── daemonset-env.yaml         # DaemonSet OpenSearch 인증 env 주입
            ├── resources/
            │   ├── curator.yaml               # 로그 보관 정책 CronJob
            │   └── fluentd-opensearch-secret.yaml  # SopsSecretGenerator
            └── secrets/
                └── sops/
                    └── fluentd-opensearch.enc.env   # SOPS 암호화 인증 정보
```

---

## 4. 배포

### 4.1. 배포 설정

파이프라인 설정은 `kustomize/overlays/dev/helm/values.yaml`의 `fileConfigs` 섹션에서 관리합니다.

`04_outputs.conf`의 OpenSearch 접속 정보는 모두 환경변수로 참조합니다.

```yaml
# fluentd/kustomize/overlays/dev/helm/values.yaml — 04_outputs.conf 발췌

<match **>
  @type opensearch
  host "#{ENV['OPENSEARCH_HOST']}"
  port "#{ENV['OPENSEARCH_PORT']}"
  path ""
  user "#{ENV['OPENSEARCH_USER']}"
  password "#{ENV['OPENSEARCH_PASSWORD']}"
  suppress_type_name true
  request_timeout 30s
  include_timestamp true
  @log_level info
  logstash_format true
  logstash_prefix "fluentd-logs"
  logstash_dateformat "%Y-%m-%d"
  <buffer>
    @type file
    path /var/log/fluentd-buffers/
    flush_mode interval
    flush_interval 2m
    flush_thread_count 4
    flush_thread_burst_interval 1
    timekey 20s
    timekey_wait 5s
    chunk_limit_size 1M
    queue_limit_length 32
    overflow_action drop_oldest_chunk
  </buffer>
</match>
```

환경변수는 `kustomize/overlays/dev/patches/daemonset-env.yaml`을 통해 DaemonSet에 주입됩니다.

| 환경변수 | 값 | 출처 |
|---|---|---|
| `OPENSEARCH_HOST` | `opensearch-cluster-master.database.svc` | 직접 지정 |
| `OPENSEARCH_PORT` | `9200` | 직접 지정 |
| `OPENSEARCH_USER` | — | `fluentd-opensearch-credentials` Secret |
| `OPENSEARCH_PASSWORD` | — | `fluentd-opensearch-credentials` Secret |

Secret(`fluentd-opensearch-credentials`)은 `secrets/sops/fluentd-opensearch.enc.env`를 SOPS로 복호화해 생성됩니다.

### 4.2. Curator 설정

`kustomize/overlays/dev/resources/curator.yaml`의 환경변수에서 보관 정책과 실행 스케줄을 관리합니다.

```yaml
# fluentd/kustomize/overlays/dev/resources/curator.yaml

# CronJob 실행 스케줄 (UTC 기준 — 한국시간 23:55)
schedule: "55 14 * * *"

# 보관 기간 환경변수
env:
  - name: OPENSEARCH_ENDPOINT
    value: "http://opensearch-cluster-master.database.svc:9200"
  - name: OPENSEARCH_USER   # fluentd-opensearch-credentials Secret에서 주입
    valueFrom:
      secretKeyRef: ...
  - name: OPENSEARCH_PASSWORD
    valueFrom:
      secretKeyRef: ...
  - name: RETENTION_DAYS
    value: "3"              # 보관 기간 (일) — 이 값보다 오래된 fluentd-logs-* 인덱스 삭제
```

보관 기간(`RETENTION_DAYS`)이나 스케줄(`schedule`)을 변경한 후 `make apply`로 반영합니다.

### 4.3. 배포 실행

```bash
cd fluentd
make preview  # 적용 전 매니페스트 확인
make apply    # 클러스터에 적용
```

> **참고**: Helm 차트 버전을 올릴 때는 `Makefile`의 `--version` 값 수정 후 `make pull`로 차트를 갱신한 뒤 `make apply`합니다.

---

## 5. 설치 후 검증

### 5.1. OpenSearch 인덱스 생성 확인

DaemonSet이 기동되면 수 분 내에 오늘 날짜 인덱스가 생성됩니다.

```bash
kubectl exec -n database opensearch-cluster-master-0 -- \
  curl -s -u admin:password \
  "http://localhost:9200/_cat/indices/fluentd-logs-*?h=index,docs.count,store.size&s=index"
```

예상 결과:

```
fluentd-logs-2026-03-28 274311 96.2mb
```

### 5.2. Prometheus 메트릭 수집 확인

ServiceMonitor가 등록되면 Prometheus가 각 노드의 Fluentd 메트릭을 수집합니다.

```bash
kubectl port-forward -n lma ds/fluentd 24231:24231 &
curl -s http://localhost:24231/metrics | grep fluentd_input_status_num_records_total
```

예상 결과: `fluentd_input_status_num_records_total{...}` 카운터 출력

### 5.3. Curator CronJob 동작 확인

```bash
kubectl get cronjob fluentd-log-cleaner -n lma
kubectl get job -n lma | grep fluentd-log-cleaner
```

**확인 사항**: CronJob이 존재하고, 마지막 실행 Job의 상태가 `Complete`인지 확인

---

## 6. 운영

### 6.1. 로그 보관 기간 변경

`kustomize/overlays/dev/resources/curator.yaml`의 `RETENTION_DAYS` 값을 수정한 후 `make apply`로 반영합니다.

### 6.2. Curator 수동 실행

보관 기간 변경 후 즉시 정리하거나 디스크 여유 공간이 필요할 때 CronJob을 즉시 트리거합니다.

```bash
kubectl create job --from=cronjob/fluentd-log-cleaner fluentd-log-cleaner-manual -n lma
kubectl logs -n lma job/fluentd-log-cleaner-manual
```

### 6.3. 파이프라인 설정 변경

`kustomize/overlays/dev/helm/values.yaml`의 `fileConfigs` 섹션(소스·필터·출력)을 수정한 후 배포합니다.

```bash
make apply
```

### 6.4. Helm 차트 버전 업그레이드

`Makefile`의 `--version` 값을 수정한 후 차트를 재다운로드합니다.

```bash
make pull   # kustomize/base/helm/ 갱신
make apply
```

---

## 7. Troubleshooting

### 7.1. 로그가 OpenSearch에 쌓이지 않음

```bash
kubectl logs -n lma -l app.kubernetes.io/name=fluentd --tail=50 | grep -E "error|warn|connect"
```

**원인**: OpenSearch 연결 실패 또는 인증 오류

**해결**: `kustomize/overlays/dev/patches/daemonset-env.yaml`의 `OPENSEARCH_HOST`, `OPENSEARCH_PORT` 값 확인. 인증 오류인 경우 `secrets/sops/fluentd-opensearch.enc.env` 내용 확인 후 `make apply`

### 7.2. 버퍼 큐 초과로 로그 유실

**증상**: Fluentd 로그에 `dropping oldest chunk` 메시지 반복 출력

**원인**: OpenSearch 응답이 느리거나 일시 불가 상태에서 버퍼 큐(`queue_limit_length: 32`)가 가득 참

**해결**: OpenSearch 상태 확인 후 정상화되면 자동 복구됩니다. 유실 허용이 불가한 경우 `queue_limit_length`를 늘리거나 `overflow_action`을 `block`으로 변경합니다 (단, 노드 디스크 사용량 증가 주의).

### 7.3. kubernetes_metadata 플러그인 에러

**증상**: `Failed to fetch metadata` 경고 로그 반복

**원인**: ClusterRole 권한 부족 또는 kube-apiserver 응답 지연

**해결**:

```bash
kubectl get clusterrolebinding fluentd
kubectl auth can-i get pods --as=system:serviceaccount:lma:fluentd
```

### 7.4. Curator Job 실패

```bash
kubectl get job -n lma | grep fluentd-log-cleaner   # suffix 확인
kubectl logs -n lma job/fluentd-log-cleaner-<suffix>
```

**원인**: OpenSearch 접속 불가 또는 인증 오류. `secrets/sops/fluentd-opensearch.enc.env`의 자격 증명 확인
