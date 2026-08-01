---
title: "OpenSearch 2 클러스터"
sidebar_position: 7
---

OpenSearch 2를 Kubernetes에 Transport TLS와 Security Plugin을 적용하여 배포합니다.

- **OpenSearch 버전**: 2.19.4
- **Helm Chart 버전**: 2.37.0
- **네임스페이스**: `database`
- **의존성**: cert-manager (`selfsigned-issuer` ClusterIssuer), `nfs` StorageClass

---

## 1. 개요

OpenSearch는 분산 검색·분석 엔진으로, 이 환경에서는 로그 및 이벤트 데이터의 저장·검색 백엔드로 활용합니다. Transport TLS로 노드 간 통신을 암호화하고, Security Plugin으로 내부 사용자 인증과 역할 기반 접근 제어를 구성합니다. HTTP SSL은 비활성화되어 있어 클러스터 내부 접근 시 `http://`를 사용합니다. Prometheus Exporter 플러그인과 ServiceMonitor로 메트릭을 수집하고, Grafana 대시보드를 자동으로 임포트합니다.

---

## 2. 사전 요구사항

- **cert-manager**: 설치 및 `selfsigned-issuer` ClusterIssuer 생성 완료 ([cert-manager](../network/cert-manager.md))
- **StorageClass**: `nfs` StorageClass 사용 가능
- **리소스**: 3-node HA 구성 시 노드당 최소 4GB RAM, 3개 이상의 워커 노드

---

## 3. 디렉터리 구조

```
opensearch2/cluster/
├── Makefile                                    # 배포 자동화 스크립트
└── kustomize/
    ├── base/
    │   ├── configmap/
    │   │   └── opensearch-dashborad.json        # Grafana 대시보드 정의
    │   ├── helm/
    │   │   └── opensearch/                      # OpenSearch Helm Chart (pull 명령어로 다운로드)
    │   ├── resources/
    │   │   ├── certificate.yaml                 # cert-manager Transport TLS 인증서
    │   │   ├── internal_users.yaml              # Security Plugin 내부 사용자 정의
    │   │   ├── roles_mapping.yaml               # Security Plugin 역할 매핑
    │   │   └── security_config.yaml             # Security Plugin 인증 설정
    │   └── kustomization.yaml
    └── overlays/
        └── dev/
            ├── helm/
            │   ├── helm-chart.yaml              # Helm Chart Inflation Generator 설정
            │   ├── values.yaml                  # 3-node 클러스터 values
            │   └── values-single.yaml           # 단일 노드 values (dev/test용)
            └── kustomization.yaml               # 환경별 Kustomize 구성 (Secret 포함)
```

`overlays/dev/helm/`의 values 파일:

| 파일 | 설명 | replicas |
|------|------|----------|
| `values-single.yaml` | 단일 노드 (dev/test) | 1 |
| `values.yaml` | 3-node 클러스터 (운영) | 3 |

---

## 4. 배포

### 4.1 Namespace 생성

```bash
make namespace
```

### 4.2 Helm Chart 다운로드

```bash
make pull
```

`opensearch` Helm 리포지토리를 추가·업데이트하고, Chart v2.37.0을 `kustomize/base/helm/opensearch/`에 압축 해제합니다.

### 4.3 배포 설정

**배포 모드 선택**: `overlays/dev/helm/helm-chart.yaml`에서 `valuesFile`을 설정합니다.

```yaml
# helm-chart.yaml — 단일 노드 (1개 노드, dev/test)
valuesFile: ./helm/values-single.yaml
```

```yaml
# helm-chart.yaml — 3-node 클러스터 (운영)
valuesFile: ./helm/values.yaml
```

**리소스 및 JVM 설정**: 선택한 values 파일에서 환경에 맞게 조정합니다.

```yaml
opensearchJavaOpts: "-Xmx512m -Xms512m"   # heap size — resources.limits.memory의 50% 이하

resources:
  requests:
    cpu: 500m
    memory: 700Mi
  limits:
    cpu: 1000m    # 3-node는 2000m
    memory: 1500Mi

persistence:
  size: 3Gi    # 노드당 PVC 크기 — watermark 설정과 함께 조정
```

**주의**: `opensearchJavaOpts`의 `-Xmx`/`-Xms`는 `resources.limits.memory`의 50% 이하로 설정합니다. 초과 시 OOM Kill이 발생합니다.

**디스크 watermark**: `config.opensearch.yml` 블록 내 watermark는 `persistence.size`에 맞게 조정합니다.

