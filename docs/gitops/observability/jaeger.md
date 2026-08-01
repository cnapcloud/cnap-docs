---
title: "Jaeger"
sidebar_position: 2
---

분산 추적(Distributed Tracing) 플랫폼. 마이크로서비스 간 요청 흐름을 추적하고 성능 병목을 시각화합니다.

- **버전**: `2.16.0`
- **Helm Chart 버전**: `jaegertracing/jaeger 4.6.0`
- **네임스페이스**: `lma`
- **접속 URL**: `https://jaeger.cnapcloud.com` (Keycloak 인증)
- **의존성**: [OpenSearch](../data-platform/opensearch-cluster.md), [oauth2-proxy](../auth-routing/oauth2-proxy.md)

---

## 1. 개요

Jaeger v2는 OpenTelemetry Collector 기반의 단일 바이너리로 동작합니다. v1의 Operator + 분리된 Collector/Query 구조 대신, OTEL Collector 파이프라인 설정으로 수신(receiver) → 처리(processor) → 저장(exporter)을 구성합니다. 트레이스 저장소로 OpenSearch를 사용하며, Query UI는 oauth2-proxy를 통해 Keycloak 인증을 적용합니다.

클러스터 내부 앱은 `jaeger.lma.svc` 서비스로 OTLP를 전송하고, 외부에서는 `otlp.cnapcloud.com`(HTTP) / `otel.cnapcloud.com`(gRPC) 인그레스를 통해 전송합니다.

---

## 2. 사전 요구사항

- **OpenSearch**: `opensearch-cluster-master.database.svc:9200` 접근 가능 ([opensearch-cluster](../data-platform/opensearch-cluster.md))
- **oauth2-proxy**: `lma-jaeger-query` Ingress 인증에 사용 ([oauth2-proxy](../auth-routing/oauth2-proxy.md))
- **DNS**: `jaeger.cnapcloud.com`, `otlp.cnapcloud.com`, `otel.cnapcloud.com` 등록
- **TLS**: `cnapcloud.com-tls` Secret이 `lma` 네임스페이스에 존재 (cert-manager + reflector가 공통 인프라로 관리)
- **OpenSearch 호환성 모드**: OpenSearch가 ES 7.10.2 버전으로 응답하도록 설정 완료

OpenSearch 호환성 모드는 `opensearch2/cluster/kustomize/overlays/dev/helm/values.yaml`의 `opensearch.yml`에 아래 설정이 포함되어 있어야 합니다.

```yaml
compatibility.override_main_response_version: true
```

---

## 3. 디렉터리 구조

```
jaeger/
├── Makefile                                  # 배포 자동화 (pull / preview / apply / delete)
└── kustomize/
    ├── base/
    │   ├── kustomization.yaml
    │   └── helm/
    │       └── jaeger/                       # jaegertracing/jaeger Helm chart (vendored)
    └── overlays/
        └── dev/
            ├── kustomization.yaml            # generators + resources + patches 구성
            ├── helm/
            │   ├── helm-chart.yaml           # HelmChartInflationGenerator
            │   └── values.yaml               # Jaeger v2 OTEL 파이프라인 및 스토리지 설정
            ├── patches/
            │   ├── es-index-cleaner-credentials.yaml  # esIndexCleaner Secret 주입
            │   ├── spark-credentials.yaml             # spark Secret 주입
            │   └── spark-fix-null-references.yaml     # spark initContainer (null references 수정)
            └── resources/
                ├── jaeger-ingress-query.yaml          # Query UI ingress (Keycloak 인증 포함)
                ├── jaeger-ingress-oltp.yaml           # OTLP HTTP ingress (otlp.cnapcloud.com)
                ├── jaeger-ingress-grpc.yaml           # OTLP gRPC ingress (otel.cnapcloud.com)
                └── opensearch-credentials.yaml        # OpenSearch 인증 Secret
```

---

## 4. 배포

### 4.1. 패키지 준비

Helm chart를 로컬에 다운로드합니다.

```bash
make pull
```

### 4.2. 배포 설정

`kustomize/overlays/dev/helm/values.yaml` — OTEL Collector 파이프라인과 OpenSearch 스토리지를 설정합니다.

**OTEL Collector 파이프라인 (`userconfig`)**:

```yaml
userconfig:
  service:
    extensions: [jaeger_storage, jaeger_query, healthcheckv2]
    pipelines:
      traces:
        receivers: [otlp, jaeger]
        processors: [batch]
        exporters: [jaeger_storage_exporter]

  extensions:
    jaeger_storage:
      backends:
        primary_store:
          elasticsearch:
            server_urls: ["http://opensearch-cluster-master.database.svc:9200"]
            auth:
              basic:
                username: ${OPENSEARCH_USERNAME}
                password: ${OPENSEARCH_PASSWORD}

  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
        http:
          endpoint: 0.0.0.0:4318
    jaeger:
      protocols:
        grpc:
          endpoint: 0.0.0.0:14250
        thrift_http:
          endpoint: 0.0.0.0:14268
```

