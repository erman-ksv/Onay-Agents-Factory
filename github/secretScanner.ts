const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

export type SecretFinding = {
  pattern: string;
  line: number;
};

export function scanForSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    SECRET_PATTERNS.forEach((pattern) => {
      if (pattern.test(line)) findings.push({ pattern: pattern.source, line: index + 1 });
    });
  });

  return findings;
}

export function assertNoSecrets(files: Array<{ path: string; content: string }>) {
  const findings = files.flatMap((file) =>
    scanForSecrets(file.content).map((finding) => ({ ...finding, path: file.path })),
  );

  if (findings.length) {
    throw new Error(
      `Secret scan blocked the operation: ${findings.map((x) => `${x.path}:${x.line}`).join(", ")}`,
    );
  }
}
