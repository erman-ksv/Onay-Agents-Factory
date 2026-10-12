export type CommanderPublicationOptions = {
  branch: string;
  title: string;
  body: string;
};

export type CommanderArgs = {
  goal: string;
  publication?: CommanderPublicationOptions;
};

export const COMMANDER_USAGE =
  'Usage: pnpm dev -- "Describe the task" [--publish --branch feat/name --title "PR title" --body "PR summary"]';

function validatePublicationBranch(branch: string): void {
  if (["main", "master", "refs/heads/main", "refs/heads/master"].includes(branch)) {
    throw new Error("Publishing directly to main/master is blocked; use a feature branch.");
  }

  const components = branch.split("/");
  if (
    branch === "@" ||
    branch.startsWith("-") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    /[\x00-\x20\x7f~^:?*\[\\]/.test(branch) ||
    components.some((component) => !component || component.startsWith(".") || component.endsWith(".lock"))
  ) {
    throw new Error(`Invalid publication branch: ${branch}`);
  }
}

export function parseCommanderArgs(args: string[]): CommanderArgs {
  const goalParts: string[] = [];
  const values: Partial<CommanderPublicationOptions> = {};
  let publish = false;
  let parseOptions = true;

  // pnpm can forward its separator as the first argument to the script.
  for (let index = args[0] === "--" ? 1 : 0; index < args.length; index++) {
    const arg = args[index];
    if (!parseOptions) {
      goalParts.push(arg);
      continue;
    }
    if (arg === "--") {
      parseOptions = false;
      continue;
    }
    if (arg === "--publish") {
      if (publish) throw new Error("Duplicate argument: --publish");
      publish = true;
      continue;
    }
    if (arg === "--branch" || arg === "--title" || arg === "--body") {
      const key = arg.slice(2) as keyof CommanderPublicationOptions;
      if (values[key] !== undefined) throw new Error(`Duplicate argument: ${arg}`);
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      values[key] = value.trim();
      index++;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown argument: ${arg}`);
    goalParts.push(arg);
  }

  const goal = goalParts.join(" ").trim();
  if (!goal) throw new Error(`A task goal is required. ${COMMANDER_USAGE}`);

  if (!publish) {
    if (Object.keys(values).length > 0) {
      throw new Error("--branch, --title, and --body require --publish");
    }
    return { goal };
  }

  for (const key of ["branch", "title", "body"] as const) {
    if (!values[key]) throw new Error(`--${key} is required with --publish`);
  }
  const publication: CommanderPublicationOptions = {
    branch: values.branch!,
    title: values.title!,
    body: values.body!,
  };
  validatePublicationBranch(publication.branch);
  return { goal, publication };
}