**ES 유지보수 Job 설정**:

```yaml
storage:
  type: elasticsearch
  elasticsearch:
    url: http://opensearch-cluster-master.database.svc:9200
    user: OVERRIDDEN_BY_SECRET    # opensearch-credentials Secret으로 주입
    password: OVERRIDDEN_BY_SECRET

spark:
  enabled: true
  schedule: "0 15 * * *"
  resources:
    requests:
      memory: 512Mi
    limits:
      memory: 1Gi
  extraEnv:
    - name: ES_NODES_WAN_ONLY
      value: "true"

esIndexCleaner:
  enabled: true
  numberOfDays: 3
  schedule: "0 15 * * *"

esRollover:
  enabled: false  # use-aliases: false 이므로 비활성화
```

> **참고**: OpenSearch 인증 정보는 `resources/opensearch-credentials.yaml` Secret과 `patches/spark-credentials.yaml`, `patches/es-index-cleaner-credentials.yaml` 패치를 통해 주입됩니다. `values.yaml`에 평문으로 작성하지 않습니다.

**주의**: `esRollover`를 활성화하면 Jaeger 재설치 시 alias 초기화와 Collector 기동 간 경합이 발생하여 인덱스 구조가 깨집니다. `use-aliases: false` 상태에서는 `esRollover`를 비활성화합니다.

### 4.3. 배포 실행

```bash
make preview  # 적용 전 매니페스트 확인
make apply    # 클러스터에 적용
```

---

## 5. 설치 후 검증

### 5.1. 트레이스 수신 확인

클러스터 내부에서 OTLP HTTP로 테스트 span을 전송합니다.

```bash
NOW_NS=$(date +%s)000000000
END_NS=$(($(date +%s) + 1))000000000

kubectl -n lma run jaeger-test --image=curlimages/curl:latest --restart=Never --rm -i -- \
  curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://jaeger.lma.svc:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d "{\"resourceSpans\":[{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"test-service\"}}]},\"scopeSpans\":[{\"spans\":[{\"traceId\":\"aaaaaaaabbbbbbbbccccccccdddddddd\",\"spanId\":\"aaaaaaaabbbbbbbb\",\"name\":\"test-span\",\"startTimeUnixNano\":\"${NOW_NS}\",\"endTimeUnixNano\":\"${END_NS}\",\"kind\":1}]}]}]}"
```

예상 결과:

```
200
```

### 5.2. OpenSearch 인덱스 생성 확인

span 전송 후 오늘 날짜의 인덱스가 생성됩니다.

```bash
OS_USER=$(kubectl get secret opensearch-credentials -n lma -o jsonpath='{.data.username}' | base64 -d)
OS_PASS=$(kubectl get secret opensearch-credentials -n lma -o jsonpath='{.data.password}' | base64 -d)
kubectl -n database exec opensearch-cluster-master-0 -- \
  curl -s -u "${OS_USER}:${OS_PASS}" "http://localhost:9200/_cat/indices/jaeger*?v&s=index"
```

예상 결과:

```
health status index                     uuid  pri rep docs.count ...
yellow open   jaeger-service-2026-03-27 ...   5   1   1          ...
yellow open   jaeger-span-2026-03-27    ...   5   1   1          ...
```

### 5.3. Query API 확인

```bash
kubectl -n lma run jaeger-query-test --image=curlimages/curl:latest --restart=Never --rm -i -- \
  curl -s "http://jaeger.lma.svc:16686/api/services"
```

예상 결과:

```json
{"data":["test-service"],"total":1,"limit":0,"offset":0,"errors":null}
```

### 5.4. Query UI 접근 확인

브라우저에서 `https://jaeger.cnapcloud.com` 접속 시 Keycloak 로그인 화면으로 리다이렉트된 후 인증이 완료되면 Jaeger UI가 표시됩니다.

---

## 6. 운영

### 6.1. 앱에서 트레이스 전송 설정

클러스터 내부 앱은 아래 엔드포인트로 OTLP를 전송합니다.

| 프로토콜 | 엔드포인트 |
|---------|-----------|
| OTLP HTTP | `http://jaeger.lma.svc:4318` |
| OTLP gRPC | `jaeger.lma.svc:4317` |
| Jaeger Thrift HTTP (레거시) | `http://jaeger.lma.svc:14268` |
| Jaeger gRPC (레거시) | `jaeger.lma.svc:14250` |

