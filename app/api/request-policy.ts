import { isIP } from "node:net";

export type RequestPolicy = {
  authentication: "public" | "session" | "credential";
  bucket: "read" | "write" | "execution" | "interactive" | "expensive" | "stream";
  limit: number;
  windowSeconds: number;
};

const PUBLIC_READ = [
  /^\/api\/health$/,
  /^\/api\/auth\/me$/,
  /^\/api\/problems(?:\/[^/]+)?$/,
  /^\/api\/contests(?:\/[^/]+(?:\/events|\/clarifications)?)?$/,
  /^\/api\/rankings$/,
  /^\/api\/organizations$/,
];

export function requestPolicy(pathname: string, method: string): RequestPolicy {
  const read = method === "GET" || method === "HEAD";
  const credential = pathname === "/api/webhooks/clerk" || pathname === "/api/admin/submissions/recover";
  const authentication = credential ? "credential" : read && PUBLIC_READ.some((pattern) => pattern.test(pathname)) ? "public" : "session";
  if (pathname.endsWith("/events")) {
    return { authentication, bucket: "stream", limit: 4, windowSeconds: 60 };
  }
  if (pathname === "/api/judge/run") {
    return { authentication, bucket: "interactive", limit: 1, windowSeconds: 3 };
  }
  if (pathname === "/api/submissions" && !read) {
    return { authentication, bucket: "execution", limit: 4, windowSeconds: 60 };
  }
  if (/\/(?:rejudge|import|sync|recover)$/.test(pathname) || (pathname === "/api/organizations" && !read)) {
    return { authentication, bucket: "expensive", limit: 3, windowSeconds: 60 };
  }
  return { authentication, bucket: read ? "read" : "write", limit: read ? 120 : 20, windowSeconds: 60 };
}

export function trustedClientAddress(headers: Headers, vercel: boolean): string {
  if (!vercel) return "shared-untrusted-network";
  const candidate = headers.get("x-vercel-forwarded-for")?.trim();
  if (!candidate || !isIP(candidate)) return "shared-untrusted-network";
  return isIP(candidate) === 6 ? new URL(`http://[${candidate}]/`).hostname : candidate;
}

export function unsafeBrowserMutation(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.has("cookie") && !request.headers.has("authorization");
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}
