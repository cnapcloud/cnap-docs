---
title: "Troubleshooting"
sidebar_position: 8
---

## Theme / CSS Changes Not Applied

CSS or theme file changes require rebuilding the JAR and restarting Keycloak.

Keycloak caches gzipped theme static resources (CSS, JS, images) at startup in
`/opt/keycloak/data/tmp/kc-gzip-cache/` inside the container.

`docker compose restart` keeps the container intact, so this cache persists and the new CSS is not served.
`docker compose down` removes the container entirely, clearing the cache so the updated files are picked up on next `up`.

Java code changes in the JAR (providers, authenticators, etc.) are not affected by this cache and work with `restart`.

Steps:

1. Rebuild the JAR:

```bash
mvn package -DskipTests
```

2. Restart Keycloak:

```bash
cd docker
docker compose down keycloak && docker compose up -d keycloak
```
