---
title: "Kafka"
sidebar_position: 2
---

Strimzi Operator와 KRaft 기반 Kafka 클러스터를 배포하는 가이드입니다.

- **Strimzi 버전**: 0.45.0
- **Kafka 버전**: 3.9.0
- **네임스페이스**: `messaging`

---

## 1. 개요

Strimzi는 `kafka.strimzi.io` API 그룹의 CRD를 통해 Kafka 클러스터를 선언적으로 관리하는 오픈소스 Operator입니다. KRaft 프로토콜만으로 클러스터 메타데이터를 관리하며, `KafkaNodePool`로 컨트롤러와 브로커를 역할별로 분리하여 운영합니다.

CRD 설치(Operator)와 클러스터 생성(CR)을 순서대로 배포해야 하므로 `operator/`와 `cluster/`를 분리하여 관리합니다.

---

## 2. 사전 요구사항

- **리소스**: KafkaNodePool controller 1개 + broker 3개 Pod 기동을 위해 충분한 클러스터 리소스 필요
- **StorageClass**: 각 Pod에 PVC(`10Gi`)가 프로비저닝되므로 동적 프로비저닝 가능한 StorageClass 존재 필요

---

## 3. 디렉터리 구조

```
kafka/
├── operator/
│   ├── Makefile
│   └── kustomize/
│       └── overlays/
│           └── dev/
│               ├── kustomization.yaml          # namespace: messaging
│               └── helm/
│                   ├── helm-chart.yaml         # HelmChartInflationGenerator (remote)
│                   └── values.yaml             # watchNamespaces: [messaging]
└── cluster/
    ├── Makefile
    └── kustomize/
        ├── base/
        │   ├── kustomization.yaml
        │   └── resources/
        │       ├── kafkanodepool-controller.yaml  # KafkaNodePool (controller, replicas: 1)
        │       ├── kafkanodepool-broker.yaml      # KafkaNodePool (broker, replicas: 3)
        │       └── kafka.yaml                     # Kafka CR (KRaft 활성화)
        └── overlays/
            └── dev/
                └── kustomization.yaml              # namespace: messaging
```

---

## 4. 배포

### 4.1. Operator 배포

```bash
cd kafka/operator
make pull    # strimzi-kafka-operator chart 다운로드
make preview # CRD + Operator Deployment 포함 확인
make apply   # Strimzi Operator 설치 (CRD 포함)
```

`apply`에 `--server-side=true`를 사용합니다. CRD가 대형 스키마이므로 일반 apply 시 annotation 크기 초과 오류가 발생합니다.

### 4.2. 배포 설정

클러스터는 세 개의 리소스로 구성됩니다.

**kafkanodepool-controller.yaml** — 컨트롤러 노드 풀 (KRaft) — 파티션 리더 선출, 브로커 상태 관리

```yaml
spec:
  replicas: 1
  roles:
    - controller
  storage:
    type: persistent-claim
    size: 1Gi
    deleteClaim: false
```

컨트롤러는 브로커 상태 감시, 파티션 리더 선출, 브로커 장애 시 리더 재배정, 토픽·파티션 변경 반영 등 클러스터 메타데이터를 관리합니다. `kafka.yaml`의 `strimzi.io/kraft: enabled` 어노테이션으로 KRaft가 활성화되면 이 노드 풀이 Raft 합의로 메타데이터를 처리합니다.

`replicas: 1`은 dev 환경용 설정입니다. 컨트롤러가 1개이면 Raft 합의가 성립하지 않으며, 해당 Pod에 장애가 발생하면 새 Pod가 기동될 때까지 클러스터가 일시 중단됩니다. 운영 환경에서는 `replicas: 3`으로 설정해 쿼럼(과반수)을 구성하면 컨트롤러 1개 장애에도 서비스가 유지됩니다.

`deleteClaim: false`로 설정하면 Pod 삭제 시 PVC가 유지됩니다.

**kafkanodepool-broker.yaml** — 브로커 노드 풀

```yaml
spec:
  replicas: 3
  roles:
    - broker
  storage:
    type: persistent-claim
    size: 1Gi
    deleteClaim: false
```

브로커는 실제 메시지를 저장하고 Producer/Consumer 요청을 처리하는 브로커입니다. `replicas`를 조정해 브로커 수를 변경합니다.

