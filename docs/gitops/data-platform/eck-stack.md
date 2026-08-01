---
title: "ECK 클러스터"
sidebar_position: 6
---

ECK Operator로 Elasticsearch 클러스터와 Kibana를 배포합니다.

- **버전**: `Elasticsearch 7.17.16`, `Kibana 7.17.16`
- **네임스페이스**: `database`
- **접속 URL**: `https://kibana.cnapcloud.com`
- **의존성**: [ECK Operator](eck-operator.md), [cert-manager](../network/cert-manager.md), [Reflector](../network/reflector.md)

---

## 1. 개요

Elasticsearch 3노드 클러스터와 Kibana 1노드를 배포합니다. TLS는 Ingress에서 종료하며 내부 통신은 평문입니다. `podAntiAffinity` (required)로 각 Elasticsearch Pod가 반드시 별도 노드에 스케줄링되므로 **워커 노드 3개 이상**이 필요합니다.

---

## 2. 사전 요구사항

- **ECK Operator**: `database` 네임스페이스에 설치 완료 ([eck-operator](eck-operator.md))
- **워커 노드**: 3개 이상 (Elasticsearch podAntiAffinity required 조건)
- **TLS Secret**: `cnapcloud.com-tls`가 `database` 네임스페이스에 존재 (cert-manager + reflector)
- **DNS**: `kibana.cnapcloud.com` 등록

---

## 3. 디렉터리 구조

```
eck/ek/
├── Makefile
└── kustomize/
    ├── base/
    │   ├── kustomization.yaml          # secretGenerator, 리소스 목록
    │   └── resources/
    │       ├── elasticsearch.yaml      # Elasticsearch 3노드 클러스터
    │       ├── kibana.yaml             # Kibana 1노드
    │       └── ingress.yaml            # Kibana Ingress (kibana.cnapcloud.com)
    └── overlays/
        ├── dev/
        │   └── kustomization.yaml      # namespace: database, TZ=Asia/Seoul
        └── dev-arm64/
            └── kustomization.yaml      # dev + _JAVA_OPTIONS=-XX:UseSVE=0 (ARM64용)
```

---

## 4. 사전 설정

Elasticsearch 인증에 사용할 Secret을 `base/kustomization.yaml`의 `secretGenerator`로 생성합니다.

```yaml
secretGenerator:
  - name: es-elastic-user
    type: kubernetes.io/basic-auth
    literals:
      - username=elastic
      - password=<password>
      - roles=superuser
```

**주의**: `password` 값을 평문으로 Git에 커밋하지 않습니다. SOPS로 암호화하거나 외부 Secret 관리 도구를 사용합니다.

---

## 5. 배포

### 5.1 배포 설정

`base/resources/elasticsearch.yaml` — 주요 설정:

- **노드 수**: 3 (master + data + ingest 통합)
- **sysctl**: `vm.max_map_count=262144`, `fs.file-max=65536` (initContainer)
- **podAntiAffinity**: required — 각 Pod를 반드시 별도 노드에 배치
- **preStop**: 종료 전 샤드 재배치 후 대기 (최대 280초)
- **TLS**: 비활성화 (Ingress에서 종료)

ARM64 노드에 배포하는 경우 `overlays/dev-arm64`를 사용합니다. SVE 명령어 비호환 문제를 피하기 위해 `_JAVA_OPTIONS=-XX:UseSVE=0`을 추가합니다.

### 5.2 배포 실행

```bash
make preview  # 적용 전 매니페스트 확인
make apply    # 클러스터에 적용 (x86)

# ARM64 노드인 경우
make preview DEPLOY_ENV=dev-arm64
make apply DEPLOY_ENV=dev-arm64
```

---

## 6. 설치 후 검증

### 6.1 CRD 상태 확인

```bash
kubectl get elasticsearch,kibana -n database
```

예상 결과 — 두 리소스 모두 `health: green`, `phase: Ready`:

```
NAME                                              HEALTH   NODES   VERSION   PHASE
elasticsearch.elasticsearch.k8s.elastic.co/...   green    3       7.17.16   Ready

NAME                                   HEALTH   NODES   VERSION   AGE
kibana.kibana.k8s.elastic.co/kibana    green    1       7.17.16   ...
```

### 6.2 Elasticsearch 클러스터 헬스 확인

```bash
kubectl exec -n database elasticsearch-es-default-0 -- \
  curl -s -u elastic:<password> http://localhost:9200/_cluster/health?pretty
```

예상 결과:

```json
{
  "status" : "green",
  "number_of_nodes" : 3,
  "active_shards_percent_as_number" : 100.0
}
```

### 6.3 Kibana UI 접근 확인

브라우저에서 `https://kibana.cnapcloud.com` 접속 시 Kibana 로그인 화면이 표시됩니다. `elastic` / `<password>`로 로그인합니다.

---

## 7. Troubleshooting

### 7.1 Elasticsearch Pod Pending — podAntiAffinity 충족 불가

**증상**: Elasticsearch Pod 중 일부가 `Pending` 상태

**원인**: `requiredDuringSchedulingIgnoredDuringExecution` 조건으로 3개 Pod가 각각 별도 노드를 요구하는데 가용 노드 부족

**해결**: 워커 노드를 3개 이상으로 확장하거나, `elasticsearch.yaml`의 `podAntiAffinity`를 `preferredDuringSchedulingIgnoredDuringExecution`으로 변경합니다.

### 7.2 vm.max_map_count 오류

**증상**: Elasticsearch Pod가 `max virtual memory areas vm.max_map_count [65530] is too low` 오류로 기동 실패

**원인**: sysctl initContainer 실행 실패 또는 권한 부족

**해결**: initContainer가 `privileged: true`로 설정되어 있는지 확인합니다. PodSecurityPolicy 또는 Security Context가 privileged 실행을 차단하는 경우 노드에 직접 `sysctl -w vm.max_map_count=262144`를 적용합니다.

### 7.3 Kibana — Elasticsearch 연결 실패

**증상**: Kibana Pod가 기동 후 `kibana_task_manager` 인덱스 생성 중 오류

**원인**: Elasticsearch가 아직 `green` 상태가 아니거나 `es-elastic-user` Secret 불일치

**해결**: Elasticsearch `phase: Ready` 확인 후 Kibana Pod를 재시작합니다.

---

## 8. 제거

**주의**: `make delete`로 Elasticsearch를 삭제하면 PVC가 남아 있어도 데이터 복구가 어렵습니다. 삭제 전 스냅샷 백업을 권장합니다.

```bash
make delete
```

PVC는 별도로 삭제해야 합니다.

```bash
kubectl delete pvc -n database -l elasticsearch.k8s.elastic.co/cluster-name=elasticsearch
```
