import assert from "node:assert/strict";
import { test } from "node:test";
import { requestPolicy, trustedClientAddress, unsafeBrowserMutation } from "./request-policy.ts";

test("public reads are explicit and mutations and unknown routes require sessions", () => {
  for (const path of ["/api/health", "/api/problems/13", "/api/contests/final/events", "/api/rankings"]) {
    assert.equal(requestPolicy(path, "GET").authentication, "public");
    assert.equal(requestPolicy(path, "POST").authentication, "session");
  }
  assert.equal(requestPolicy("/api/admin/users", "GET").authentication, "session");
  assert.equal(requestPolicy("/api/new-feature", "GET").authentication, "session");
  assert.equal(requestPolicy("/api/submissions/1/events", "GET").authentication, "session");
  assert.equal(requestPolicy("/api/webhooks/clerk", "POST").authentication, "credential");
  assert.equal(requestPolicy("/api/admin/submissions/recover", "GET").authentication, "credential");
});

test("execution, stream, and expensive work get shared strict budgets", () => {
  assert.deepEqual(requestPolicy("/api/judge/run", "POST"), { authentication: "session", bucket: "interactive", limit: 1, windowSeconds: 3 });
  assert.equal(requestPolicy("/api/submissions", "POST").limit, 4);
  assert.equal(requestPolicy("/api/admin/problems/import", "POST").limit, 3);
  assert.equal(requestPolicy("/api/contests/1/events", "GET").limit, 4);
});

test("client-controlled forwarding headers cannot evade rate budgets", () => {
  const headers = new Headers({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "1.2.3.4", "x-vercel-forwarded-for": "1.2.3.4" });
  assert.equal(trustedClientAddress(headers, false), "shared-untrusted-network");
  assert.equal(trustedClientAddress(headers, true), "1.2.3.4");
  headers.set("x-vercel-forwarded-for", "1.2.3.4, 5.6.7.8");
  assert.equal(trustedClientAddress(headers, true), "shared-untrusted-network");
  headers.set("x-vercel-forwarded-for", "2001:0db8::1");
  assert.equal(trustedClientAddress(headers, true), "[2001:db8::1]");
});

test("cookie mutations must have a same-origin browser context", () => {
  const request = (headers: Record<string, string>, method = "POST") => new Request("https://koj.example/api/submissions", { method, headers });
  assert.equal(unsafeBrowserMutation(request({ origin: "https://koj.example", cookie: "__session=token" })), false);
  assert.equal(unsafeBrowserMutation(request({ origin: "https://evil.example", cookie: "__session=token" })), true);
  assert.equal(unsafeBrowserMutation(request({ cookie: "__session=token" })), true);
  assert.equal(unsafeBrowserMutation(request({ "sec-fetch-site": "cross-site" })), true);
  assert.equal(unsafeBrowserMutation(request({ authorization: "Bearer token" })), false);
  assert.equal(unsafeBrowserMutation(request({ origin: "null" })), true);
  assert.equal(unsafeBrowserMutation(request({ origin: "https://evil.example" }, "GET")), false);
});