브로커 수를 늘리는 이유는 크게 두 가지입니다. 첫째, **가용성**: 브로커가 1개이면 해당 노드 장애 시 클러스터 전체가 중단됩니다. 브로커가 3개이면 토픽 복제본(`replication.factor: 3`)을 각 브로커에 분산해 1개 장애에도 서비스가 유지됩니다. 둘째, **처리량**: 파티션을 여러 브로커에 분산하면 Producer/Consumer I/O가 병렬로 처리되어 처리량이 선형에 가깝게 증가합니다.

두 `KafkaNodePool` 모두 `strimzi.io/cluster: kafka` 레이블이 있어야 아래 `Kafka` CR과 연결됩니다. 레이블 값은 `Kafka` CR의 `metadata.name`과 반드시 일치해야 합니다.

**kafka.yaml** — Kafka CR

```yaml
metadata:
  annotations:
    strimzi.io/node-pools: enabled   # KafkaNodePool 사용 활성화
    strimzi.io/kraft: enabled        # KRaft 모드 활성화
spec:
  kafka:
    version: 4.2.0
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
    config:
      offsets.topic.replication.factor: 1          # 컨슈머 오프셋 토픽 복제 계수
      transaction.state.log.replication.factor: 1  # 트랜잭션 로그 복제 계수
      transaction.state.log.min.isr: 1             # 트랜잭션 로그 최소 ISR
      default.replication.factor: 1                # 신규 토픽 기본 복제 계수
      min.insync.replicas: 1                       # 쓰기 성공에 필요한 최소 ISR 수
      log.segment.bytes: 134217728                 # 세그먼트 파일 최대 크기 (128MB)
      log.retention.hours: 24                      # 세그먼트 보관 기간 (1일)
      log.retention.bytes: 536870912               # 파티션당 최대 보관 크기 (512MB)
  entityOperator:
    topicOperator: {}
    userOperator: {}
```

- `listeners`: 클러스터 내부 전용 평문 리스너(9092)만 구성합니다. 외부 노출이 필요하면 `type: route` 또는 `type: loadbalancer` 리스너를 추가합니다.
- `config`: 복제 계수와 ISR을 1로 설정한 dev 환경 값입니다. 운영 환경에서는 브로커 수에 맞게 올려야 합니다. 세그먼트 크기(`log.segment.bytes: 128MB`)와 리텐션(`log.retention.bytes: 512MB`, `log.retention.hours: 24`)은 토픽에 별도 설정이 없을 때 적용되는 브로커 기본값입니다. `min.insync.replicas`는 반드시 `default.replication.factor`보다 작게 설정해야 합니다. 같거나 크면 복제본 1개 장애 시 쓰기가 즉시 차단됩니다 (예: `replication.factor: 3`, `min.insync.replicas: 2`).
- `entityOperator`: `KafkaTopic` / `KafkaUser` CR을 감시하는 Topic Operator와 User Operator를 활성화합니다.

### 4.3. 클러스터 배포

Operator가 완전히 기동된 후 클러스터를 배포합니다.

```bash
cd kafka/cluster
make preview # KafkaNodePool + Kafka CR 확인
make apply   # KafkaNodePool + Kafka 배포
```

---

## 5. 설치 후 검증

### 5.1. CRD 등록 확인

```bash
kubectl get crd kafkas.kafka.strimzi.io kafkanodepools.kafka.strimzi.io
```

예상 결과:

```
NAME                                CREATED AT
kafkas.kafka.strimzi.io             2026-04-16T...
kafkanodepools.kafka.strimzi.io     2026-04-16T...
```

### 5.2. KafkaNodePool 상태 확인

```bash
kubectl get kafkanodepool -n messaging
```

예상 결과:

```
NAME         DESIRED REPLICAS   READY
controller   1                  1
broker       3                  3
```

### 5.3. Kafka 클러스터 상태 확인

```bash
kubectl get kafka -n messaging
```

예상 결과:

```
NAME    DESIRED KAFKA REPLICAS   DESIRED ZK REPLICAS   READY   METADATA STATE
kafka   3                                              True    KRaft
```

`READY: True`, `METADATA STATE: KRaft`이면 정상입니다.

### 5.4. 토픽 생성 및 메시지 송수신 확인

테스트용 토픽을 생성하고 메시지 10건을 송수신합니다.

