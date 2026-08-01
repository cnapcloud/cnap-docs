.PHONY: install start build serve deploy docker-build docker-push clean

IMAGE_ORG ?= cnapcloud
IMAGE_NAME ?= cnap-docs
IMAGE_TAG ?= $(shell git rev-parse --short=4 HEAD)
IMAGE = $(IMAGE_ORG)/$(IMAGE_NAME):$(IMAGE_TAG)
IMAGE_LATEST = $(IMAGE_ORG)/$(IMAGE_NAME):latest
CACHE_IMAGE = $(IMAGE_ORG)/$(IMAGE_NAME):buildcache

install:
	npm install

start:
	npm run start -- --port 3000

build:
	npm run build

serve: build
	npm run serve -- --port 3000

# GitHub Pages 배포. USE_SSH=true 또는 GIT_USER=<username>를 앞에 붙여서 호출:
#   USE_SSH=true make deploy
#   GIT_USER=<username> make deploy
deploy:
	npm run deploy

docker-build:
	docker buildx build --platform linux/arm64 \
		--cache-from type=registry,ref=$(CACHE_IMAGE) \
		-t $(IMAGE) --load .

# Builds and pushes directly via --push, bypassing the local image store — works with
# both the default local driver and remote drivers (e.g. CI's kubernetes buildx driver,
# which has no local daemon for docker-build's --load / a plain `docker push` to find).
# --cache-to/--cache-from with type=registry stores the layer cache as a separate
# tag in the registry, so it survives the CI builder pod being ephemeral.
docker-push:
	docker buildx build --platform linux/arm64 \
		--provenance=false --sbom=false \
		--cache-from type=registry,ref=$(CACHE_IMAGE) \
		--cache-to type=registry,ref=$(CACHE_IMAGE),mode=max \
		-t $(IMAGE) -t $(IMAGE_LATEST) --push .

clean:
	rm -rf build .docusaurus
