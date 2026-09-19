export const GOLANGCI_LINT_CONFIG = `version: "2"

linters:
  enable:
    - errcheck
    - govet
    - staticcheck
    - ineffassign
    - unused
  settings:
    govet:
      enable-all: true
`;