**주의**: v1에서 마이그레이션한 경우 기존 앱이 `jaeger-collector.lma.svc`를 참조하고 있다면 `jaeger.lma.svc`로 변경해야 합니다.

### 6.2. 인덱스 보존 기간 변경

`values.yaml`의 `esIndexCleaner.numberOfDays` 값을 수정합니다.

```yaml
esIndexCleaner:
  numberOfDays: 7   # 원하는 보존 일수로 변경
```

### 6.3. OpenSearch 재설치 후 조치

OpenSearch를 재설치하는 경우 PVC 보존 여부에 따라 조치가 다릅니다.

**PVC 보존 재설치 (pod 재생성만)**

`compatibility.override_main_response_version: true`가 `opensearch.yml`에 포함되어 있으므로 별도 조치 없이 자동 적용됩니다. Jaeger는 기존 날짜별 인덱스를 그대로 사용합니다.

**PVC 삭제 후 완전 재설치**

OpenSearch 기동 후 Jaeger가 첫 트레이스를 수신하면 오늘 날짜의 인덱스를 자동 생성합니다. 별도 초기화 작업은 필요하지 않습니다.

- 기존 트레이스 데이터는 복구 불가
- Jaeger Collector와 Query는 재시작 없이 자동으로 신규 인덱스에 연결됨

호환성 모드 적용 여부는 아래 명령으로 확인합니다.

```bash
OS_USER=$(kubectl get secret opensearch-credentials -n lma -o jsonpath='{.data.username}' | base64 -d)
OS_PASS=$(kubectl get secret opensearch-credentials -n lma -o jsonpath='{.data.password}' | base64 -d)
kubectl -n database exec opensearch-cluster-master-0 -- \
  curl -s -u "${OS_USER}:${OS_PASS}" "http://localhost:9200/" | grep number
```

예상 결과 — `7.10.2`가 반환되어야 합니다.

```json
"number" : "7.10.2"
```

