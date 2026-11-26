// Blocks text that looks like a secret before it is stored or shown to anyone.
const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/, "an Anthropic API key"],
  [/\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/, "an OpenAI API key"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, "a GitHub token"],
  [/github_pat_[A-Za-z0-9_]{20,}/, "a GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS key"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "a Google API key"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/, "a Stripe key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "a login token"],
  [/\bnsec1[a-z0-9]{50,}/, "a Nostr private key"],
  [/\/mcp\/[A-Za-z0-9_-]{16}\/[A-Za-z0-9_-]{32}/, "a room connector URL (it contains someone's key)"],
];

export function findSecret(text) {
  if (!text) return null;
  for (const [re, label] of PATTERNS) if (re.test(text)) return label;
  // Long runs of mixed letters and digits look like encoded credentials.
  // Pure digit runs are allowed because math has big numbers.
  for (const m of text.matchAll(/[A-Za-z0-9+/=_-]{120,}/g)) {
    if (/[A-Za-z]/.test(m[0]) && /[0-9]/.test(m[0])) return "a long encoded string";
  }
  return null;
}