```bash
BOOTSTRAP=kafka-kafka-bootstrap.messaging.svc.cluster.local:9092

# 임시 Pod를 통해 토픽 생성
kubectl run kafka-test --rm -it --restart=Never \
  --image=confluentinc/cp-kafka:7.9.0 \
  -n messaging -- \
  kafka-topics --bootstrap-server $BOOTSTRAP \
    --create --topic test-topic --partitions 1 --replication-factor 1

# Producer: 메시지 10건 전송
kubectl run kafka-producer --rm -it --restart=Never \
  --image=confluentinc/cp-kafka:7.9.0 \
  -n messaging -- \
  bash -c "seq 1 10 | awk '{print \"message-\"\$1}' | \
    kafka-console-producer --bootstrap-server $BOOTSTRAP --topic test-topic"

# Consumer: 메시지 10건 수신 확인
kubectl run kafka-consumer --rm -it --restart=Never \
  --image=confluentinc/cp-kafka:7.9.0 \
  -n messaging -- \
  kafka-console-consumer --bootstrap-server $BOOTSTRAP \
    --topic test-topic --from-beginning --max-messages 10
```

Producer가 `message-1` ~ `message-10`을 전송한 뒤 종료되고, Consumer에서 10건이 출력되면 정상입니다.

```
message-1
message-2
...
message-10
Processed a total of 10 messages
```

### 5.5. Strimzi Prometheus Metrics Reporter

브로커 Pod에서 Prometheus 메트릭 엔드포인트에 직접 접근해 Strimzi Metrics Reporter가 정상 동작하는지 확인합니다.

```bash
kubectl exec -n messaging kafka-broker-0 -- curl -s localhost:9404/metrics | head -20
```

`kafka_` 또는 `jvm_` 접두사로 시작하는 메트릭이 출력되면 정상입니다.

---

## 6. 운영

### 6.1. 설정 변경

설정을 변경할 때는 CR을 삭제하지 않고 `kubectl apply`만 사용합니다. Strimzi Operator가 변경 사항을 감지해 롤링 업데이트로 적용합니다.

```bash
cd kafka/cluster
make apply
```

롤링 재시작이 필요하면 `StrimziPodSet`에 manual-rolling-update 어노테이션을 사용합니다. `KafkaNodePool`이 아닌 `StrimziPodSet`에 달아야 오퍼레이터가 감지합니다.

```bash
kubectl annotate strimzipodset kafka-broker strimzi.io/manual-rolling-update- -n messaging
kubectl annotate strimzipodset kafka-broker strimzi.io/manual-rolling-update=true -n messaging

kubectl annotate strimzipodset kafka-controller strimzi.io/manual-rolling-update- -n messaging
kubectl annotate strimzipodset kafka-controller strimzi.io/manual-rolling-update=true -n messaging
```

어노테이션이 이미 존재하면 값 변경이 없어 오퍼레이터가 이벤트를 감지하지 못합니다. `key-` 문법으로 먼저 삭제한 뒤 재설정하면 반복 실행 시에도 롤링 재시작이 트리거됩니다.

### 6.2. KRaft Cluster ID 불일치 복구

KRaft 모드에서는 클러스터 UUID가 컨트롤러 PV의 `__cluster_metadata` 로그에 영속됩니다. `Kafka` / `KafkaNodePool` CR을 삭제 후 재배포하면 Strimzi가 새 UUID를 생성하지만 기존 PVC에는 이전 UUID가 남아 있어, 브로커가 `InconsistentClusterIdException`으로 기동에 실패합니다.

**증상**

```
kafka-broker-0   0/1   Error   ...
kafka-broker-1   0/1   Error   ...
kafka-broker-2   0/1   Error   ...
```

로그에서 원인 확인:

```bash
kubectl logs kafka-broker-0 -n messaging | grep -i "cluster id"
# InconsistentClusterIdException: The Cluster ID [X] doesn't match stored clusterId [Y]
```

**복구 절차** (기존 토픽 데이터 손실)

```bash
kubectl delete kafka kafka -n messaging
kubectl delete kafkanodepool broker controller -n messaging
kubectl delete pvc -l strimzi.io/cluster=kafka -n messaging
cd kafka/cluster && make apply
```