`2.x.x`가 반환되면 OpenSearch 배포 설정에 호환성 모드가 누락된 것입니다. [사전 요구사항](#2-사전-요구사항) 항목을 확인합니다.

---

### 6.4. spark-dependencies (서비스 의존성 그래프)

매일 15:00에 `jaeger-spark` CronJob이 실행되어 Jaeger UI의 Dependencies 탭 데이터를 생성합니다. 수동 실행 시:

```bash
kubectl -n lma create job jaeger-spark-manual --from=cronjob/jaeger-spark
```

CronJob에는 initContainer(`fix-null-references`)가 포함되어 있습니다. Jaeger v2가 root span의 `references` 필드를 `null`로 저장하는 버그([jaegertracing/spark-dependencies#157](https://github.com/jaegertracing/spark-dependencies/issues/157))로 인해 spark-dependencies가 NPE로 실패하는 것을 방지합니다. spark 실행 전 당일 인덱스(`jaeger-span-YYYY-MM-DD`)의 `null` → `[]` 변환을 수행합니다.

### 6.5. esIndexCleaner 수동 실행

매일 15:00에 `jaeger-es-index-cleaner` CronJob이 실행되어 `numberOfDays`보다 오래된 인덱스를 삭제합니다. 수동으로 즉시 실행하려면:

```bash
kubectl -n lma create job jaeger-es-index-cleaner-manual --from=cronjob/jaeger-es-index-cleaner
kubectl -n lma logs job/jaeger-es-index-cleaner-manual
kubectl -n lma delete job jaeger-es-index-cleaner-manual
```

---

## 7. Troubleshooting

### 7.1. spark-dependencies Job 실패 — OpenSearch 버전 인식 오류

**증상**: `jaeger-spark` Job이 Error 상태, 로그에 아래 오류 발생

```
EsHadoopIllegalStateException: Invalid major version [2.x.x]. Version is lower than minimum required version [6.x].
```

**원인**: OpenSearch가 자신의 실제 버전(2.x)으로 응답 — elasticsearch-hadoop이 거부

**해결**: `opensearch2/cluster/kustomize/overlays/dev/helm/values.yaml`의 `opensearch.yml`에 호환성 모드를 추가하고 재배포합니다.

```yaml
compatibility.override_main_response_version: true
```

### 7.2. Collector 기동 후 span 저장 실패 — 인덱스 alias 구조 깨짐

**증상**: `esRollover` Job 실패, `jaeger-span-write`가 alias가 아닌 index로 존재

**원인**: Collector가 먼저 기동되어 `jaeger-span-write` index를 직접 생성 → 이후 rollover init이 같은 이름으로 alias 생성 불가

**해결**: `values.yaml`에서 `esRollover.enabled: false`로 설정하고, alias index를 삭제 후 rollover init을 수동 실행합니다.

```bash
# alias 구조 오염된 index 삭제 (데이터 손실 주의)
kubectl -n database exec opensearch-cluster-master-0 -- \
  curl -s -u admin:password -X DELETE \
  "http://localhost:9200/jaeger-span-write,jaeger-service-write"

# rollover init 실행
kubectl -n lma run jaeger-es-rollover-init --image=jaegertracing/jaeger-es-rollover:2.16.0 \
  --restart=Never --env="ES_USERNAME=admin" --env="ES_PASSWORD=password" \
  -- init http://opensearch-cluster-master.database.svc:9200
```

dev 환경에서는 `esRollover`를 비활성화하고 날짜별 인덱스 방식을 사용하는 것을 권장합니다.

### 7.3. values.yaml 변경 후 kubectl apply가 반영되지 않음

**증상**: `make apply` 실행 후 `configured`로 출력되지만 CronJob의 실제 spec(args 등)이 변경되지 않음

**원인**: 기존 리소스가 `kubectl apply` 외의 방법(Helm 직접 설치 등)으로 생성되어 `last-applied-configuration` annotation이 없는 경우, `apply`의 3-way merge가 정상 동작하지 않음

**해결**: `kubectl replace`로 리소스를 교체합니다.

```bash
kubectl kustomize --enable-helm jaeger/kustomize/overlays/dev | kubectl replace -f -
```

이후 apply부터는 annotation이 추가되어 정상 반영됩니다.

### 7.4. spark-dependencies Job 실패 — NullPointerException (references: null)

**증상**: `jaeger-spark` Job이 Error 상태, 로그에 아래 오류 발생

```
Caused by: java.lang.NullPointerException
  at SpanDeserializer.deserializeReferences(SpanDeserializer.java:100)
```

**원인**: Jaeger v2가 root span(부모 없는 span)의 `references` 필드를 `[]` 대신 `null`로 저장하는 버그. `spark-dependencies`는 null을 처리하지 못해 NPE로 실패합니다.

- upstream 코드 수정: [jaegertracing/spark-dependencies#157](https://github.com/jaegertracing/spark-dependencies/issues/157) (PR #156, 2025-07-07 merge)
- Docker Hub(`jaegertracing/spark-dependencies`) 최신 이미지는 2021년 빌드(`latest` = `0.0.1-SNAPSHOT`)로 수정이 미포함. `0.5.1` 태그 미존재.
- Docker Hub에 수정된 이미지가 배포되면 `spark.image.tag: "0.5.1"`로 고정하고 initContainer 제거 가능

**해결**: `patches/spark-fix-null-references.yaml` initContainer가 spark 실행 전 당일 인덱스의 `null` → `[]`를 자동 변환합니다. initContainer가 누락된 경우 수동으로 수정합니다.

```bash
OS_USER=$(kubectl get secret opensearch-credentials -n lma -o jsonpath='{.data.username}' | base64 -d)
OS_PASS=$(kubectl get secret opensearch-credentials -n lma -o jsonpath='{.data.password}' | base64 -d)

kubectl run os-fix --rm -it --image=curlimages/curl --restart=Never -n lma -- \
  curl -s -u "${OS_USER}:${OS_PASS}" -X POST \
  "http://opensearch-cluster-master.database.svc:9200/jaeger-span-$(date -u +%Y-%m-%d)/_update_by_query" \
  -H "Content-Type: application/json" \
  -d '{
    "script": {"source": "if (ctx._source.references == null) { ctx._source.references = [] }", "lang": "painless"},
    "query": {"bool": {"must_not": {"exists": {"field": "references"}}}}
  }'
```

### 7.5. spark-dependencies Job 실패 — ES 노드 discovery 오류

**증상**: `jaeger-spark` Job 로그에 connection refused 또는 node discovery 실패

**원인**: elasticsearch-hadoop이 Kubernetes Service 뒤의 노드를 직접 discovery 시도

**해결**: `values.yaml`의 `spark.extraEnv`에 `ES_NODES_WAN_ONLY: "true"` 설정이 있는지 확인합니다.

```yaml
spark:
  extraEnv:
    - name: ES_NODES_WAN_ONLY
      value: "true"
```

---

## 참고 자료

- [Jaeger v2 공식 문서](https://www.jaegertracing.io/docs/latest/)
- [jaegertracing/helm-charts](https://github.com/jaegertracing/helm-charts)
- [OpenTelemetry Collector 설정](https://opentelemetry.io/docs/collector/configuration/)