```yaml
config:
  opensearch.yml: |-
    # PVC가 작을수록 여유 없이 설정 (3Gi 기준 97/98/99%)
    # 디스크 여유가 충분하면 85/90/95%로 완화 가능
    cluster.routing.allocation.disk.watermark.low: "97%"
    cluster.routing.allocation.disk.watermark.high: "98%"
    cluster.routing.allocation.disk.watermark.flood_stage: "99%"
```

`flood_stage`에 도달하면 해당 노드의 인덱스가 자동으로 read-only로 전환됩니다. PVC 크기를 늘릴 때는 watermark도 함께 완화합니다.

**3-node 클러스터 추가 설정**: `values.yaml`은 단일 노드 대비 다음 항목이 다릅니다.

| 항목 | `values-single.yaml` (1노드) | `values.yaml` (3노드) |
|------|------|------|
| `replicas` | 1 | 3 |
| `resources.limits.cpu` | 1000m | 2000m |
| REST API 보안 설정 | 포함 | 미포함 |
| ES 호환성 모드 | 미포함 | 포함 |

`values-single.yaml`에는 Security REST API 직접 호출을 허용하는 설정이 포함되어 있습니다 (단일 노드 dev 환경에서 securityadmin 스크립트 없이 설정 변경 가능).

```yaml
# values-single.yaml 전용
plugins.security.unsupported.restapi.allow_securityconfig_modification: true
plugins.security.restapi.roles_enabled: ["all_access", "security_rest_api_access"]
```

`values.yaml`에는 Jaeger spark-dependencies 호환을 위한 ES 버전 오버라이드가 포함되어 있습니다.

```yaml
# values.yaml 전용
compatibility.override_main_response_version: true
```

**주의**: 3-node 구성 시 `antiAffinity: hard`로 설정되어 있어 워커 노드가 3개 이상이어야 Pod 스케줄링이 가능합니다.

**admin 비밀번호 설정**: `overlays/dev/kustomization.yaml`의 secretGenerator에서 설정합니다.

```yaml
secretGenerator:
- name: opensearch-credential
  literals:
  - username=admin
  - password=<admin-password>
```

**주의**: 운영 환경에서는 반드시 강력한 비밀번호로 변경합니다.

### 4.4 배포 실행

```bash
make preview
make apply
```

---

## 5. 설치 후 검증

### 5.1 TLS 인증서 확인

```bash
kubectl get certificate -n database
```

`opensearch-transport-cert`의 `READY` 컬럼이 `True`인지 확인합니다.

### 5.2 클러스터 상태 확인

```bash
kubectl exec -n database opensearch-cluster-master-0 -- \
  curl -s http://localhost:9200/_cluster/health \
  -u admin:<admin-password> | jq '{status, number_of_nodes, active_shards}'
```

`status`가 `green` 또는 `yellow`이고, `number_of_nodes`가 배포한 replicas 수와 일치하는지 확인합니다. `red`인 경우 일부 샤드가 미할당 상태이므로 Pod 로그를 확인합니다.

### 5.3 인덱스 CRUD 확인

인덱스 생성 → 문서 추가 → 조회 → 삭제 순서로 기본 읽기·쓰기 동작을 확인합니다.

```bash
BASE="http://localhost:9200"; CREDS="admin:<admin-password>"; INDEX="test-verify"

echo "=== Create index ==="
kubectl exec -n database opensearch-cluster-master-0 -- \
  curl -s -X PUT "$BASE/$INDEX" -u "$CREDS" \
  -H "Content-Type: application/json" \
  -d '{"settings":{"number_of_shards":1,"number_of_replicas":0}}' | jq .acknowledged

echo "=== Index document ==="
kubectl exec -n database opensearch-cluster-master-0 -- \
  curl -s -X POST "$BASE/$INDEX/_doc/1" -u "$CREDS" \
  -H "Content-Type: application/json" \
  -d '{"message":"hello opensearch"}' | jq .result

echo "=== Get document ==="
kubectl exec -n database opensearch-cluster-master-0 -- \
  curl -s "$BASE/$INDEX/_doc/1" -u "$CREDS" | jq .

echo "=== Delete index ==="
kubectl exec -n database opensearch-cluster-master-0 -- \
  curl -s -X DELETE "$BASE/$INDEX" -u "$CREDS" | jq .acknowledged
```

각 단계별 예상 결과:

| 단계 | 확인 필드 | 정상값 |
|------|-----------|--------|
| 인덱스 생성 | `acknowledged` | `true` |
| 문서 추가 | `result` | `"created"` |
| 문서 조회 | `found` | `true` |
| 인덱스 삭제 | `acknowledged` | `true` |

