export const agents = {
  commander: { role: "orchestrator" },
  explorer: { role: "codebase analyst" },
  backend: { role: "backend developer" },
  frontend: { role: "frontend developer" },
  database: { role: "data engineer" },
  tester: { role: "QA engineer" },
  security: { role: "security reviewer" },
  reviewer: { role: "code reviewer" },
  github: { role: "repository automation" },
} as const;
