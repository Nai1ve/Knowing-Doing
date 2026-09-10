FROM golang:1.24-bookworm
ENV GOPROXY=off GOSUMDB=off CGO_ENABLED=0 GOCACHE=/workspace/.go-cache GOMODCACHE=/workspace/.go-mod GOPATH=/workspace/.go GOTMPDIR=/workspace/.go-tmp
WORKDIR /workspace
