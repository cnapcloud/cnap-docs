---
title: "VPN 네트워크"
sidebar_position: 2
---

## 1. 개요

이 Terraform 구성은 Keycloak SAML 인증 기반의 AWS Client VPN과 Transit Gateway Hub-and-Spoke 아키텍처를 자동으로 배포합니다.

관련 소스 코드는 [GitHub Repository](https://github.com/cnapcloud/k8s.git)의 `vpn-tgw/` 디렉토리에서 확인할 수 있습니다.

### 1.1 배경

멀티 환경(DEV/STG/PRD 등)을 운영하는 조직에서는 각 환경을 VPC로 격리하여 보안과 독립성을 유지합니다. 하지만 원격 개발자나 운영자는 필요에 따라 여러 환경에 접근해야 하며, 환경마다 별도의 VPN을 구성하면 관리 복잡도가 증가합니다. 이 구성은 **단일 VPN Endpoint를 통해 중앙 Hub VPC에 연결하고, Transit Gateway를 통해 여러 격리된 VPC 환경에 선택적으로 접근**할 수 있는 Hub-and-Spoke 아키텍처를 제공합니다.

### 1.2 Terraform 구성

이 Terraform 모듈은 **VPN Client → VPN Hub VPC → Multiple VPCs** 구조를 범용적으로 구성할 수 있도록 설계되었습니다. 이 문서에서는 **여러 EKS 클러스터 환경(CICD/DEV/STG/PRD)을 통합 관리하는 시나리오**를 예시로 설명하지만, 실제로는 EKS 외에도 다양한 워크로드(RDS, EC2, Lambda 등)가 있는 멀티 VPC 환경에도 동일하게 적용할 수 있습니다. 원격 사용자는 Keycloak Single Sign-On(SSO)으로 인증하여 각 환경의 리소스에 안전하게 접근할 수 있습니다.

### 1.3 주요 특징

- **페더레이션 인증**: Keycloak SAML 2.0을 통한 중앙 집중식 사용자 인증 및 그룹 기반 접근 제어
- **Hub-and-Spoke 아키텍처**: VPN Hub VPC를 중앙 허브로 사용하고, Spoke VPC들은 서로 격리
- **자동화된 라우팅**: Transit Gateway 전파와 VPC Route Table을 통한 동적 라우팅
- **멀티 VPC 지원**: 단일 VPN으로 여러 VPC 환경(DEV/STG/PRD 등)에 접근
- **최소 권한 원칙**: Authorization Rules로 네트워크 세그먼트별 접근 제어
- **Split Tunnel**: 기업 리소스만 VPN을 통해 라우팅, 인터넷 트래픽은 직접 연결

### 1.4 Terrafom 구성

```
aws_vpn_tgw/
├── certs
|   ├── root-ca
|   └── tls  
├── config/
│   └── keycloak
|       ├── idp-metadata.xml       # Keycloak SAML 메타데이터 파일
|       └── aws-vpn-client.json    # Keycloak Client 구성         
├── main.tf                        # 루트 모듈 (VPN + TGW)
├── variables.tf                   # 입력 변수 정의
├── outputs.tf                     # 출력값
├── terraform.tfvars               # 실제 환경 설정
├── README.md                      # 이 파일
└── modules/
    ├── client_vpn/                # Client VPN 모듈
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── transit_gateway/           # Transit Gateway 모듈
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

### 1.5 구성 요소

- **Transit Gateway**: VPN 및 VPC 간 네트워크 라우팅 중앙 허브 (Default Route Table 비활성화, Custom Route Table 사용)
- **TGW Route Propagation**: VPC CIDR 자동 학습 (각 VPC attachment에서 CIDR을 TGW Route Table로 전파)
- **VPC Route Tables**: Hub-and-Spoke 토폴로지 구현 (VPN VPC ↔ Other VPCs만 허용, Other VPCs 간 격리)
- **SAML Provider**: Keycloak의 SAML 메타데이터를 기반으로 AWS IAM SAML Provider 생성
- **Security Group**: VPN 트래픽용 보안 그룹 (Ingress 규칙 불필요, VPN Endpoint가 자동 관리)
- **Client VPN Endpoint**: SAML 인증을 사용하는 Client VPN Endpoint
- **Target Network Associations**: VPC 서브넷과의 연결 (고가용성을 위해 2개 AZ)
- **Authorization Rules**: VPN 사용자에 대한 접근 제어 (VPN VPC + Other VPCs)
- **VPN Routes**: Client VPN에서 TGW를 경유하여 VPC로 트래픽 라우팅

### 1.6 아키텍처 (Hub-and-Spoke 토폴로지)

```
┌───────────────────────────────────────────────────────────┐
│              VPN Clients (172.31.0.0/16)                  │
│                                                           │
│  ┌──────────────────────────────────────────────────-──┐  │
│  │  Client VPN Endpoint                                │  │
│  │  (Keycloak SAML Authentication)                     │  │
│  │  - Authorization: 10.0.0.0/16, 10.1.0.0/16..        │  │
│  │  - Routes: All VPCs via TGW                         │  │
│  └───────────────────────────────────────────────────-─┘  │
└──────────────────────────┬──────────────────────────-─────┘
                           │
                           │ EKS CICD VPC Subnet (Target Network)
                           ▼
              ┌─────────────────────────────────┐
              │ EKS CICD VPC (VPN Hub)          │◄───┐
              │      (10.0.0.0/16)              │    │
              │ TGW Attachment                  │    │
              │ Route:                          │    │
              │   10.1/16,10.2/16,10.3/16 → TGW │    │
              └────────────┬────────────────────┘    │
                           │                         │
                           ▼                         │
        ┌──────────────────────────────────┐         │
        │     Transit Gateway (TGW)        │         │
        │  ┌────────────────────────────┐  │         │
        │  │  Custom TGW Route Table    │  │         │
        │  │  - VPC Propagation: ON     │  │         │
        │  │    (10.0/16, 10.1/16..)    │  │         │
        │  └────────────────────────────┘  │         │
        └────┬──────────────┬──────────┬───┘         │
             │              │          │             │
      ┌──────▼──────┐┌──────▼──────┐┌──▼────────┐    │
      │ EKS DEV VPC ││ EKS STG VPC ││EKS PRD VPC│    │
      │ 10.1.0.0/16 ││ 10.2.0.0/16 ││10.3.0.0/16│    │
      │ Attachment  ││ Attachment  ││Attachment │    │
      │ Route:      ││ Route:      ││Route:     │    │
      │ 10.0/16→TGW ││ 10.0/16→TGW ││10.0/16→TGW│───-┘
      └─────────────┘└─────────────┘└───────────┘
        (ISOLATED) X (ISOLATED) X (ISOLATED)
```

### 1.7 라우팅 정책 (Hub-and-Spoke)

1. **VPN Client → All VPCs**: ✅ 허용
   - Client VPN Routes: 각 VPC CIDR → TGW
   - Authorization Rules로 접근 제어

2. **EKS CICD VPC (Hub) ↔ EKS 환경별 VPCs (DEV/STG/PRD - Spoke)**: ✅ 허용
   - EKS CICD VPC Route: EKS 환경별 VPC CIDRs → TGW
   - EKS 환경별 VPC Routes: EKS CICD VPC CIDR → TGW

3. **EKS 환경별 VPCs (DEV/STG/PRD) ↔ 서로간**: 격리 (Spoke)
   - VPC Route에 다른 Spoke CIDR 없음
   - TGW Propagation은 학습하지만 VPC Route가 없어 통신 불가

4. **Response Traffic**: ✅ 자동
   - Stateful Connection Tracking으로 응답 자동 처리
   - VPN Client로의 Return Route 불필요

## 2. 사전 준비 사항

### 2.1 Server Certificate (ACM)

AWS Client VPN은 서버 인증서를 필요로 합니다. 다음 방법 중 하나를 선택하세요.

- 로컬 인증서 생성 후 ACM에 import

  ```bash
  # 프로젝트의 certs 디렉토리에서 실행
  cd cert
  make install cert  # mkcert 설치 및 인증서 생성
  
  # 생성된 인증서를 ACM에 업로드
  aws acm import-certificate \
    --certificate fileb://tls/server.crt \
    --private-key fileb://tls/server.key \
    --certificate-chain fileb://tls/ca.crt \
    --region ap-northeast-2
  ```

- 기존 ACM 인증서 조회

  ```bash
  aws acm list-certificates --region ap-northeast-2
  ```

여기서 출력된 Certificate ARN을 terraform.tfvars의 `server_certificate_arn`에 입력하세요.

### 2.2 SAML Metadata 생성 및 다운로드

Keycloak에서 VPN용 SAML 메타데이터를 준비합니다:

- Keycloak에서 VPN용 SAML 클라이언트 생성
  - Keycloak Admin Console에서 새 SAML 클라이언트 생성
    (client scopes에 role-list가 있는 경우, 매핑 에러가 발생함으로 반드시 제거 필요)
  - 또는 `config/keycloak/aws-vpn-client.json` 파일을 import

- SAML 메타데이터 다운로드
  ```bash
  curl -s https://keycloak.cnapcloud.com/realms/cnap/protocol/saml/descriptor > \
          config/keycloak/idp-metadata.xml
  ```

- 메타데이터 파일 수정
  - `config/keycloak/idp-metadata.xml` 파일을 열어 다음 설정 변경:
  - `WantAuthnRequestsSigned="true"` → `WantAuthnRequestsSigned="false"`
  - AWS Client VPN은 서명되지 않은 요청만 지원하므로 필수 변경사항입니다.

### 2.3 Hub VPC 정보 (VPN Hub - 필수)
- VPC ID (`hub_vpc_id`)
- VPC CIDR (`hub_vpc_cidr`)
- Primary Subnet ID (`hub_primary_subnet_id`) - Client VPN ENI 배치용
- Secondary Subnet ID (`hub_secondary_subnet_id`) - HA 구성 권장
- VPC Route Table ID (`hub_route_table_id`) - Hub-and-Spoke 라우팅용

### 2.4 Spoke VPCs 정보 (DEV/STG/PRD - Spoke, 선택사항)**
 - 각 VPC ID와 CIDR (`spoke_vpcs`, `spoke_vpc_cidrs`) - EKS DEV, STG, PRD 등
 - 각 VPC의 Subnet IDs 최소 2개 (`spoke_vpcs[vpc_id]`) - TGW Multi-AZ Attachment용
 - 각 VPC Route Table ID (`spoke_vpc_route_table_ids[vpc_id]`) - Hub-and-Spoke 라우팅용

## 3. Terraform 설정 및 배포

### 3.1 변수 구성

| 변수 | 설명 | 기본값 | 필수 |
|------|------|--------|------|
| `aws_region` | AWS 리전 | `ap-northeast-2` | N |
| `environment` | 환경 이름 | - | **Y** |
| `project_name` | 프로젝트 이름 | `aws-vpn-tgw` | N |
| `saml_provider_name` | SAML Provider 이름 | `KeycloakVPN` | **Y** |
| `saml_metadata_file_path` | SAML 메타데이터 파일 경로 | - | **Y** |
| **Hub VPC (VPN Hub)** |
| `hub_vpc_id` | Hub VPC ID (VPN이 배포되는 중앙 허브) | - | **Y** |
| `hub_vpc_cidr` | Hub VPC CIDR 블록 | - | **Y** |
| `hub_route_table_id` | Hub VPC Route Table ID | - | **Y** |
| `hub_primary_subnet_id` | Hub VPC Primary Subnet ID | - | **Y** |
| `hub_secondary_subnet_id` | Hub VPC Secondary Subnet ID (HA) | `null` | N |
| `vpn_client_cidr_block` | VPN 클라이언트 IP 대역 | `172.31.0.0/16` | N |
| `server_certificate_arn` | ACM 인증서 ARN | - | **Y** |
| `split_tunnel_enabled` | Split Tunnel 활성화 | `true` | N |
| `connection_log_enabled` | 연결 로깅 활성화 | `false` | N |
| **Spoke VPCs (선택사항 - 멀티 VPC 구성 시)** |
| `spoke_vpcs` | Spoke VPC와 서브넷 맵 (각 VPC 최소 2개 서브넷) | `{}` | N |
| `spoke_vpc_cidrs` | Spoke VPC의 CIDR 맵 (라우팅 및 Authorization Rule용) | `{}` | N |
| `spoke_vpc_route_table_ids` | Spoke VPC의 Route Table ID 맵 (Hub로 라우트 자동 추가) | `{}` | N |

### 3.2 Validation Rules

Terraform이 다음 사항을 자동 검증합니다.

- `vpn_client_cidr_block`: 유효한 CIDR 블록
- **멀티 VPC 구성 시에만 적용:**
  - `spoke_vpcs`: 각 Spoke VPC는 최소 2개 서브넷 필요 (TGW Multi-AZ 요구사항)
  - `spoke_vpc_cidrs`: 모든 CIDR 블록이 유효한 형식

### 3.3 CloudWatch 로그 그룹 설정

Client VPN 연결 로그를 위한 CloudWatch 로그 그룹이 자동으로 생성됩니다.
- **로그 그룹명**: `/aws/clientvpn/${var.environment}-keycloak-vpn`
- **보관 기간**: 30일
- **자동 관리**: Terraform이 생성 및 삭제를 자동으로 처리합니다

기존에 동일한 이름의 로그 그룹이 존재하는 경우, Terraform 배포 전에 수동으로 삭제하거나 `terraform import` 명령어를 사용하여 기존 리소스를 Terraform 상태에 추가할 수 있습니다.

```bash
# 기존 로그 그룹 삭제 (필요한 경우)
aws logs delete-log-group --log-group-name "/aws/clientvpn/prod-keycloak-vpn" --region ap-northeast-2

# 또는 기존 로그 그룹 import (필요한 경우)
terraform import 'module.client_vpn.aws_cloudwatch_log_group.vpn_logs' "/aws/clientvpn/prod-keycloak-vpn"
```

### 3.4 terraform.tfvars 파일 생성

```hcl
# AWS 기본 설정
aws_region   = "ap-northeast-2"
environment  = "prod"
project_name = "aws-vpn-tgw"

# Keycloak SAML 설정
saml_provider_name      = "KeycloakVPN"
saml_metadata_file_path = "${path.module}/config/idp-metadata.xml"

# Hub VPC 설정 (VPN Hub)
hub_vpc_id              = "vpc-xxxxx"       # Hub VPC ID
hub_vpc_cidr            = "10.0.0.0/16"
hub_route_table_id      = "rtb-xxxxx"      # Hub VPC Route Table
hub_primary_subnet_id   = "subnet-xxxxx"   # 최소 1개 필요
hub_secondary_subnet_id = "subnet-yyyyy"   # HA 구성 권장

# VPN 클라이언트 설정
vpn_client_cidr_block  = "172.31.0.0/16"
split_tunnel_enabled   = true
connection_log_enabled = false
server_certificate_arn = "arn:aws:acm:ap-northeast-2:xxxx:certificate/xxxxx"

# Transit Gateway - Spoke VPC 구성 (DEV/STG/PRD)
spoke_vpcs = {
  "vpc-11111" = ["subnet-aaaaa", "subnet-bbbbb"]  # EKS DEV VPC (Spoke)
  "vpc-22222" = ["subnet-ccccc", "subnet-ddddd"]  # EKS STG VPC (Spoke)
  "vpc-33333" = ["subnet-eeeee", "subnet-fffff"]  # EKS PRD VPC (Spoke)
}

# Spoke VPC의 CIDR (라우팅 및 Authorization Rule 생성용)
spoke_vpc_cidrs = {
  "vpc-11111" = "10.1.0.0/16"  # EKS DEV VPC (Spoke)
  "vpc-22222" = "10.2.0.0/16"  # EKS STG VPC (Spoke)
  "vpc-33333" = "10.3.0.0/16"  # EKS PRD VPC (Spoke)
}

# Spoke VPC의 Route Table ID (Hub로 라우트 자동 추가)
spoke_vpc_route_table_ids = {
  "vpc-11111" = "rtb-aaaaa"  # EKS DEV VPC Route Table
  "vpc-22222" = "rtb-ccccc"  # EKS STG VPC Route Table
  "vpc-33333" = "rtb-eeeee"  # EKS PRD VPC Route Table
}
```

### 3.5 Terraform 배포

1. Terraform 초기화 및 배포
```bash
terraform init 
terraform plan 
terraform apply
```

2. 출력결과
```bash
terraform output

# 예상 출력
client_vpn_client_cidr_block = "172.31.0.0/16"
 client_vpn_dns_name = "*.cvpn-endpoint-0b78581f0492882f1.prod.clientvpn.ap-northeast-2.amazonaws.com"
 client_vpn_endpoint_arn = "arn:aws:ec2:ap-northeast-2:***:client-vpn-endpoint/cvpn-endpoint-0b78581f0492882f1"
 client_vpn_endpoint_id = "cvpn-endpoint-0b78581f0492882f1"
 saml_provider_arn = "arn:aws:iam::***:saml-provider/keycloak-vpn-saml-prd"
 target_network_associations = {
   "primary" = "cvpn-assoc-0da30997ebefd377e"
   "secondary" = "cvpn-assoc-010acc4e4a7041601"
 }
 transit_gateway_arn = "arn:aws:ec2:ap-northeast-2:***:transit-gateway/tgw-00ec02f84b128b17a"
 transit_gateway_id = "tgw-00ec02f84b128b17a"
 transit_gateway_route_table_id = "tgw-rtb-0ba8e5a3c29b1d888"
 vpc_attachments = {
   "hub_vpc" = {
     "id" = "tgw-attach-023eca0b153ded9c1"
     "subnet_ids" = toset([
       "subnet-018e83fac1c0bd1fb",
       "subnet-0759da3d1b1213e47",
       "subnet-0850f030aa8ff5265",
     ])
     "transit_gateway_id" = "tgw-00ec02f84b128b17a"
     "vpc_id" = "vpc-034b880b82a8fa18a"
   }
   "spoke_vpcs" = {
     "vpc-04f77c63f7828516a" = {
       "id" = "tgw-attach-07b92ba2400a8fd54"
       "subnet_ids" = toset([
         "subnet-00aae983abcb2dea8",
         "subnet-0d621ab4b16a9b393",
       ])
       "transit_gateway_id" = "tgw-00ec02f84b128b17a"
       "vpc_id" = "vpc-04f77c63f7828516a"
     }
   }
 }
 vpn_log_group_name = "/aws/clientvpn/keycloak-vpn-prd"
```


3. 개별 Output 확인
```bash
terraform output client_vpn_endpoint_id
terraform output saml_provider_arn
terraform output vpn_security_group_id
terraform output transit_gateway_id
```

### 3.6 초기 배포 후 Route 확인 (중요)

**⚠️ 초기 배포 후 VPN 연결 전에 반드시 확인하세요!**

Terraform apply 완료 후 Client VPN route가 active 상태가 되기까지 1-2분이 소요됩니다. VPN 클라이언트가 최초 연결 시 이 route들을 받기 때문에, 연결 전에 모든 route가 준비되었는지 확인해야 합니다.

```bash
# 1. Client VPN Endpoint ID 확인
CLIENT_VPN_ID=$(terraform output -raw client_vpn_endpoint_id)

# 2. Route 상태 확인 (1-2분 대기 후)
aws ec2 describe-client-vpn-routes \
  --client-vpn-endpoint-id $CLIENT_VPN_ID \
  --region ap-northeast-2

# 3. 모든 route의 Status.Code가 "active"인지 확인
# 예시 출력:
# "Status": {
#     "Code": "active"  <- 이것이 모든 route에서 "active"여야 함
# }
```

**Route 상태 확인 시나리오:**
- ✅ **모든 route가 active**: VPN 연결 진행 가능
- ❌ **일부 route가 creating/pending**: 1-2분 더 대기 후 재확인
- ❌ **일부 route가 failed**: TGW attachment, subnet, route table 설정 확인 필요

**주의사항:**
- Route가 active 상태가 아닌 상태에서 VPN에 연결하면, 해당 CIDR로 접근이 불가능합니다
- 이 경우 VPN을 재연결하거나, route 문제를 해결한 후 재연결해야 합니다

## 4. VPN Client 설정

### 4.1 VPN 설정 파일 다운로드

AWS 콘솔 또는 CLI를 통해 VPN 클라이언트 설정 파일을 다운로드합니다.

```bash
# Endpoint ID 확인
CLIENT_VPN_ID=$(terraform output -raw client_vpn_endpoint_id)

# VPN Configuration 다운로드
aws ec2 export-client-vpn-client-configuration \
  --client-vpn-endpoint-id $CLIENT_VPN_ID \
  --output text \
  --region ap-northeast-2 > client-config.ovpn
```

### 4.2 VPN 클라이언트 애플리케이션 설치

[AWS Client VPN 다운로드](https://aws.amazon.com/vpn/client-vpn-download/) 페이지에서 사용 중인 OS에 맞는 클라이언트를 설치합니다.

### 4.3 ovpn 설정 파일 수정

AWS 콘솔에서 다운로드한 `.ovpn` 파일은 SAML 인증 시 브라우저 리다이렉션의 안정성을 위해 접속 주소를 고정하는 수정 작업이 필요합니다.

**CASE A: AWS 기본 주소 사용 (테스트용)**

별도의 DNS 등록 없이 AWS 엔드포인트를 직접 사용합니다. 주소 앞에 임의의 문자(test.)를 붙여 와일드카드 DNS 응답을 유도합니다.

```
# 수정 전
remote cvpn-endpoint-0abc123456789.prod.clientvpn.us-east-1.amazonaws.com 443
remote-random-hostname

# 수정 후
remote test.cvpn-endpoint-0abc123456789.prod.clientvpn.us-east-1.amazonaws.com 443
# remote-random-hostname  <-- 주석 처리 (제거)
auth-federate             <-- SAML 인증 필수 옵션 추가
```

**CASE B: 사용자 정의 도메인 사용 (운영 권장)**

회사 전용 도메인을 사용하여 사용자 편의성을 높입니다.

```
# 수정 전
remote cvpn-endpoint-0abc123456789.prod.clientvpn.us-east-1.amazonaws.com 443
remote-random-hostname

# 수정 후
remote vpn.cnapcloud.com 443
# remote-random-hostname  <-- 주석 처리 (제거)
auth-federate             <-- SAML 인증 필수 옵션 추가
```

이 경우는 다음과 같이 인증서 구성과 도메인 등록 작업이 필요합니다:

**서버 인증서 구성**  
```makefile
# cert/Makefile의 환경 변수 예시
COMMON_NAME ?= aws-vpn-dev
ALT_NAMES ?= DNS:$(COMMON_NAME),DNS:vpn.cnapcloud.com,DNS:*.vpn.cnapcloud.com
```

**DNS 도메인 등록**  
도메인 관리자(Route 53 등)에서 커스텀 도메인이 AWS VPN 엔드포인트를 가리키도록 설정합니다.
   
| 레코드 이름 | 레코드 유형 | 값 (Target) |
|-----------|-----------|-----------|
| vpn | CNAME | cvpn-endpoint-0abc123456789...amazonaws.com |


### 4.4 VPN 프로파일 생성

VPN 클라이언트 애플리케이션에서:
1. 프로파일 관리 메뉴 열기
2. 프로파일 추가 클릭
3. 프로파일 이름 입력 (예: "AWS-VPN")
4. 다운로드한 `client-config.ovpn` 파일 선택
5. 저장

### 4.5 VPN 연결 및 인증

1. VPN 클라이언트에서 생성한 프로파일 선택
2. **연결** 버튼 클릭
3. 브라우저가 자동으로 열려 Keycloak 로그인 페이지로 리다이렉트됨
4. Keycloak 계정으로 인증 수행
5. 인증 완료 후 VPN 연결 자동 수립


## 5. 고급 설정

### 5.1 그룹별 접근 제어

기본 구성은 모든 인증된 사용자를 허용합니다. 특정 Keycloak 그룹만 접근하도록 제한하려면 `modules/client_vpn/main.tf`에서 다음과 같이 변경하세요. 참고로 Hub-and-Spoke 아키텍처에서는 모든 트래픽이 VPN Hub VPC를 경유하므로, Hub VPC 접근을 차단하면 다른 VPC들도 자동으로 차단됩니다.

```hcl
# authorize_all_groups = true 를 access_group_id로 변경
resource "aws_ec2_client_vpn_authorization_rule" "vpc_access" {
  client_vpn_endpoint_id = aws_ec2_client_vpn_endpoint.keycloak.id
  target_network_cidr    = var.vpc_cidr
  access_group_id        = "vpn-users"  # Keycloak 그룹명
  description            = "Allow vpn-users group to VPN VPC"
  
  depends_on = [aws_ec2_client_vpn_network_association.primary]
}
```

### 5.2 Self-Service Portal

사용자가 직접 VPN 클라이언트 설정 파일을 다운로드하고 관리할 수 있는 웹 포털입니다. 활성화하면 관리자가 개별적으로 설정 파일을 배포할 필요 없이 사용자가 Self-Service Portal URL을 통해 자신의 VPN 설정을 다운로드할 수 있습니다.

```bash
aws ec2 modify-client-vpn-endpoint \
  --client-vpn-endpoint-id $(terraform output -raw client_vpn_endpoint_id) \
  --self-service-portal enabled \
  --region ap-northeast-2
```

## 6. 문제 해결

### 6.1 VPN 연결 문제

**1. VPN 연결 실패**
- Security Group의 443 포트가 열려있는지 확인
- `config/idp-metadata.xml` 파일이 올바른 메타데이터를 포함하는지 확인
- ACM 인증서가 유효하고 올바른 ARN인지 확인
- SAML assertion 유효시간 확인 (Keycloak과 AWS 서버 시간이 동기화되어 있는지 확인)

**2. SAML 인증 실패**
- `config/idp-metadata.xml` 메타데이터가 현재 Keycloak 설정과 일치하는지 확인
- Keycloak의 SAML 클라이언트 설정 확인
- Keycloak 사용자가 적절한 그룹에 속해있는지 확인

**3. 접근 권한 오류**
- Authorization Rule 설정 확인
- Keycloak 그룹 설정 확인
- SAML 응답의 group attribute 확인

**4. 방화벽 설정**
- Client VPN에서 접근하는 자원에 대한 방화벽의 소스를 keycloak-vpn-sg로 설정

### 6.2 Hub VPC에서 Spoke VPC 연결 안 됨

**원인:** EC2가 있는 subnet이 TGW에 연결되지 않음

**해결:**
terraform.tfvars에 EC2 subnet 추가 후 apply
```hcl
hub_tgw_subnet_ids = [
  "subnet-xxx",  # VPN Subnet
  "subnet-yyy",  # VPN Subnet
  "subnet-zzz"   # EC2 Subnet (추가)
]
```

### 6.3 VPN Client에서 Spoke VPC 연결 안 됨

**원인:** Split tunnel 모드에서 route는 연결 시 동적으로 push됨

**시나리오별 해결 방법:**

#### 시나리오 1: 초기 배포 후 처음 연결 시

1. **AWS에서 Route 상태 확인:**
   ```bash
   CLIENT_VPN_ID=$(terraform output -raw client_vpn_endpoint_id)
   aws ec2 describe-client-vpn-routes \
     --client-vpn-endpoint-id $CLIENT_VPN_ID \
     --query 'Routes[*].[DestinationCidr,Status.Code]' \
     --output table
   ```

2. **모든 route가 "active"인지 확인**
   - ✅ Active: VPN 연결 진행
   - ❌ Creating/Pending: 1-2분 대기 후 재확인
   - ❌ Failed: TGW, subnet, authorization rule 확인

3. **VPN 연결 후 클라이언트 route 확인:**
   ```bash
   # macOS/Linux
   netstat -rn | grep "^10"  # Spoke CIDR이 보여야 함
   ---
   default            link#20            UCSIg           bridge100      !
   10/16              100.30.0.1         UGSc                utun6 

   # Windows
   route print | findstr "10."
   ```

#### 시나리오 2: spoke_vpc_cidrs_list 변경 후

1. **Terraform apply로 route 변경:**
   ```bash
   terraform apply
   ```

2. **모든 VPN 사용자에게 재연결 안내** (필수!)
   - 재연결하지 않으면 새 CIDR로 접근 불가
   - 기존 연결된 사용자는 이전 route만 유지

3. **재연결 후 클라이언트 route 확인:**
   ```bash
   netstat -rn | grep "^10"  # 새로 추가된 CIDR이 보여야 함
   ```

#### 시나리오 3: Route는 있지만 연결 안 됨

1. **Authorization Rule 확인:**
   ```bash
   aws ec2 describe-client-vpn-authorization-rules \
     --client-vpn-endpoint-id $CLIENT_VPN_ID
   ```
   - Spoke VPC CIDR에 대한 authorization rule이 있는지 확인

2. **TGW Route Table 확인:**
   ```bash
   TGW_ID=$(terraform output -raw transit_gateway_id)
   aws ec2 describe-transit-gateway-route-tables \
     --transit-gateway-id $TGW_ID
   ```

3. **Spoke VPC 보안 그룹 확인:**
   - VPN 클라이언트 CIDR (예: 172.31.0.0/16)에서의 인바운드 허용 확인

> ⚠️ **중요:** Terraform으로 route 변경 (`spoke_vpc_cidrs_list` 추가/삭제) 후 모든 VPN 사용자는 재연결 필요

### 6.4 Spoke VPC 보안 그룹 설정

**증상:** TCP는 되지만 ping/traceroute가 안 됨

**해결 방법:**
Spoke VPC의 EC2 보안 그룹에 ICMP 추가:
```bash
aws ec2 authorize-security-group-ingress \
  --group-id <spoke-sg-id> \
  --ip-permissions IpProtocol=icmp,FromPort=-1,ToPort=-1,IpRanges='[{CidrIp=0.0.0.0/0}]'
```


### 6.5 라우팅 구성 확인

1. Client VPN 엔드포인트 라우팅 확인
```bash
 aws ec2 describe-client-vpn-routes \
   --client-vpn-endpoint-id cvpn-endpoint-043254bde701047f7 \
   --query "Routes[*].{Dest:DestinationCidr, Target:TargetSubnet, State:Status.Code, Type:Type}" \
   --output table
 -----------------------------------------------------------------
 |                    DescribeClientVpnRoutes                    |
 +----------------+---------+----------------------------+-------+
 |      Dest      |  State  |          Target            | Type  |
 +----------------+---------+----------------------------+-------+
 |  172.31.0.0/16 |  active |  subnet-018e83fac1c0bd1fb  |  Nat  |
 |  172.31.0.0/16 |  active |  subnet-0850f030aa8ff5265  |  Nat  |
 |  10.0.0.0/16   |  active |  subnet-0850f030aa8ff5265  |  Nat  |
 +----------------+---------+----------------------------+-------+
 ```

2. Transit Gateway(TGW) 라우팅 테이블 확인
```bash
TGW_RT_ID=$(aws ec2 describe-transit-gateway-route-tables \
  --filters "Name=transit-gateway-id,Values=tgw-026e0998551152c58" \
  --query 'TransitGatewayRouteTables[0].TransitGatewayRouteTableId' --output text)

aws ec2 search-transit-gateway-routes \
  --transit-gateway-route-table-id "$TGW_RT_ID" \
  --filters "Name=state,Values=active" \
  --query "Routes[*].{Dest:DestinationCidrBlock, Type:Type, Target:TransitGatewayAttachments[0].TransitGatewayAttachmentId}" \
  --output table
-----------------------------------------------------------------
|                  SearchTransitGatewayRoutes                   |
+----------------+--------------------------------+-------------+
|      Dest      |            Target              |    Type     |
+----------------+--------------------------------+-------------+
|  10.0.0.0/16   |  tgw-attach-0834048b83afff405  |  propagated |
|  100.30.0.0/16 |  tgw-attach-0efbcf18c4f7d9480  |  static     |
|  172.31.0.0/16 |  tgw-attach-0efbcf18c4f7d9480  |  propagated |
+----------------+--------------------------------+-------------+
```
 
3.Hub VPC 라우팅 테이블 확인
```bash
HUB_RT_ID="rtb-0b81a4e75b2b650ce"  

aws ec2 describe-route-tables \
  --route-table-ids $HUB_RT_ID \
  --query "RouteTables[0].Routes[*].{Dest:DestinationCidrBlock, TGW:TransitGatewayId, IGW:GatewayId, State:State}" \
  --output table
-------------------------------------------------------------------------------
|                             DescribeRouteTables                             |
+---------------+-------------------------+---------+-------------------------+
|     Dest      |           IGW           |  State  |           TGW           |
+---------------+-------------------------+---------+-------------------------+
|  172.31.0.0/16|  local                  |  active |  None                   |
|  10.0.0.0/16  |  None                   |  active |  tgw-026e0998551152c58  |
|  0.0.0.0/0    |  igw-0c8aadb4f134d9a6b  |  active |  None                   |
+---------------+-------------------------+---------+-------------------------+
```

4. Spoke VPC 라우팅 테이블 확인
```bash
SPOKE_RT_ID="rtb-0dfaec5ab7960837d" # "rtb-0c7e523fbf4056473", ....

aws ec2 describe-route-tables \
  --route-table-ids $SPOKE_RT_ID \
  --query "RouteTables[0].Routes[*].{Dest:DestinationCidrBlock, Gateway:TransitGatewayId, State:State}" \
  --output table
------------------------------------------------------
|                 DescribeRouteTables                |
+----------------+-------------------------+---------+
|      Dest      |         Gateway         |  State  |
+----------------+-------------------------+---------+
|  172.31.0.0/16 |  tgw-026e0998551152c58  |  active |
|  10.0.0.0/16   |  None                   |  active |
|  100.30.0.0/16 |  tgw-026e0998551152c58  |  active |
+----------------+-------------------------+---------+
```


## 7. 정리

다음과 같이 Terraform으로 배포한 리소스를 삭제힙니다.

```bash
terraform destroy
```

EC2 Client VPN Route를 지우다가  timeout이 발생하면 재시도 합니다.


## 참고자료

- [AWS Client VPN Endpoint Documentation](https://docs.aws.amazon.com/vpn/latest/clientvpn-user/)
- [AWS IAM SAML Provider](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_saml.html)
- [Keycloak SAML Documentation](https://www.keycloak.org/docs/latest/server_admin/#saml)
