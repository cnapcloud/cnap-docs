import clsx from 'clsx';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import InstallJourney from '@site/src/components/InstallJourney';

import Heading from '@theme/Heading';
import styles from './index.module.css';

function HomepageHeader() {
  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className={clsx('hero__title', styles.heroTitle)}>
          CNAP 플랫폼 설치 가이드
        </Heading>
        <p className={clsx('hero__subtitle', styles.heroSubtitle)}>
          <span className={styles.labeledTerm}>
            <a
              href="https://github.com/cnapcloud/k8s"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.badgePublic}>
              소스공개
            </a>
            K8s 클러스터
          </span>{' '}
          →{' '}
          <span className={styles.labeledTerm}>
            GitOps 플랫폼
          </span>{' '}
          설치 순서로 안내합니다.
        </p>
      </div>
    </header>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <HomepageHeader />
      <main>
        <InstallJourney />
      </main>
    </Layout>
  );
}