`deleteClaim: false`는 Pod/노드 재시작 시 데이터를 보존하기 위한 설정이며, CR 자체를 삭제하고 재배포하는 시나리오를 위한 것이 아닙니다. CR을 삭제해야 하는 경우에는 반드시 PVC를 함께 삭제해야 합니다.

---

## 7. Troubleshooting

### 7.1. KafkaNodePool — `READY` 값이 0으로 유지

**증상**: `kubectl get kafkanodepool -n messaging`에서 `READY: 0`이 지속됨

**원인**: PVC 프로비저닝 실패 또는 이미지 Pull 오류

PVC 상태 확인:

```bash
kubectl get pvc -n messaging
```

PVC가 `Pending` 상태이면 StorageClass 설정 문제입니다. 클러스터에 기본 StorageClass가 있는지 확인합니다.

```bash
kubectl get storageclass
```

### 7.2. Kafka CR — `READY: False`

**증상**: `kubectl get kafka -n messaging`에서 `READY: False`가 지속됨

**원인**: `KafkaNodePool`의 `strimzi.io/cluster` 레이블이 `Kafka` CR `metadata.name`과 불일치

`kafkanodepool-*.yaml`의 레이블 확인:

```yaml
metadata:
  labels:
    strimzi.io/cluster: kafka   # Kafka CR metadata.name과 일치 필요
```

Strimzi Operator 로그에서 상세 오류를 확인합니다.

```bash
kubectl logs -n messaging -l strimzi.io/kind=cluster-operator --tail=50
```

### 7.3. Entity Operator Pod — `CrashLoopBackOff`

**증상**: `kafka-entity-operator-*` Pod가 CrashLoopBackOff

**원인**: Kafka 브로커 기동 전에 Entity Operator가 먼저 기동 시도. 브로커 READY 이전에 일시적으로 발생하는 정상 재시도임

`READY: 3`이 확인되면 Entity Operator도 자동으로 안정화됩니다.

### 7.4. KafkaTopic — 최초 배포 후 토픽 미생성

**증상**: `kubectl get kafkatopic -n messaging`에서 CR이 보이지 않거나 `NotReady` 상태가 지속됨

**원인**: 배포 시 모든 리소스가 동시에 적용되는데, Topic Operator가 `KafkaTopic` CR을 감지해 토픽 생성을 시도하는 시점에 Kafka 브로커가 아직 준비되지 않아 실패함. 이후 CR에 변경 이벤트가 없으면 reconcile이 재트리거되지 않아 미생성 상태로 남음

재배포로 `KafkaTopic` CR에 변경 이벤트가 발생하여 Topic Operator가 reconcile을 재실행합니다.

```bash
cd kafka/cluster && make apply
```

---

## 8. 제거

클러스터를 먼저 삭제한 후 Operator를 삭제합니다. Operator가 없으면 CR Finalizer를 처리할 수 없어 리소스가 Terminating 상태로 남습니다.

```bash
cd kafka/cluster && make delete
cd kafka/operator && make delete
```

CRD를 완전히 제거하려면 아래 명령을 실행합니다.

**주의**: CRD 삭제 시 클러스터 내 모든 `Kafka`, `KafkaNodePool` CR 및 관련 데이터가 함께 삭제됩니다.

```bash
kubectl get crd | grep strimzi.io | awk '{print $1}' | xargs kubectl delete crd
```

---

## 부록. 체크리스트

**배포 전:**
- [ ] `messaging` 네임스페이스 생성 (`kubectl create namespace messaging`)
- [ ] 동적 PVC 프로비저닝 가능한 StorageClass 존재 확인

**Operator 배포:**
- [ ] `make pull` — Helm Chart 다운로드
- [ ] `make preview` — CRD + `strimzi-cluster-operator` Deployment 포함 확인
- [ ] `make apply` — Strimzi Operator 설치

**클러스터 배포:**
- [ ] `cd kafka/cluster && make preview` — `KafkaNodePool` × 2, `Kafka` CR 포함 확인
- [ ] `make apply` — KafkaNodePool + Kafka 배포

**검증:**
- [ ] `kubectl get crd kafkas.kafka.strimzi.io` — CRD 등록 확인
- [ ] `kubectl get kafkanodepool -n messaging` — controller `READY: 1`, broker `READY: 3` 확인
- [ ] `kubectl get kafka -n messaging` — `READY: True`, `METADATA STATE: KRaft` 확인
- [ ] 토픽 생성 및 메시지 송수신 확인
