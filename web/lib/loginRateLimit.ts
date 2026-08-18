const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const MAX_BUCKETS = 5000;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function clientIpFromRequest(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 128);
  return "unknown";
}

function prune(now: number): void {
  if (buckets.size > MAX_BUCKETS) {
    for (const [key, bucket] of Array.from(buckets.entries())) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }
}

export function loginRetryAfterSec(ip: string): number | null {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) return null;
  if (bucket.count < MAX_ATTEMPTS) return null;
  return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  prune(now);
  const current = buckets.get(ip);
  if (!current || current.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  current.count += 1;
}

export function clearLoginFailures(ip: string): void {
  buckets.delete(ip);
}
