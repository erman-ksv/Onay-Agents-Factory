export function runReviewer(input: string) {
  return { agent: "reviewer", input, action: "review proposed changes" };
}