### 5.4 Prometheus 메트릭 확인

```bash
kubectl exec -n database opensearch-cluster-master-0 -- \
  curl -s http://localhost:9200/_prometheus/metrics | head -20
```

`# TYPE opensearch_` 형식의 메트릭 라인이 출력되면 Prometheus Exporter 플러그인이 정상 동작하는 것입니다.


---

## 6. 운영

### 6.1 Security Plugin 재적용

`internal_users.yaml`, `roles_mapping.yaml`, `security_config.yaml`을 변경한 경우 재배포 후 StatefulSet을 재시작합니다.

```bash
make apply
kubectl rollout restart statefulset/opensearch-cluster-master -n database
```

### 6.2 롤백

OpenSearch는 StatefulSet으로 PVC에 데이터를 보관합니다. Chart 버전을 낮출 경우 인덱스 포맷 호환성을 반드시 확인합니다.

**주의**: 데이터 손실이 우려될 경우 PVC 스냅샷을 먼저 생성한 뒤 진행합니다.

이전 values 파일로 복구합니다.

```bash
make apply
```

---

## 7. Troubleshooting

### 7.1 Security index 초기화 실패

**증상**: Pod Running 상태이나 `_cluster/health` 호출 시 보안 인덱스 관련 오류 반환

**원인**: `opensearch.yml`의 `plugins.security.allow_default_init_securityindex: false` 설정

**해결**: `values.yaml`에서 해당 설정을 `true`로 변경 후 재배포합니다.

### 7.2 Transport TLS 인증서 미발급

**증상**: Pod CrashLoopBackOff, 로그에 Transport TLS 키스토어 관련 오류

**원인**: cert-manager 미설치 또는 `selfsigned-issuer` ClusterIssuer 미생성

**해결**:

```bash
kubectl get clusterissuer selfsigned-issuer
kubectl describe certificate opensearch-transport-cert -n database
```

### 7.3 Prometheus 메트릭 수집 실패

**증상**: ServiceMonitor가 생성되었으나 Prometheus 타겟이 DOWN

**원인**: Prometheus Exporter 플러그인 미설치 또는 BasicAuth Secret 불일치

**해결**: Pod 로그에서 플러그인 설치 성공 여부를 확인하고, `opensearch-credential` Secret의 username/password가 admin 자격증명과 일치하는지 검증합니다.

### 7.4 vm.max_map_count 부족

**증상**: Pod CrashLoopBackOff, 로그에 `max virtual memory areas vm.max_map_count [65530] is too low` 오류

**원인**: 노드의 `vm.max_map_count` 값이 OpenSearch 최소 요구치(262144) 미만

**해결**: `values.yaml`에서 `sysctlInit.enabled: true`를 확인합니다. DaemonSet으로 노드 설정을 자동으로 변경합니다.

---

## 8. 업그레이드

Chart 버전 변경 시 다음 항목을 함께 업데이트합니다.

1. `Makefile`의 `--version` 값
2. `values.yaml` / `values-single.yaml`의 `opensearchVersion`, `image.tag`
3. `values.yaml` 내 Prometheus Exporter 플러그인 설치 URL의 버전 — Chart 자동 관리 대상이 아니므로 수동 업데이트 필요

```bash
make pull
make apply
```

---

## 9. 제거

**주의**: PVC를 삭제하면 인덱스 데이터가 복구 불가능하게 삭제됩니다.

```bash
make delete
kubectl delete pvc -n database -l app.kubernetes.io/instance=opensearch
```

---

## 부록. 체크리스트

**배포 전:**
- [ ] cert-manager 설치 및 `selfsigned-issuer` ClusterIssuer 생성
- [ ] `nfs` StorageClass 사용 가능 여부 확인
- [ ] `make pull` 실행 (Helm Chart 다운로드)
- [ ] admin 비밀번호 설정 (`overlays/dev/kustomization.yaml`)
- [ ] 배포 모드 선택 (`values-single.yaml` 또는 `values.yaml`)

**검증:**
- [ ] TLS 인증서 Ready 상태 (`opensearch-transport-cert`)
- [ ] 클러스터 상태 `green` 또는 `yellow`, `number_of_nodes` 일치
- [ ] Prometheus 메트릭 엔드포인트 응답 확인 (`# TYPE opensearch_` 출력)
- [ ] 인덱스 CRUD 테스트 통과 (생성/문서추가/조회/삭제 모두 정상)
