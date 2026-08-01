import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

const PHASES = [
  {
    badge: 'PHASE 1',
    name: 'K8s 클러스터',
    cards: [
      {num: '1.1', title: 'EKS 클러스터', desc: 'VPC · EKS · IAM · IRSA', to: '/cluster/eks-provision'},
      {num: '1.2', title: 'VPN 네트워크', desc: 'Client VPN · Transit Gateway', to: '/cluster/vpn-tgw-provision'},
      {num: '1.3', title: 'Kind 클러스터', desc: '로컬 · 테스트 환경', to: '/cluster/kind-provision'},
      {num: '1.4', title: 'K3s 클러스터', desc: '자동 프로비저닝(k3sup)', to: '/cluster/k3s-provision'},
    ],
  },
  {
    badge: 'PHASE 2',
    name: 'GitOps 플랫폼',
    cards: [
      {num: '2.1', title: '네트워크 및 인증서', desc: 'MetalLB · Reflector · cert-manager · Ingress', to: '/gitops/network/metallb'},
      {num: '2.2', title: '데이터베이스 · 스토리지', desc: 'Redis · PostgreSQL · OpenSearch · MinIO', to: '/gitops/data-platform/redis-ha'},
      {num: '2.3', title: '인증 및 트래픽 관리', desc: 'Keycloak · OAuth2 Proxy · Kong', to: '/gitops/auth-routing/keycloak'},
      {num: '2.4', title: 'CI/CD', desc: 'Jenkins · Harbor · ArgoCD', to: '/gitops/cicd/jenkins'},
      {num: '2.5', title: '관측성', desc: 'Prometheus · Jaeger · Fluentd', to: '/gitops/observability/prometheus'},
      {num: '2.6', title: '메시징', desc: 'RabbitMQ · Kafka', to: '/gitops/messaging/rabbitmq'},
      {num: '2.7', title: '애플리케이션', desc: '샘플 애플리케이션 배포 데모', to: '/gitops/application/demo'},
    ],
  },
];

function PhaseCard({num, title, desc, to}) {
  return (
    <Link to={to} className={styles.card}>
      <div className={styles.cardNum}>{num}</div>
      <Heading as="h3" className={styles.cardTitle}>
        {title}
      </Heading>
      <p className={styles.cardDesc}>{desc}</p>
    </Link>
  );
}

function Phase({badge, name, cards}) {
  return (
    <div className={styles.phase}>
      <div className={styles.phaseLabel}>
        <span className={styles.phaseBadge}>{badge}</span>
        <span className={styles.phaseName}>{name}</span>
        <span className={styles.phaseRule} />
      </div>
      <div className={styles.grid}>
        {cards.map((card) => (
          <PhaseCard key={card.num} {...card} />
        ))}
      </div>
    </div>
  );
}

export default function InstallJourney() {
  return (
    <section className={styles.section}>
      <div className="container">
        {PHASES.map((phase) => (
          <Phase key={phase.badge} {...phase} />
        ))}
      </div>
    </section>
  );
}
