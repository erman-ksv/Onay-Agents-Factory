# TezJet Agent Factory

A modular multi-agent development system for TezJet.

## Core agents
- Commander — plans and orchestrates work
- Explorer — understands the codebase
- Backend / Frontend / Database — implementation specialists
- Tester — validates changes
- Security — checks security risks
- Reviewer — reviews implementation
- GitHub — repository automation

## Core flow

Task → Commander → Explorer → Specialist → Tester → Security → Reviewer → GitHub

## Development

The initial architecture lives on `dev/agent-factory-core`. Secrets belong in environment variables or the deployment platform, never in Git.
