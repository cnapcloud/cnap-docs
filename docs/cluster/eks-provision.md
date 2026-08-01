---
title: "EKS 클러스터 프로비저닝"
sidebar_position: 1
---

**목차**
- [1. 개요](#1-개요)
  - [1.1 구축 범위](#11-구축-범위)
  - [1.2 아키텍처 개요](#12-아키텍처-개요)
  - [1.3 환경별 특징](#13-환경별-특징)
  - [1.4 Quick Start](#14-quick-start)
- [3. 사전 준비 및 도구 설치](#3-사전-준비-및-도구-설치)
  - [3.1 환경 선택 및 정보 확보](#31-환경-선택-및-정보-확보)
    - [3.1.1 환경 선택](#311-환경-선택)
    - [3.1.2 배포 준비](#312-배포-준비)
  - [3.2 AWS 계정 및 IAM 설정](#32-aws-계정-및-iam-설정)
    - [3.2.1 IAM 사용자 생성](#321-iam-사용자-생성)
    - [3.2.2 AWS 프로필 설정 (선택)](#322-aws-프로필-설정-선택)
  - [3.3 필수 도구 설치](#33-필수-도구-설치)
    - [3.3.1 AWS CLI](#331-aws-cli)
    - [3.3.2 Session Manager Plugin](#332-session-manager-plugin)
    - [3.3.3 SSH Key Pair](#333-ssh-key-pair)
    - [3.3.4 Terraform](#334-terraform)
    - [3.3.5 kubectl](#335-kubectl)
    - [3.3.6 Helm \& Kustomize (GitOps 배포용)](#336-helm--kustomize-gitops-배포용)
- [4. Terraform 기반 EKS Cluster 구축](#4-terraform-기반-eks-cluster-구축)
  - [4.1 환경 선택 및 변수 설정](#41-환경-선택-및-변수-설정)
    - [4.1.1 환경 디렉토리 구조](#411-환경-디렉토리-구조)
    - [4.1.2 terraform.tfvars 설정](#412-terraformtfvars-설정)
  - [4.2 Backend 상태 관리](#42-backend-상태-관리)
    - [4.2.1 Local Backend (개인 개발용)](#421-local-backend-개인-개발용)
    - [4.2.2 S3 Backend (팀 협업용) - 권장](#422-s3-backend-팀-협업용---권장)
  - [4.3 CloudWatch 로그 그룹](#43-cloudwatch-로그-그룹)
  - [4.4 EKS 클러스터 배포](#44-eks-클러스터-배포)
    - [4.4.1 Terraform 초기화 및 계획](#441-terraform-초기화-및-계획)
    - [4.4.2 클러스터 배포](#442-클러스터-배포)
    - [4.4.3 배포 확인](#443-배포-확인)
  - [4.5 Terraform Output 확인](#45-terraform-output-확인)
    - [4.5.1 Terraform Output → GitOps 매핑](#451-terraform-output--gitops-매핑)
    - [4.5.2 EKS Cluster ControlPlane로그](#452-eks-cluster-controlplane로그)
- [5. GitOps 기반 인프라 컴포넌트 배포](#5-gitops-기반-인프라-컴포넌트-배포)
  - [5.1 사전 준비](#51-사전-준비)
    - [5.1.1 도구 확인](#511-도구-확인)
    - [5.1.2 Prometheus CRD 설치](#512-prometheus-crd-설치)
  - [5.2 배포 개요](#52-배포-개요)
    - [5.2.1 의존성 및 배포 순서](#521-의존성-및-배포-순서)
    - [5.2.2 공통 배포 패턴 이해](#522-공통-배포-패턴-이해)
  - [5.2.3 배포 설정](#523-배포-설정)
    - [5.2.4 System Node 레이블 필수 요구사항](#524-system-node-레이블-필수-요구사항)
    - [5.2.5 CRD 배포 주의사항](#525-crd-배포-주의사항)
  - [5.3 StorageClass](#53-storageclass)
    - [5.3.1 개요](#531-개요)
    - [5.3.2 StorageClass 매니페스트](#532-storageclass-매니페스트)
    - [5.3.3 배포 실행](#533-배포-실행)
    - [5.3.4 배포 확인](#534-배포-확인)
  - [5.4 cert-manager](#54-cert-manager)
    - [5.4.1 개요](#541-개요)
    - [5.4.2 배포 준비](#542-배포-준비)
    - [5.4.3 배포 설정](#543-배포-설정)
    - [5.4.4 배포 실행](#544-배포-실행)
    - [5.4.5 배포 확인](#545-배포-확인)
    - [5.4.6 기능 테스트](#546-기능-테스트)
  - [5.5 AWS Load Balancer Controller](#55-aws-load-balancer-controller)
    - [5.5.1 개요](#551-개요)
    - [5.5.2 사전 요구사항](#552-사전-요구사항)
    - [5.5.3 배포 설정](#553-배포-설정)
    - [5.5.4 배포 실행](#554-배포-실행)
    - [5.5.5 배포 확인](#555-배포-확인)
  - [5.6 노드 스케일링](#56-노드-스케일링)
    - [5.6.1 Karpenter vs Cluster Autoscaler 선택 가이드](#561-karpenter-vs-cluster-autoscaler-선택-가이드)
    - [5.6.2 Karpenter 배포 (권장)](#562-karpenter-배포-권장)
      - [5.6.2.1 개요](#5621-개요)
      - [5.6.2.2 사전 요구사항](#5622-사전-요구사항)
      - [5.6.2.3 배포 준비](#5623-배포-준비)
      - [5.6.2.4 배포 설정](#5624-배포-설정)
      - [5.6.2.5 배포 실행](#5625-배포-실행)
      - [5.6.2.6 배포 확인](#5626-배포-확인)
      - [5.6.2.7 노드 스케일링 테스트](#5627-노드-스케일링-테스트)
      - [5.6.2.8 Karpenter 노드 SSM 접속](#5628-karpenter-노드-ssm-접속)
    - [5.6.3 Cluster Autoscaler 배포 (대안)](#563-cluster-autoscaler-배포-대안)
      - [5.6.3.1 개요](#5631-개요)
      - [5.6.3.2 사전 요구사항](#5632-사전-요구사항)
      - [5.6.3.3 배포 설정](#5633-배포-설정)
      - [5.6.3.4 배포 실행](#5634-배포-실행)
  - [5.7 Bottlerocket Update Operator(선택)](#57-bottlerocket-update-operator선택)
    - [5.7.1 개요](#571-개요)
    - [5.7.2 배포 설정](#572-배포-설정)
    - [5.7.3 배포 준비](#573-배포-준비)
    - [5.7.4 배포 실행](#574-배포-실행)
    - [5.7.5 배포 확인](#575-배포-확인)
- [6. 클러스터 운영 및 관리](#6-클러스터-운영-및-관리)
  - [6.1 Bastion 접속](#61-bastion-접속)
    - [6.1.1 SSM 세션 (권장, 보안)](#611-ssm-세션-권장-보안)
    - [6.1.2 SSH 접근 (Bastion이 public subnet에 있을 경우)](#612-ssh-접근-bastion이-public-subnet에-있을-경우)
  - [6.2 EKS 클러스터 접속](#62-eks-클러스터-접속)
  - [6.3 EKS 클러스터 엔드포인트 설정](#63-eks-클러스터-엔드포인트-설정)
- [7. 애플리케이션 배포 예제](#7-애플리케이션-배포-예제)
  - [7.1 Nginx 배포](#71-nginx-배포)
    - [7.1.1 PersistentVolumeClaim 생성](#711-persistentvolumeclaim-생성)
    - [7.1.2 Nginx Deployment with PVC](#712-nginx-deployment-with-pvc)
  - [7.2 ALB Ingress 설정](#72-alb-ingress-설정)
      - [7.2.1 주요 설정 항목](#721-주요-설정-항목)
      - [7.2.2 Ingress 리소스 생성](#722-ingress-리소스-생성)
      - [7.2.3 배포 확인 및 접근](#723-배포-확인-및-접근)
      - [7.2.4 도메인 설정](#724-도메인-설정)
- [8. 클러스터 삭제](#8-클러스터-삭제)
  - [8.1 애플리케이션 삭제](#81-애플리케이션-삭제)
  - [8.2 GitOps 인프라 컴포넌트 삭제](#82-gitops-인프라-컴포넌트-삭제)
  - [8.3 Terraform EKS Cluster 삭제](#83-terraform-eks-cluster-삭제)
  - [8.4 S3, DynamoDB, 로그 삭제](#84-s3-dynamodb-로그-삭제)
- [9. 트러블슈팅](#9-트러블슈팅)
  - [9.1 연결 문제](#91-연결-문제)
  - [9.2 노드 생성 문제](#92-노드-생성-문제)
  - [9.3 Ingress 문제](#93-ingress-문제)
- [10. 참고자료](#10-참고자료)
  - [10.1 공식 문서](#101-공식-문서)
  - [10.2 자주 묻는 질문](#102-자주-묻는-질문)
  - [10.3 성능 최적화](#103-성능-최적화)
  - [10.4 보안 강화](#104-보안-강화)
- [기여](#기여)

## 1. 개요

### 1.1 구축 범위

이 설치 가이드는 실제 프로덕션 환경에 적용 가능한 EKS 클러스터를 구축하는 것을 목표로 합니다. Terraform으로 VPC와 기본 인프라를 자동화하고, 인프라 컴포넌트는 Kustomize 기반 GitOps로 별도 배포합니다. 이러한 구성은 클러스터 생성 후 개발과 운영 단계에서 자주 변경되는 컴포넌트 설정에 신속하게 대응할 수 있으며, 모든 변경 내용을 Git으로 추적 관리할 수 있게 합니다.

- ✅ **완전 자동화된 인프라 구축**: 한 번의 명령으로 VPC부터 EKS까지 전체 구축
- ✅ **즉시 사용 가능한 스케일링**: Karpenter 또는 Cluster Autoscaler로 노드 자동 관리
- ✅ **SSL/TLS 인증서 자동화**: cert-manager로 Let's Encrypt 인증서 자동 발급
- ✅ **로드밸런서 준비 완료**: AWS ALB Controller로 Ingress 즉시 사용 가능
- ✅ **보안 강화**: Bastion 및 SSM 기반 접근 제어와 IAM Role 적용, OS 패치 자동화

관련 소스 코드는 Private Repository로 관리되고 있으며, 접근이 필요한 경우 별도로 권한을 요청해 주시면 [GitHub Repository](https://github.com/cnapcloud/eks-cluster.git)를 통해 제공해 드립니다.


### 1.2 아키텍처 개요
```
┌───────────────────────────────────────────────────────┐
│                    AWS EKS Cluster                    │
│  ┌─────────────────────────────────────────────────┐  │
│  │              VPC (10.0.0.0/16)                  │  │
│  │  ┌──────────────────────────────────────────┐   │  │
│  │  │ Public Subnets (3 AZs)                   │   │  │
│  │  │ ├─ NAT Gateway × 3                       │   │  │
│  │  │ ├─ ALB                                   │   │  │
│  │  │ └─ Bastion EC2                           │   │  │
│  │  └──────────────────────────────────────────┘   │  │
│  │  ┌──────────────────────────────────────────┐   │  │
│  │  │ Private Subnets (3 AZs)                  │   │  │
│  │  │ ├─ EKS Managed Node Group                │   │  │
│  │  │ |   └─ EKS Addons:                       │   │  │
│  │  │ |      ├─ CoreDNS                        │   │  │
│  │  │ |      ├─ kube-proxy                     │   │  │
│  │  │ |      ├─ vpc-cni                        │   │  │
│  │  │ |      ├─ eks-pod-identity-agent         │   │  │
│  │  │ |      └─ aws-ebs-csi-driver             │   │  │
│  │  | └─ Karpenter Managed Node Group          │   │  │
│  │  └──────────────────────────────────────────┘   │  │
│  │  ┌──────────────────────────────────────────┐   │  │
│  │  │ Intra Subnets (3 AZs)                    │   │  │
│  │  │ └─ EKS Control Plane ENI                 │   │  │
│  │  └──────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │         GitOps Components (Kubernetes)          │  │
│  │                                                 │  │
│  │  Required:                                      │  │
│  │  ├─ StorageClass       (TLS Certificate)        │  │
│  │  └─ cert-manager                                │  │
│  │                                                 │  │
│  │  Compute:                                       │  │
│  │  ├─ Karpenter          (Recommended: Fast)      │  │
│  │  └─ Cluster Autoscaler (Alternative: Stable)    │  │
│  │                                                 │  │
│  │  Additional:                                    │  │
│  │  ├─ AWS Load Balancer Controller  (Ingress)     │  │
│  │  └─ Bottlerocket Update Operator  (Optional)    │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

### 1.3 환경별 특징

| Category                      | DEV        | STG      | PRD        |
| ----------------------------- | ---------- | -------- | ---------- |
| **Purpose**                   | Dev/Test   | Pre-prod | Production |
| **Availability Requirement**  | Low        | Medium   | High       |
| **Cost Optimization**         | ✔︎          | ✗        | ✗          |
| **node_group_desired_size**   | 2          | 2        | 3          |
| **node_group_instance_types** | t3.medium  | m5.large | m5.xlarge  |
| **use_karpenter**             | true/false | true     | true       |
| **endpoint_public_access**    | true       | false    | false      |

---

### 1.4 Quick Start

**이미 AWS CLI와 Terraform이 설치되어 있다면 [3.2.1 IAM 사용자 생성](#321-iam-사용자-생성) 후에 다음 명령을 실행하세요.**

⚠️ 주의:
- CloudWatch Log Group이 기존에 존재하면 EKS 생성이 실패할 수 있습니다. [4.3 CloudWatch 로그 그룹](#43-cloudwatch-로그-그룹)을 반드시 사전에 확인하세요.
- endpoint_public_access = false 인 경우, GitOps AWS 인프라 관리 컴포넌트는 Bastion VM에서 설치하세요.

```bash
# 1. dev 환경 배포
cd terraform/envs/dev
terraform init
terraform apply

# 2. Terraform Output 저장 (중요!)
terraform output > /tmp/tf-output.txt

# 3. kubeconfig 업데이트
aws eks update-kubeconfig --name eks-dev --region ap-northeast-2

# 4. 클러스터 확인
kubectl get nodes
```

**Terraform Output 예상 결과:**
```
Outputs:

alb_controller_irsa_arn       = "arn:aws:iam::020211325831:role/eks-dev-alb-controller-xxxxx"
cluster_autoscaler_irsa_arn   = "arn:aws:iam::020211325831:role/eks-dev-cluster-autoscaler-xxxxx" # 
custer_name                   = "eks-dev"
kapenter = false 인 경우
karpenter_queue_name          = "Karpenter-eks-dev" # kapentert = true 인 경우
vpc_id                        = "vpc-0xxxxx"
...
```

> 💡 이 Output 값들은 GitOps AWS 인프라 관리 컴포넌트 배포 시 필요합니다. 어딘가 저장해두세요!

다음 단계에서는 Terraform Output 값을 기반으로
GitOps 저장소에 애드온(ALB Controller, Karpenter 등)을 배포합니다.

---

## 3. 사전 준비 및 도구 설치

### 3.1 환경 선택 및 정보 확보

#### 3.1.1 환경 선택

**어떤 환경을 배포할지 결정하세요.**

```bash
# dev 환경 추천
# - 첫 구축: dev로 시작
# - 테스트: 변경 사항 먼저 dev에서 검증
# - 비용: 가장 저렴

# stg 환경 추천
# - 프로덕션 배포 전 최종 검증
# - prd와 동일한 설정

# prd 환경 추천
# - 실제 운영 환경
# - 높은 가용성 요구
```

#### 3.1.2 배포 준비

배포 전에 다음을 준비하세요:

- [ ] AWS 계정 ID (12자리 숫자)
- [ ] AWS 리전 (기본값: `ap-northeast-2`)
- [ ] SSH Key Pair 이름 (EC2 Bastion 접근용)
- [ ] Terraform 상태 저장소 선택 (Local 또는 S3)

### 3.2 AWS 계정 및 IAM 설정

#### 3.2.1 IAM 사용자 생성

AWS Management Console에서 IAM 사용자를 생성합니다.

**단계:**
1. AWS Management Console > IAM > 사용자
2. 사용자 생성: 사용자 이름 = `eks-admin`
3. 권한 정책 첨부:
   - `AdministratorAccess`
   - `AmazonSSMManagedInstanceCore`
4. 보안 자격 증명 탭 > 액세스 키 생성

**생성된 Access Key 저장:**
```
Access Key ID: AKIA...
Secret Access Key: xxxxxx...
```

#### 3.2.2 AWS 프로필 설정 (선택)

여러 AWS 계정을 사용한다면 프로필 설정을 권장합니다:

```bash
# 기본 프로필
aws configure --profile eks-admin

# 또는 직접 환경 변수로
export AWS_PROFILE=eks-admin
export AWS_REGION=ap-northeast-2
```

### 3.3 필수 도구 설치

#### 3.3.1 AWS CLI

```bash
# macOS
brew install awscli

# Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# 설치 확인
aws --version
aws sts get-caller-identity
```

#### 3.3.2 Session Manager Plugin

```bash
# macOS
brew install session-manager-plugin

# Linux
curl -o session-manager-plugin.deb \
  https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb
sudo dpkg -i session-manager-plugin.deb

# 설치 확인
session-manager-plugin --version
```

#### 3.3.3 SSH Key Pair

```bash
# Ed25519 권장 (더 짧고 안전)
ssh-keygen -t ed25519 -f ~/.ssh/aws-key -N ""

# AWS에 등록
aws ec2 import-key-pair \
  --key-name "aws-key" \
  --public-key-material fileb://~/.ssh/aws-key.pub

# 확인
aws ec2 describe-key-pairs --query 'KeyPairs[*].KeyName'
```

#### 3.3.4 Terraform

```bash
# macOS
brew install terraform

# Linux (또는 공식 설치)
curl https://releases.hashicorp.com/terraform/1.14.0/terraform_1.14.0_linux_amd64.zip -o terraform.zip
unzip terraform.zip
sudo mv terraform /usr/local/bin/

# 설치 확인
terraform --version  # v1.14.0 이상
```

#### 3.3.5 kubectl

```bash
# macOS
brew install kubectl

# Linux
curl -LO https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl
chmod +x kubectl
sudo mv kubectl /usr/local/bin/

# 설치 확인
kubectl version --client
```

#### 3.3.6 Helm & Kustomize (GitOps 배포용)

```bash
# Helm
brew install helm  # macOS
# 또는 Linux: curl https://get.helm.sh/helm-v3.12.0-linux-amd64.tar.gz | tar -xz; sudo mv linux-amd64/helm /usr/local/bin/

# Kustomize
brew install kustomize  # macOS
# 또는 Linux: curl -L https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize/v5.8.0/kustomize_v5.8.0_linux_amd64.tar.gz | tar -xz; sudo mv kustomize /usr/local/bin/

# 확인
helm version
kustomize version
```

**모든 도구 한번에 확인:**
```bash
aws --version && kubectl version --client && terraform --version && helm version && kustomize version
```

---

## 4. Terraform 기반 EKS Cluster 구축

### 4.1 환경 선택 및 변수 설정

#### 4.1.1 환경 디렉토리 구조

```
terraform/
├── envs/
│   ├── dev/          ← 개발 환경
│   │   ├── terraform.tfvars    (환경별 변수)
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── backend.tf
│   ├── stg/          ← 스테이징 환경
│   └── prd/          ← 프로덕션 환경
└── modules/
    └── aws/          (공통 모듈)
```

#### 4.1.2 terraform.tfvars 설정

배포할 환경의 `terraform.tfvars`를 수정합니다:

**dev 환경 예제** (`terraform/envs/dev/terraform.tfvars`):

```hcl
# 기본 정보
name    = "eks-dev"
region  = "ap-northeast-2"

# 클러스터 설정
vpc_cidr                    = "10.0.0.0/16"
endpoint_public_access      = true              # dev: public 접근 허용
endpoint_public_access_cidrs = ["0.0.0.0/0"]    # dev: 제한 없음 (테스트용)

# 노드 그룹 설정 (관리형 노드, 항상 1개 유지)
node_group_instance_types = ["t3.medium"]
node_group_min_size       = 1
node_group_max_size       = 3
node_group_desired_size   = 2

# 노드 스케일링 선택
use_karpenter = true    # true: Karpenter, false: Cluster Autoscaler

# bastion ssh key
key_name = aws_key

```

**prd 환경 예제** (`terraform/envs/prd/terraform.tfvars`):

```hcl
# 기본 정보
name    = "eks-prd"
region  = "ap-northeast-2"

# 클러스터 설정
vpc_cidr                    = "10.0.0.0/16"
endpoint_public_access      = false             # prd: private 접근만

# 노드 그룹 설정
node_group_instance_types = ["m5.xlarge"]
node_group_min_size       = 2
node_group_max_size       = 10
node_group_desired_size   = 3

# 노드 스케일링
use_karpenter = true
```

### 4.2 Backend 상태 관리

Terraform 상태는 로컬 파일 또는 S3에 저장할 수 있습니다.
기존 Backend 구성을 변경할 때는 다음 명령어 중 하나를 사용합니다.

- `terraform init -migrate-state`: 기존 상태 파일을 새로운 backend로 안전하게 이전합니다. 데이터 손실을 방지합니다.
- `terraform init -reconfigure`: Backend를 재구성하지만, 기존 상태를 이전하지 않습니다. 새로운 backend에서 시작할 때 사용합니다.

#### 4.2.1 Local Backend (개인 개발용)

**`terraform/envs/dev/backend.tf`:**

```hcl
terraform {
  backend "local" {
    path = "terraform.tfstate"
  }
}
```

#### 4.2.2 S3 Backend (팀 협업용) - 권장

**사전 준비:**

```bash
# 1. S3 Bucket 생성
aws s3api create-bucket \
  --bucket eks-terraform-state-$(date +%Y%m%d) \
  --region ap-northeast-2 \
  --create-bucket-configuration LocationConstraint=ap-northeast-2

# 2. 버전 관리 활성화
BUCKET_NAME="eks-terraform-state-20260101"
aws s3api put-bucket-versioning \
  --bucket $BUCKET_NAME \
  --versioning-configuration Status=Enabled

# 3. DynamoDB Lock Table 생성
aws dynamodb create-table \
  --table-name terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-northeast-2
```

**`terraform/envs/dev/backend.tf`:**

```hcl
terraform {
  backend "s3" {
    bucket         = "eks-terraform-state-20260101"
    key            = "dev/terraform.tfstate"
    region         = "ap-northeast-2"
    dynamodb_table = "terraform-locks"
  }
}
```

**백업 검증:**
```bash
aws s3 ls s3://eks-terraform-state-20260101/
aws dynamodb describe-table --table-name terraform-locks
```

### 4.3 CloudWatch 로그 그룹

기존의 로그 그룹이 있으면 반드시 제거한 후 클러스터를 구축하세요. EKS 클러스터 생성 시 `/aws/eks/{cluster-name}/cluster` 형식의 로그 그룹을 자동으로 생성하므로, 동일한 이름의 로그 그룹이 미리 존재하면 배포에 실패할 수 있습니다.

```bash
# 로그 그룹 확인
export CLUSTER_NAME=eks-dev
aws logs describe-log-groups --log-group-name-prefix "/aws/eks/${CLUSTER_NAME}/cluster"

# 기존 로그 그룹 삭제 (필요시)
aws logs delete-log-group --log-group-name "/aws/eks/${CLUSTER_NAME}/cluster"
```

### 4.4 EKS 클러스터 배포

#### 4.4.1 Terraform 초기화 및 계획

```bash
cd terraform/envs/dev

# 1. Backend 초기화
terraform init

# 2. 변수 검증
terraform validate

# 3. 배포 계획 확인
terraform plan -out=tfplan
```

#### 4.4.2 클러스터 배포

```bash
# 배포 실행
terraform apply tfplan

# 소요 시간: 약 15~20분
aws eks describe-cluster --name eks-dev --query 'cluster.status'
```

#### 4.4.3 배포 확인

```bash
# kubeconfig 업데이트
aws eks update-kubeconfig --name eks-dev --region ap-northeast-2

# 클러스터 정보 확인
kubectl cluster-info
kubectl get nodes
```

### 4.5 Terraform Output 확인

**중요**: 다음 값들을 저장해두세요. GitOps 배포 시 필요합니다.

```bash
# 모든 Output 조회
terraform output

# 개별 Output 조회
terraform output eks_cluster_name
terraform output alb_controller_irsa_arn
terraform output karpenter_queue_name
terraform output vpc_id
```

**저장된 Output 예제:**

```bash
# 파일로 저장
terraform output -json > /tmp/eks-outputs.json

# 또는 텍스트로
cat << EOF > /tmp/eks-info.txt
Cluster Name: $(terraform output -raw eks_cluster_name)
ALB IRSA ARN: $(terraform output -raw alb_controller_irsa_arn)
Karpenter Queue Name: $(terraform output -raw karpenter_queue_name)
VPC ID: $(terraform output -raw vpc_id)
EOF
```

#### 4.5.1 Terraform Output → GitOps 매핑

**필수 매핑 정보:**

| Terraform Output              | GitOps 컴포넌트    | 설정 파일 위치                                              | 변수 이름                                               |
| ----------------------------- | ------------------ | ----------------------------------------------------------- | ------------------------------------------------------- |
| `alb_controller_irsa_arn`     | ALB Controller     | `gitops/alb/kustomize/overlays/dev/helm/values.yaml`        | `serviceAccount.annotations.eks.amazonaws.com/role-arn` |
| `eks_cluster_name`            | ALB, Karpenter     | `gitops/*/kustomize/overlays/dev/helm/values.yaml`          | `clusterName`, `settings.clusterName`                   |
| `cluster_autoscaler_irsa_arn` | Cluster AutoScaler | `gitops/autoscaler/kustomize/overlays/dev/helm/values.yaml` | `serviceAccount.annotations.eks.amazonaws.com/role-arn` |
| `karpenter_queue_name`        | Karpenter          | `gitops/karpenter/kustomize/overlays/dev/helm/values.yaml`  | `settings.interruptionQueue`                            |
| `vpc_id`                      | ALB Controller     | `gitops/alb/kustomize/overlays/dev/helm/values.yaml`        | `vpcId`                                                 |

**Terraform Output 확인:**
```bash
# 현재 디렉토리에서 실행 (terraform/envs/dev)
terraform output -json > /tmp/eks-outputs.json

# 개별 값 확인
echo "Cluster Name: $(terraform output -raw eks_cluster_name)"
echo "ALB IRSA ARN: $(terraform output -raw alb_controller_irsa_arn)"
echo "Karpenter IRSA ARN: $(terraform output -raw karpenter_irsa_arn)"
echo "VPC ID: $(terraform output -raw vpc_id)"
```

#### 4.5.2 EKS Cluster ControlPlane로그
control plane에 대한 로그는 CloudWatch Logs에서 확인할 수 있습니다. EKS 클러스터의 control plane 로그는 `/aws/eks/${cluster-name}/cluster` 로그 그룹에 저장되며, API 서버, 스케줄러, 컨트롤러 매니저 등의 로그를 포함합니다. 로그 보존 기간은 기본적으로 30일로 설정됩니다.

CloudWatch 콘솔에서 로그를 확인하려면:
1. AWS Management Console > CloudWatch > 로그 그룹으로 이동
2. `/aws/eks/${cluster-name}/cluster` 로그 그룹 선택
3. 로그 스트림에서 각 컴포넌트의 로그 확인

---

## 5. GitOps 기반 인프라 컴포넌트 배포

GitOps는 인프라와 애플리케이션 배포를 코드 기반으로 자동화하여 버전 관리, 재현성, 안정성을 높이는 방법론입니다. Terraform으로 EKS 클러스터 인프라를 구축한 후, Kustomize를 활용한 GitOps 방식을 통해 Karpenter NodePool, Cluster Autoscaler, Bottlerocket Update Operator 등의 운영에 필요한 인프라 자원 관리 컴포넌트를 추가합니다.

### 5.1 사전 준비

#### 5.1.1 도구 확인

GitOps 배포를 위해 필요한 도구들이 설치되어 있는지 확인합니다.

```bash
helm version
kustomize version
kubectl version --client
```

#### 5.1.2 Prometheus CRD 설치

```bash
# Prometheus CRD 설치 (ServiceMonitor 배포를 위해 필요)
export PROMETHEUS_VERSION=72.6.4
export PROMETHEUS_BASE_URL=https://raw.githubusercontent.com/prometheus-community/helm-charts/refs/tags/kube-prometheus-stack-${PROMETHEUS_VERSION}

kubectl apply --server-side=true -f ${PROMETHEUS_BASE_URL}/charts/kube-prometheus-stack/charts/crds/crds/crd-servicemonitors.yaml
kubectl apply --server-side=true -f ${PROMETHEUS_BASE_URL}/charts/kube-prometheus-stack/charts/crds/crds/crd-prometheuses.yaml

# 설치 확인
kubectl get crd | grep "servicemonitors\|prometheuses"
```

### 5.2 배포 개요

#### 5.2.1 의존성 및 배포 순서

```
Step 1:  StorageClass (필수)
   ↓
Step 2: cert-manager (필수)
   ↓
Step 3: 노드 스케일링 선택 (필수)
   ├─ Karpenter (권장)
   └─ Cluster Autoscaler
   ↓
Step 4: 부가 컴포넌트 
   ├─ AWS Load Balancer Controller (선택)
   └─ Bottlerocket Update Operator (선택)
```

#### 5.2.2 공통 배포 패턴 이해

모든 GitOps 인프라 컴포넌트는 Kustomize 기반 오버레이 구조를 통해 환경별(dev/stg/prd)로 일관된 배포 패턴을 제공합니다. 각 컴포넌트는 기본 설정(base)을 공유하면서도 Makefile 명령어를 통해 환경별 차별화된 설정을 적용할 수 있으며, `DEPLOY_ENV` 환경 변수로 배포 대상 환경을 지정합니다. 현재 GitOps 저장소에는 dev 환경만 완전히 구성되어 있으며, stg와 prd 환경은 dev를 기반으로 복사하여 각 환경의 요구사항에 맞게 커스터마이징해야 합니다.

**Makefile 기반 배포:**
```bash
# 공통 환경 변수
export DEPLOY_ENV=dev  # dev, stg, prd

# 공통 명령어 패턴
make pull        # Helm Chart 다운로드 (해당하는 경우)
make preview     # 배포될 매니페스트 미리보기
make apply       # 배포 실행
make delete      # 배포 삭제
```

**네임스페이스별 배포 위치:**
- cert-manager: `security` 네임스페이스
- ALB Controller: `kube-system` 네임스페이스  
- Karpenter: `kube-system` 네임스페이스
- Cluster Autoscaler: `kube-system` 네임스페이스
- Bottlerocket: `kube-system` 네임스페이스
- StorageClass: 네임스페이스 없음 (클러스터 리소스)

### 5.2.3 배포 설정

각 모듈의 배포 설정은 환경별 오버레이의 `helm/values.yaml`에서 관리하며, 추가로 필요한 값은 기본값을 참조하여 오버라이드합니다.

**설정 파일 위치:**
- 기본값(참조): `gitops/{모듈명}/kustomize/base/helm/{chart_name}/values.yaml`
- 환경별 오버라이드: `gitops/{모듈명}/kustomize/overlays/{환경}/helm/values.yaml`

**주요 설정 항목:**
- **리소스 제한**: CPU/메모리 요청 및 제한
- **노드 셀렉터**: 시스템 노드 배치 (`node-role.kubernetes.io/system: "true"`)
- **톨러레이션**: 시스템 컴포넌트용 톨러레이션 설정
- **서비스 어카운트**: IRSA 역할 바인딩
- **환경별 변수**: dev/stg/prd 환경별 차별화된 설정

#### 5.2.4 System Node 레이블 필수 요구사항

모든 GitOps 시스템 컴포넌트는 `node-role.kubernetes.io/system: "true"` 레이블이 설정된 전용 시스템 노드에만 배포됩니다.

- EKS Terraform 모듈의 `system_node_group`에 자동 설정 (`terraform/modules/aws/eks/v1/main.tf#L94-L96`)
- 모든 GitOps 모듈의 `nodeSelector`에 적용
- 레이블 누락 시 모든 시스템 Pod가 스케줄링 실패 (`Pending` 상태)

```bash
# 레이블 확인
kubectl get nodes -l node-role.kubernetes.io/system=true
```

#### 5.2.5 CRD 배포 주의사항

일부 Helm Chart는 CRD와 리소스를 함께 배포합니다. 이때 API 서버가 CRD를 아직 인식하지 못해 리소스 생성이 실패할 수 있으므로, CRD가 생성된 것을 확인한 뒤 `make apply`를 한 번 더 실행(재배포)하세요. 또한 운영 안정성을 위해 추후에는 CRD를 별도 단계로 분리 배포하도록 구성하는 것을 권장합니다.


### 5.3 StorageClass

#### 5.3.1 개요

EBS CSI 드라이버를 통한 동적 영구 볼륨 프로비저닝을 위한 StorageClass를 설정합니다.

- **주요 기능**: EBS 기반 PVC 동적 프로비저닝
- **볼륨 타입**: gp3 (기본)
- **네임스페이스**: 클러스터 레벨 리소스 (네임스페이스 없음)

#### 5.3.2 StorageClass 매니페스트

 StorageClass 매니페스트는 `gitops/storagclass/storageclass.yaml`에서 확인할 수 있습니다.

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  fsType: ext4
  encrypted: "true"
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
reclaimPolicy: Delete
```

#### 5.3.3 배포 실행

기존 StorageClass의 default 설정을 변경하고 새로운 gp3 StorageClass를 배포합니다.

```bash
# 1. 기존 gp2 StorageClass에서 default 설정 제거
kubectl patch storageclass gp2 -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"false"}}}'

# 2. gp3 StorageClass 배포
cd gitops/storagclass

# 매니페스트 미리보기
make preview

# 배포
make apply
```

#### 5.3.4 배포 확인

```bash
# StorageClass 및 EBS CSI Driver 확인
kubectl get storageclass
kubectl get pods -n kube-system | grep ebs-csi
```

### 5.4 cert-manager

#### 5.4.1 개요

cert-manager는 Kubernetes 클러스터 내에서 TLS 인증서를 자동으로 관리하는 컨트롤러입니다.

- **주요 기능**: Let's Encrypt, 자체 서명, 외부 CA 인증서 자동 발급 및 갱신
- **의존성**: 다른 모든 컴포넌트의 기반이 되는 필수 컴포넌트
- **네임스페이스**: `security`

#### 5.4.2 배포 준비

**디렉토리 이동:**
```bash
cd gitops/cert-manager
```

**Helm Chart Pull:**
```bash
make pull
```

#### 5.4.3 배포 설정

기본 설정으로 배포 가능하며, 필요시 `kustomize/base/helm/values.yaml`에서 설정을 수정할 수 있습니다.

#### 5.4.4 배포 실행

```bash
# 배포
make apply

# 또는 환경 지정
make apply DEPLOY_ENV=dev
```

#### 5.4.5 배포 확인

```bash
# Pod 상태 확인
kubectl get pods -n security

# Webhook 및 CRD 확인
kubectl get validatingwebhookconfigurations | grep cert-manager
kubectl get crd | grep cert-manager
```

#### 5.4.6 기능 테스트

```bash
# 테스트용 Issuer 생성
kubectl apply -f - << EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned-issuer
spec:
  selfSigned: {}
EOF

# ClusterIssuer 확인
kubectl get clusterissuer
```

### 5.5 AWS Load Balancer Controller

#### 5.5.1 개요

AWS Load Balancer Controller는 Kubernetes Ingress를 AWS Application Load Balancer(ALB)로 자동 생성하는 컨트롤러입니다.

- **주요 기능**: Kubernetes Ingress → AWS ALB/NLB 자동 생성 및 관리
- **의존성**: cert-manager (TLS 인증서 관리용)
- **네임스페이스**: `kube-system`

#### 5.5.2 사전 요구사항

**Terraform Output 필요 값:**
- `alb_controller_irsa_arn`: ALB Controller Service Account IAM Role
- `eks_cluster_name`: EKS 클러스터 이름
- `vpc_id`: VPC ID

#### 5.5.3 배포 설정

**`gitops/alb/kustomize/overlays/dev/helm/values.yaml`**

```yaml
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789:role/eks-dev-alb-controller-xxxx  # terraform output 값

clusterName: eks-dev  # terraform output 값

vpcId: vpc-0xxxxx  # terraform output 값

region: ap-northeast-2

# ALB Controller 설정
replicaCount: 2

# 리소스 제한
resources:
  limits:
    cpu: 200m
    memory: 500Mi
  requests:
    cpu: 100m
    memory: 200Mi

# 로그 레벨
logLevel: info
```

#### 5.5.4 배포 실행

```bash
cd gitops/alb

# Helm Chart Pull
make pull

# 배포 미리보기
make preview DEPLOY_ENV=dev

# 배포 실행
make apply DEPLOY_ENV=dev
```

#### 5.5.5 배포 확인

```bash
# Pod 및 IngressClass 확인
kubectl get pods -n kube-system | grep aws-load-balancer-controller
kubectl get ingressclass

# 로그 확인
kubectl logs -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller -f

# IAM 권한 확인
kubectl describe sa aws-load-balancer-controller -n kube-system | grep role-arn
```

### 5.6 노드 스케일링

#### 5.6.1 Karpenter vs Cluster Autoscaler 선택 가이드

| 구분              | Karpenter           | Cluster Autoscaler     |
| ----------------- | ------------------- | ---------------------- |
| **응답 속도**     | 매우 빠름 (10-30초) | 느림 (2-5분)           |
| **인스턴스 선택** | 최적화된 자동 선택  | ASG 기반 고정 인스턴스 |
| **비용 최적화**   | 높음 (Spot 활용)    | 중간                   |
| **설정 복잡도**   | 중간                | 낮음                   |
| **안정성**        | 높음                | 매우 높음              |
| **다중 AZ 지원**  | 자동                | ASG 설정 필요          |
| **권장 환경**     | 모든 환경           | 보수적 운영 환경       |

**권장사항:** 빠른 스케일링과 비용 효율성을 고려할 때 대부분의 경우 **Karpenter** 사용을 권장합니다. 다만, 기존 Auto Scaling Group 기반의 안정적인 운영을 선호하는 환경에서는 Cluster Autoscaler를 선택할 수 있습니다.

#### 5.6.2 Karpenter 배포 (권장)

##### 5.6.2.1 개요

Karpenter는 AWS EKS를 위한 오픈소스 노드 프로비저닝 프로젝트로, 애플리케이션 로드에 따라 적절한 컴퓨팅 리소스를 빠르게 시작하고 종료합니다.

- **주요 기능**: 동적 노드 스케일링, 인스턴스 타입 최적화, Spot 인스턴스 활용
- **네임스페이스**: `kube-system`

##### 5.6.2.2 사전 요구사항

**Terraform Output 필요 값:**
- `eks_cluster_name`: EKS 클러스터 이름
- `karpenter_queue_name`: Karpenter Queue 이름 (SQS)

##### 5.6.2.3 배포 준비

```bash
cd gitops/karpenter

# Helm Chart Pull (ECR 인증 포함)
make pull
```

##### 5.6.2.4 배포 설정

**1. values.yaml 설정**

**`gitops/karpenter/kustomize/overlays/dev/helm/values.yaml`**

```yaml
settings:
  clusterName: eks-dev  # terraform output 값
  interruptionQueue: Karpenter-eks-dev  # terraform output 값

# 컨트롤러를 관리형 노드에서만 실행
nodeSelector:
  karpenter.sh/controller: 'true'

# DNS 정책 설정
dnsPolicy: Default

# Webhook 비활성화 (단순화)
webhook:
  enabled: false
```

**2. EC2NodeClass 설정**

**`gitops/karpenter/kustomize/overlays/dev/resources/karpenter-node/ec2class.yaml`**

EC2NodeClass의 `role`과 모든 `karpenter.sh/discovery` 태그 값은 반드시 Terraform output의 `eks_cluster_name`과 일치해야 합니다. 
이는 Karpenter가 올바른 서브넷과 보안 그룹을 찾고, 적절한 IAM 역할을 사용하기 위해 필수적입니다.

```yaml
apiVersion: karpenter.k8s.aws/v1
kind: EC2NodeClass
metadata:
  name: eks-dev-nodeclass
spec:
  amiSelectorTerms:
    - alias: bottlerocket@latest
  role: eks-dev
  subnetSelectorTerms:
    - tags:
        karpenter.sh/discovery: eks-dev
  securityGroupSelectorTerms:
    - tags:
        karpenter.sh/discovery: eks-dev
  tags:
    karpenter.sh/discovery: eks-dev
  
  # 블록 디바이스 매핑
  blockDeviceMappings:
    - deviceName: /dev/xvdb
      ebs:
        volumeSize: 100Gi
        volumeType: gp3
        encrypted: true
        deleteOnTermination: true
```

**3. NodePool 설정**

**`gitops/karpenter/kustomize/overlays/dev/resources/karpenter-node/nodepool.yaml`**

- 기본 NodePool 구조

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: eks-dev-nodepool
spec:
  # 노드 템플릿
  template:
    metadata:
      labels:
        environment: dev
        team: platform
        provisioner: karpenter
    spec:
      # EC2NodeClass 참조
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: eks-dev-nodeclass
```

- 인스턴스 요구사항 설정

```yaml
      # 인스턴스 요구사항
      requirements:
        # 아키텍처
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64"]
        
        # 인스턴스 카테고리 (dev 환경: 비용 효율적)
        - key: "karpenter.k8s.aws/instance-category"
          operator: In
          values: ["t", "m", "c"]
        
        # 인스턴스 크기
        - key: "karpenter.k8s.aws/instance-size"
          operator: In
          values: ["medium", "large", "xlarge"]
        
        # 가용성 영역
        - key: "karpenter.sh/capacity-type"
          operator: In
          values: ["spot", "on-demand"]
```

- 리소스 제한 설정
```yaml
  # 리소스 제한
  limits:
    cpu: "1000"
    memory: "1000Gi"
```

여기서 설정한 값은 Karpenter가 생성할 수 있는 모든 노드의 총합입니다. 즉, CPU 1000코어와 메모리 1000Gi를 넘지 않는 범위에서 여러 노드가 동적으로 생성됩니다. 예를 들어 16코어 노드 62개 또는 32코어 노드 31개까지 생성 가능하며, 실제 워크로드 요구사항에 따라 자동으로 적절한 크기의 노드들이 조합되어 배치됩니다.

- Disruption 정책 설정
```yaml
disruption:                                # 노드 삭제(disruption) 및 통합(consolidation) 동작을 제어하는 정책
  consolidationPolicy: WhenEmptyOrUnderutilized  # 노드가 비어있거나(Empty) 자원이 낮게 사용 중일 때만 통합 대상
  consolidateAfter: 30s                    # 해당 상태가 연속으로 30초 이상 유지돼야 통합 후보로 인정
  budgets:                                 # 노드 삭제를 허용하는 시간과 수량을 제한하는 budget 설정
  - nodes: "1"                             # budget이 활성화된 시간 전체 동안 최대 1개 노드만 중단 허용
    schedule: "*/5 * * * *"                # 5분마다 노드 삭제를 허용하는 시간 창(window)을 시작
    duration: 1m                           # window가 열린 후 1분 동안만 중단 허용(그 외 시간에는 중단 불가)
```

노드가 consolidation 조건(Empty 또는 Underutilized)을 연속으로 30초 이상 만족해야 후보가 됩니다. 이 중에 5분마다 window가 열린 후 1분 동안만 삭제가 허용됩니다. inflate.yaml과 같은 CPU 1개를 점유하는 Pod가 각 노드에 1개씩 배치되는 경우 flapping이 발생할 수 있어 주의가 필요합니다.


**4. Buffer Node 설정**

**`gitops/karpenter/kustomize/overlays/dev/resources/buffer-node/deployment.yaml`**

Buffer Node는 클러스터에 여유 노드를 미리 확보하여 워크로드의 빠른 스케일 아웃을 지원하는 역할을 합니다. Dev 오버레이의 `buffer-node/deployment.yaml`은 더미 Pod를 배포하여 노드가 Empty 또는 Underutilized 상태로 판단되어 consolidation에 의해 삭제되는 것을 방지합니다.

- 낮은 우선순위(PriorityClass: -10)로 설정하여 실제 워크로드에 의해 선점 가능
- Karpenter 사용 시 `karpenter.sh/do-not-disrupt: "true"`로 의도치 않은 삭제 방지
- replicas 수로 유지할 여유 노드 수 조절
- Pod Anti-Affinity로 노드 분산 유지
- Buffer Pod는 자동으로 생성되지 않으며, 사용자가 직접 배포합니다.
 
Buffer Node는 autoscaler 또는 karpenter의 base resources에 포함되어 있으므로, 배포 시 함께 적용됩니다.
필요에 따라 requests의 cpu와 memory, replicas를 조정하여 노드가 Underutilized로 판단되지 않도록 구성해야 합니다.


##### 5.6.2.5 배포 실행

```bash
# 배포 미리보기
make preview DEPLOY_ENV=dev

# 배포 실행
make apply DEPLOY_ENV=dev
```

##### 5.6.2.6 배포 확인

```bash
# Pod, NodePool, EC2NodeClass 확인
kubectl get pods -n kube-system | grep karpenter
kubectl get nodepool
kubectl get ec2nodeclass

# 로그 확인
kubectl logs -n kube-system -l app.kubernetes.io/name=karpenter -f

# 리소스 상태 확인
kubectl describe nodepool eks-dev-nodepool
kubectl describe ec2nodeclass eks-dev-nodeclass
```

##### 5.6.2.7 노드 스케일링 테스트

**Karpenter의 동적 스케일링 기능을 검증하기 위한 테스트입니다.**

**1. 기존 Inflate Pod 확인**

```bash
# 기존 inflate deployment 확인 (이미 배포되어 있어야 함)
kubectl get deployment inflate -n kube-system

# 현재 replicas 수 확인
kubectl get deployment inflate -n kube-system -o jsonpath='{.spec.replicas}'
```

**2. 스케일 업 테스트**

```bash
kubectl -n kube-system scale deploy inflate --replicas=5

kubectl get nodes -L karpenter.sh/registered
kubectl logs -f -n kube-system -l app.kubernetes.io/name=karpenter -c controller
```

**3. 스케일 다운 테스트**

```bash
kubectl -n kube-system scale deploy inflate --replicas=1

# 노드 상태 확인 (통합/삭제 대기)
watch kubectl get nodes
```

##### 5.6.2.8 Karpenter 노드 SSM 접속

```bash
aws ssm start-session --target $KARPENTER_INSTANCE_ID

# CPU 코어 수 확인
cat /proc/cpuinfo | grep processor | wc -l

# 메모리 정보 확인
cat /proc/meminfo

# 디스크 사용량 확인
df -h

# 현재 실행 중인 Pod 확인 (kubelet 관점)
crictl ps

# 시스템 리소스 사용률 확인
top -n 1

# 네트워크 인터페이스 확인
ip addr show

# 노드 메타데이터 확인
curl -s http://169.254.169.254/latest/meta-data/instance-type
curl -s http://169.254.169.254/latest/meta-data/placement/availability-zone
```


#### 5.6.3 Cluster Autoscaler 배포 (대안)

##### 5.6.3.1 개요

Cluster Autoscaler는 Pod가 스케줄링될 수 없을 때 노드 그룹을 자동으로 확장하고, 노드가 비어 있을 때 축소하는 컴포넌트입니다.

- **주요 기능**: ASG 기반 노드 스케일링
- **네임스페이스**: `kube-system`
- **사용 조건**: `terraform.tfvars`에서 `use_karpenter = false` 설정

##### 5.6.3.2 사전 요구사항

**Terraform Output 필요 값:**
- `eks_cluster_name`: EKS 클러스터 이름
- `cluster_autoscaler_irsa_arn`: AutoScaler Service Account IAM Role

##### 5.6.3.3 배포 설정
**`gitops/autoscaler/kustomize/overlays/dev/helm/values.yaml`:**

```yaml
# Cluster Autoscaler 설정
cloudProvider: aws
awsRegion: ap-northeast-2  # 서울 리전 (필요시 변경)

# AWS IAM Role (IRSA)
rbac:
  create: true
  serviceAccount:
    create: true
    name: cluster-autoscaler
    annotations:
      eks.amazonaws.com/role-arn: "arn:aws:iam::020211325831:role/eks-stg-cluster-autoscaler-2025122802491282630000000e" # terraform output

# ASG 자동 발견
autoDiscovery:
  clusterName: eks-dev # terraform output
  enabled: true
  tags:
    - k8s.io/cluster-autoscaler/enabled
    - k8s.io/cluster-autoscaler/{{ .Values.autoDiscovery.clusterName }}
```

##### 5.6.3.4 배포 실행

```bash
cd gitops/autoscaler

# Helm Chart Pull
make pull

# 배포
make apply DEPLOY_ENV=dev

# 배포 확인
kubectl get pods -n kube-system | grep cluster-autoscaler
```

### 5.7 Bottlerocket Update Operator(선택)

#### 5.7.1 개요

Bottlerocket Update Operator는 Bottlerocket OS를 실행하는 노드의 자동 업데이트를 관리합니다.

- **주요 기능**: Bottlerocket OS 자동 업데이트 및 재부팅 관리
- **사용 조건**: Bottlerocket AMI를 사용하는 경우에만 필요
- **네임스페이스**: `kube-system`


#### 5.7.2 배포 설정
**`gitops/bottlerocket-update/kustomize/base/helm/values.yaml`:**

```yaml
# 업데이트 체크 주기 (매주 월,수 18:00)
scheduler_cron_expression: "0 0 18 * * Mon,Wed *"

# 업데이트 완료 후 로드밸런서에서 제외되는 대기 시간 (초)
exclude_from_lb_wait_time_in_sec: "180"

# 동시 업데이트 최대 노드 수
max_concurrent_updates: "1"

# Prometheus ServiceMonitor 활성화
prometheus:
  controller:
    serviceMonitor:
      enabled: true
```

**주요 설정 항목**   
- `scheduler_cron_expression`: 업데이트 체크 주기 (Cron 형식)
- `max_concurrent_updates`: 동시 업데이트 가능한 최대 노드 수
- `exclude_from_lb_wait_time_in_sec`: 업데이트 완료 후 로드밸런서 제외 대기 시간

**Agent 배치 설정**   
모든 Bottlerocket 노드에 자동 OS 업데이트를 적용하면 노드 재부팅으로 인해 실행 중인 Pod가 종료되고, 동시 다발적인 업데이트 시 서비스 가용성이 저하되거나 Statefull Workload의 데이터 손실이 발생할 수 있습니다. 따라서 업데이트 대상 노드를 선택적으로 제어할 수 있도록 구성되어 있습니다.

`gitops/botterocket-update/kustomize/base/kustomization.yaml`에서 DaemonSet `brupop-agent`에 패치를 적용하여 `node-role.bottlerocket-update: "true"` 레이블이 있는 노드에만 Agent를 배포합니다. 따라서 운영 환경에서는 별도의 업데이트 전용 노드 그룹을 구성하고 해당 레이블을 부여하여 안전하게 OS 업데이트를 수행할 것을 권장합니다.


#### 5.7.3 배포 준비

```bash
cd gitops/bottlerocket-update

# Helm Chart Pull
make pull
```

#### 5.7.4 배포 실행

```bash
# 배포
make apply DEPLOY_ENV=dev
```

#### 5.7.5 배포 확인

```bash
# Pod 상태 확인
kubectl get pods -n kube-system

# CRD 확인
kubectl get crd | grep bottlerocket

# Update 정책 확인
kubectl get updatepolicy -A

# 로그 확인
kubectl logs -n kube-system -l  brupop.bottlerocket.aws/component: apiserver
kubectl logs -n kube-system -l  brupop.bottlerocket.aws/component: brupop-controller
```

---

## 6. 클러스터 운영 및 관리

### 6.1 Bastion 접속

#### 6.1.1 SSM 세션 (권장, 보안)

```bash
# 1. Bastion Instance ID 확인
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*bastion*" \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

# 2. 세션 시작
aws ssm start-session --target $INSTANCE_ID

# 3. 내부에서
ubuntu@bastion:~$ aws eks update-kubeconfig --name eks-dev --region ap-northeast-2
ubuntu@bastion:~$ kubectl get nodes
```

#### 6.1.2 SSH 접근 (Bastion이 public subnet에 있을 경우)

```bash
# 1. Bastion EIP 확인
BASTION_IP=$(aws ec2 describe-addresses \
  --filters "Name=tag:Name,Values=*bastion*" \
  --query 'Addresses[0].PublicIp' \
  --output text)

# 2. SSH 접속
ssh -i ~/.ssh/aws-key ubuntu@$BASTION_IP

# 3. 내부에서
ubuntu@bastion:~$ kubectl get nodes
```

### 6.2 EKS 클러스터 접속

kubeconfig를 구성하고 클러스터 정보를 조회:
```bash
aws eks update-kubeconfig --name eks-dev --region ap-northeast-2
kubectl cluster-info
```

### 6.3 EKS 클러스터 엔드포인트 설정

Public Endpoint를 비활성화하여 보안을 강화해야 하는 경우는 Bastion VM에서만 클러스터에 접속하도록 구성합니다.

```bash
aws eks update-cluster-config \
  --name <CLUSTER_NAME> \
  --resources-vpc-config endpointPublicAccess=false,endpointPrivateAccess=true
```

Public Endpoint를 다시 활성화하는 경우 kubeconfig를 업데이트:
```bash
aws eks update-kubeconfig --name <CLUSTER_NAME> --region <REGION>
```

```bash
sudo apt update
sudo apt install -y curl unzip
```

Bastion에서 추가 도구(AWS CLI, kubectl, Helm, Kustomize)를 설치하려면 [3.3 필수 도구 설치](#33-필수-도구-설치) 섹션의 설치 명령을 참조하여 실행하세요.

kubeconfig를 구성하고 클러스터 정보를 조회:
```bash
aws eks update-kubeconfig --name eks-dev --region ap-northeast-2
kubectl cluster-info
```

---

## 7. 애플리케이션 배포 예제

### 7.1 Nginx 배포

#### 7.1.1 PersistentVolumeClaim 생성

StorageClass를 통해 EBS 볼륨을 자동으로 프로비저닝하는 PVC를 생성합니다.

```bash
kubectl apply -f - << EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-ebs-pvc
  namespace: default
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
  storageClassName: gp3
EOF
```

#### 7.1.2 Nginx Deployment with PVC

PVC를 연동하여 Nginx를 배포합니다. PVC는 Pod이 실제로 배포될 때 자동으로 생성되며, Pod이 실행되는 노드에 EBS 볼륨이 Attach됩니다.

**Deployment 생성**: volumeMounts와 volumes을 사용하여 PVC를 Deployment에 연동

```bash
kubectl apply -f - << EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:latest
        ports:
        - containerPort: 80
        volumeMounts:
          - name: ebs-storage
            mountPath: /usr/share/nginx/html
        resources:
          requests:
            cpu: "100m"
            memory: "128Mi"
          limits:
            cpu: "200m"
            memory: "256Mi"
      volumes:
        - name: ebs-storage
          persistentVolumeClaim:
            claimName: my-ebs-pvc
EOF
```

**Service 생성**: LoadBalancer 타입 Service로 외부 접근 가능하도록 노출

```bash
kubectl apply -f - << EOF
apiVersion: v1
kind: Service
metadata:
  name: nginx
  annotations:
    service.beta.kubernetes.io/aws-load-balancer-scheme: internet-facing
    service.beta.kubernetes.io/aws-load-balancer-target-type: ip
spec:
  type: LoadBalancer
  loadBalancerClass: service.k8s.aws/nlb
  selector:
    app: nginx
  ports:
  - port: 80
    targetPort: 80
EOF
```

**배포 상태 확인**: PVC, Pod, PV, 마운트 정보를 확인하여 정상 배포 여부 검증

```bash
kubectl get pvc my-ebs-pvc              # PVC 상태 확인
kubectl get pods -l app=nginx           # Pod 상태 확인
kubectl get pv                          # PV 확인 (자동으로 생성됨)
kubectl describe pod -l app=nginx | grep -A 5 "Mounts:"  # 마운트 확인
```

**외부 접근 확인**: NLB를 통해 할당된 EXTERNAL-IP로 Nginx 접근 가능 (1-2분 소요)

```bash
kubectl get svc nginx
# EXTERNAL-IP 열의 주소로 접근 가능
```

⚠️ **주의사항:**
- PVC는 Pod이 배포되는 순간 자동으로 생성되고 AWS EBS 볼륨이 프로비저닝됩니다.
- EBS 볼륨은 Pod이 배포된 노드에만 Attach되므로, Pod이 다른 노드로 이동하면 재마운트됩니다.
- replicas > 1인 경우, ReadWriteOnce 액세스 모드로는 여러 노드에 동시 마운트가 불가능하므로 주의하세요.


### 7.2 ALB Ingress 설정

AWS Load Balancer Controller를 통해 Application Load Balancer(ALB)를 자동 생성하는 Ingress 리소스를 구성합니다.

##### 7.2.1 주요 설정 항목

- **`alb.ingress.kubernetes.io/scheme`**: ALB 배포 위치
  - `internet-facing`: 인터넷 공개 (공개 서브넷)
  - `internal`: VPC 내부용 (프라이빗 서브넷)

- **`alb.ingress.kubernetes.io/group.name`**: ALB 통합 관리
  - 동일 그룹명의 Ingress들을 하나의 ALB로 통합
  - 비용 절감 및 리소스 효율화 (예: `platform`, `api`)

- **`ingressClassName`**: Controller 지정
  - `alb`: AWS Load Balancer Controller 사용
  - 자동 ALB 생성 및 라우팅 규칙 설정

##### 7.2.2 Ingress 리소스 생성

```bash
kubectl apply -f - << EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: nginx-ingress
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/group.name: platform
spec:
  ingressClassName: alb
  rules:
  - host: app.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: nginx
            port:
              number: 80
EOF
```

##### 7.2.3 배포 확인 및 접근

```bash
kubectl get ingress nginx-ingress
kubectl describe ingress nginx-ingress

# ALB 주소 추출
ALB_ADDRESS=$(kubectl get ingress nginx-ingress -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "ALB Address: $ALB_ADDRESS"
```

##### 7.2.4 도메인 설정

```bash
# Route53 또는 /etc/hosts에서 DNS 설정
echo "$ALB_ADDRESS app.example.com" | sudo tee -a /etc/hosts

# 접근 테스트
curl -H "Host: app.example.com" http://$ALB_ADDRESS
```

---

## 8. 클러스터 삭제

### 8.1 애플리케이션 삭제

```bash
kubectl delete ingress --all
kubectl delete svc --all
kubectl delete sts --all
kubectl delete deployment --all

# PVC 및 PV 확인 후 삭제
kubectl get pvc -A
kubectl get pv
kubectl delete pvc --all -A
kubectl delete pv --all
```

### 8.2 GitOps 인프라 컴포넌트 삭제

```bash
cd gitops/bottlerocket && make delete DEPLOY_ENV=dev
cd gitops/alb && make delete DEPLOY_ENV=dev
cd gitops/cert-manager && make delete DEPLOY_ENV=dev
cd gitops/karpenter && make delete DEPLOY_ENV=dev
```

주의 사항으로는 Karpenter는 삭제는 먼저 NodePool 삭제한 후에 진행합니다.

```bash
# karpenter.sh/do-not-disrupt annotation 제거
kubectl get pods -A -o json | jq -r '.items[] | select(.metadata.annotations["karpenter.sh/do-not-disrupt"]=="true" and .spec.nodeName!=null) | "\(.metadata.namespace) \(.metadata.name) \(.spec.nodeName)"'
kubectl annotate pod <pod-name> -n <namespace> karpenter.sh/do-not-disrupt-

# 특정 NodePool 삭제
kubectl get get nodepool
kubectl delete nodeclaim -l karpenter.sh/nodepool=<nodepool-name>
kubectl delete nodepool <nodepool-name>
kubectl delete node -l karpenter.sh/nodepool=<nodepool-name>
```

### 8.3 Terraform EKS Cluster 삭제

``` bash
cd terraform/envs/dev && terraform destroy
```

### 8.4 S3, DynamoDB, 로그 삭제
``` bash
aws dynamodb delete-table --table-name terraform-locks
aws s3 rb s3://eks-terraform-state-20260101 --force

export name=eks-dev
aws logs delete-log-group --log-group-name "/aws/eks/${name}/cluster"
```

---

## 9. 트러블슈팅

### 9.1 연결 문제

```bash
# 1. kubeconfig 다시 생성
aws eks update-kubeconfig --name eks-dev --region ap-northeast-2

# 2. 권한 확인
aws sts get-caller-identity

# 3. 클러스터 접근 권한 확인
kubectl auth can-i create pods --as=$(aws sts get-caller-identity --query 'Arn' --output text)
```

### 9.2 노드 생성 문제

**Karpenter 확인:**
```bash
kubectl describe nodes
kubectl logs -n kube-system -l app.kubernetes.io/name=karpenter -f

# EC2 제한 확인
aws ec2 describe-instances --query 'Reservations[].Instances[].InstanceType' | sort | uniq -c
```

**Autoscaler 확인:**
```bash
kubectl logs -n kube-system -l app=cluster-autoscaler -f
```

### 9.3 Ingress 문제

```bash
# 1. ALB Controller 상태 확인
kubectl get pods -n kube-system | grep alb
kubectl logs -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller -f

# 2. IAM 권한 확인
kubectl describe sa aws-load-balancer-controller -n kube-system | grep role-arn

# 3. Ingress 상태 확인
kubectl describe ingress <name>
```

---

## 10. 참고자료

### 10.1 공식 문서

- [EKS 공식 문서](https://docs.aws.amazon.com/eks/)
- [Terraform AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [Karpenter 문서](https://karpenter.sh/)
- [Kubernetes 공식 문서](https://kubernetes.io/docs/)

### 10.2 자주 묻는 질문

**Q: 기존 클러스터를 Terraform으로 관리할 수 있나요?**
A: 네. `terraform import`를 사용하여 기존 리소스를 Terraform 상태에 추가할 수 있습니다.

**Q: 여러 AWS 계정 관리는?**
A: 각 환경 디렉토리마다 다른 AWS 프로필을 사용하세요.
```bash
export AWS_PROFILE=eks-prd
terraform apply
```

**Q: 테라폼 상태가 손상되었을 때는?**
A: S3 versioning으로 복구 가능합니다.

```bash
# 이전 state 버전 확인
aws s3api list-object-versions \
  --bucket eks-terraform-state-xxxx \
  --prefix path/to/terraform.tfstate

# 복구할 버전 다운로드
aws s3api get-object \
  --bucket eks-terraform-state-xxxx \
  --key path/to/terraform.tfstate \
  --version-id <VERSION_ID> \
  terraform.tfstate.recover

# 검증 후 state 복원
terraform state push terraform.tfstate.recover
```

### 10.3 성능 최적화

- **Karpenter 설정**: `consolidationPolicy: WhenUnderutilized`로 비용 절감
- **kubectl 성능**: kubelet CPU 및 메모리 모니터링
- **etcd 백업**: 정기적인 클러스터 백업 구성

### 10.4 보안 강화

- [ ] Public Endpoint 비활성화 (`endpoint_public_access = false`)
- [ ] Bastion을 통한 접근만 허용
- [ ] 정기적인 보안 업데이트 적용
- [ ] IAM 역할 최소 권한 원칙 적용
- [ ] 네트워크 정책(NetworkPolicy) 설정
- [ ] Pod Security Policy 또는 Pod Security Standards 적용

---

## 기여

버그 리포트 및 개선 제안은 GitHub Issues를 통해 제출해주세요.

---

**Last Updated**: 2026년 1월 1일
**Terraform Version**: 1.14.0+
**EKS Version**: 1.33+
