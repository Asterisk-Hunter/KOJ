import "server-only";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { resolveOrganizationContext } from "@/lib/organizations";
import { consumeRateBudget, type RateBudget } from "./rate-limit";
import { requestPolicy, trustedClientAddress, unsafeBrowserMutation } from "./request-policy";

function errorResponse(message: string, status: number, retryAfter?: number): Response {
  return Response.json({ error: message }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(retryAfter === undefined ? {} : { "Retry-After": String(retryAfter) }),
    },
  });
}

export function withApiGuard<RequestType extends Request, Context extends unknown[]>(
  handler: (request: RequestType, ...context: Context) => Promise<Response>,
): (request: RequestType, ...context: Context) => Promise<Response> {
  return async (request, ...context) => {
    try {
      const pathname = new URL(request.url).pathname.replace(/\/$/, "");
      const policy = requestPolicy(pathname, request.method);
      if (unsafeBrowserMutation(request)) {
        return errorResponse("cross-origin mutation forbidden", 403);
      }
      const address = trustedClientAddress(request.headers, process.env.VERCEL === "1");
      const ingress = await consumeRateBudget({ scope: "network", identity: address, limit: 600, windowSeconds: 60 });
      if (!ingress.allowed) return errorResponse("rate limit exceeded", 429, ingress.retryAfter);
      const session = policy.authentication === "credential" ? null : await auth();
      const userId = session?.isAuthenticated ? session.userId : null;
      const identity = userId ? `user:${userId}` : `network:${address}`;
      const budgets: RateBudget[] = [
        { scope: "all", identity, limit: 120, windowSeconds: 60 },
        { scope: policy.bucket, identity, limit: policy.limit, windowSeconds: policy.windowSeconds },
        { scope: "deployment", identity: "all", limit: 5000, windowSeconds: 60 },
      ];
      for (const budget of budgets) {
        const result = await consumeRateBudget(budget);
        if (!result.allowed) return errorResponse("rate limit exceeded", 429, result.retryAfter);
      }
      if (!userId && policy.authentication === "session") return errorResponse("unauthorized", 401);
      if (userId) {
        const [user] = await db.select({ suspended: users.suspended }).from(users).where(eq(users.clerkId, userId)).limit(1);
        if (user?.suspended) return errorResponse("account suspended", 403);
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && /^\/api\/(?:submissions|judge|contests)(?:\/|$)/.test(pathname)) {
          const organization = await resolveOrganizationContext(userId);
          if (!organization) return errorResponse("organization not found", 404);
          if (!organization.isMember) return errorResponse("join the organization before participating", 403);
          if (policy.bucket === "execution" || policy.bucket === "interactive") {
            for (const budget of [
              { scope: "execution-organization", identity: String(organization.organizationId), limit: 10, windowSeconds: 60 },
              { scope: "execution-deployment", identity: "all", limit: 20, windowSeconds: 60 },
            ]) {
              const result = await consumeRateBudget(budget);
              if (!result.allowed) return errorResponse("execution capacity rate limit exceeded", 429, result.retryAfter);
            }
          }
        }
      }
      const response = await handler(request, ...context);
      response.headers.set("Cache-Control", response.headers.get("Content-Type")?.startsWith("text/event-stream") ? "no-cache, no-transform" : "no-store");
      return response;
    } catch {
      return errorResponse("service temporarily unavailable", 503, 5);
    }
  };
}
