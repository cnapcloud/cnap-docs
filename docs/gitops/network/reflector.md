---
title: "Reflector"
sidebar_position: 2
---

Kubernetes Secret과 ConfigMap을 지정한 네임스페이스로 자동 복제하는 컨트롤러입니다.

- **버전**: 9.1.44
- **Helm Chart 버전**: 9.1.44
- **네임스페이스**: `kube-system`
- **의존성**: 없음

---

## 1. 개요

Reflector는 Secret/ConfigMap에 annotation을 추가하는 것만으로 다른 네임스페이스에 자동 복제·동기화합니다. cert-manager가 발급한 TLS Secret을 여러 네임스페이스에서 공유하는 용도로 주로 사용합니다.

---

## 2. 디렉터리 구조

```
reflector/
├── Makefile
└── kustomize/
    ├── base/
    │   ├── kustomization.yaml
    │   └── helm/
    │       └── reflector/              # make pull 로 다운로드하는 Helm Chart
    │           ├── Chart.yaml
    │           └── values.yaml         # Chart 기본값 (수정하지 않음)
    └── overlays/
        └── dev/
            ├── kustomization.yaml      # 네임스페이스: kube-system
            └── helm/
                ├── helm-chart.yaml     # HelmChartInflationGenerator 설정
                └── values.yaml         # 환경별 values 오버라이드
```

---

## 3. 배포

### 3.1 패키지 준비

Emberstack 공식 리포지토리에서 Helm Chart를 다운로드합니다.

```bash
make pull
```

### 3.2 배포 설정

#### overlays/dev/helm/values.yaml

`kustomize/overlays/dev/helm/values.yaml` — dev 환경 리소스 제한을 설정합니다.

```yaml
# kustomize/overlays/dev/helm/values.yaml
resources:
  requests:
    cpu: 20m
    memory: 64Mi
  limits:
    cpu: 100m
    memory: 128Mi
```

### 3.3 배포 실행

```bash
make preview  # 적용 전 매니페스트 확인
make apply    # 클러스터에 적용
```

---

## 4. 설치 후 검증

### 4.1 복제 동작 확인

annotation을 포함한 테스트 Secret을 생성하고 대상 네임스페이스에 복제되는지 확인합니다.

```bash
kubectl create secret generic reflector-test \
  --from-literal=key=value \
  -n kube-system \
  --dry-run=client -o yaml \
  | kubectl annotate --local -f - \
    reflector.v1.k8s.emberstack.com/reflection-allowed="true" \
    reflector.v1.k8s.emberstack.com/reflection-allowed-namespaces="default" \
    reflector.v1.k8s.emberstack.com/reflection-auto-enabled="true" \
    -o yaml \
  | kubectl apply -f -
```

복제 확인:

```bash
kubectl get secret reflector-test -n default
```

예상 결과:

```
NAME              TYPE     DATA   AGE
reflector-test    Opaque   1      <n>s
```

`default` 네임스페이스에 Secret이 생성되면 정상입니다.

테스트 리소스 정리:

```bash
kubectl delete secret reflector-test -n kube-system
kubectl delete secret reflector-test -n default
```

---

## 5. Troubleshooting

### 5.1 복제가 발생하지 않음

annotation이 있는데도 대상 네임스페이스에 복제가 안 되는 경우 Reflector 로그를 확인합니다.

```bash
kubectl logs -n kube-system deployment/reflector
```

**원인**: `reflection-allowed-namespaces` 값에 대상 네임스페이스가 누락되었거나, `reflection-auto-enabled`가 `"true"`로 설정되지 않은 경우.

### 5.2 복제본이 원본 변경을 반영하지 않음

원본 Secret/ConfigMap 데이터를 변경한 뒤 복제본이 업데이트되지 않는 경우, annotation을 임시 수정하여 변경 이벤트를 트리거합니다.

```bash
kubectl annotate secret <secret명> -n <namespace> \
  reflector.v1.k8s.emberstack.com/reflection-allowed=true --overwrite
```

---

## 참고 자료

- [Reflector GitHub](https://github.com/emberstack/kubernetes-reflector)
