import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = (__ENV.KOJ_BASE_URL ?? "").replace(/\/+$/, "");
const authToken = __ENV.KOJ_AUTH_TOKEN ?? "";
const problemId = Number(__ENV.KOJ_PROBLEM_ID ?? "");
const contestId = Number(__ENV.KOJ_CONTEST_ID ?? "");
const pollVus = Number(__ENV.KOJ_POLL_VUS ?? "1");
const duration = __ENV.KOJ_DURATION ?? "30s";
const submitEnabled = __ENV.KOJ_ENABLE_SUBMIT === "true";
const sourceCode = __ENV.KOJ_SOURCE_CODE ?? "print(input())";

if (!/^https?:\/\//i.test(baseUrl)) {
  throw new Error("KOJ_BASE_URL must be an absolute http(s) URL");
}
if (!authToken) {
  throw new Error("KOJ_AUTH_TOKEN is required (Clerk session JWT)");
}
if (!Number.isSafeInteger(problemId) || problemId <= 0) {
  throw new Error("KOJ_PROBLEM_ID must be a positive integer");
}
if (!Number.isSafeInteger(contestId) || contestId <= 0) {
  throw new Error("KOJ_CONTEST_ID must be a positive integer");
}
if (!Number.isInteger(pollVus) || pollVus < 1 || pollVus > 5) {
  throw new Error("KOJ_POLL_VUS must be an integer from 1 to 5");
}
if (!/^([1-9]|[1-5][0-9]|60)s$/.test(duration)) {
  throw new Error("KOJ_DURATION must be between 1s and 60s");
}
if (submitEnabled && sourceCode.length === 0) {
  throw new Error("KOJ_SOURCE_CODE must not be empty when submissions are enabled");
}

const headers = {
  Authorization: `Bearer ${authToken}`,
  "Content-Type": "application/json",
};

const scenarios = {
  contest_polling: {
    executor: "constant-vus",
    vus: pollVus,
    duration,
    gracefulStop: "5s",
  },
};

if (submitEnabled) {
  scenarios.real_submission_once = {
    executor: "per-vu-iterations",
    vus: 1,
    iterations: 1,
    maxDuration: "35s",
    gracefulStop: "5s",
  };
}

export const options = {
  scenarios,
  thresholds: {
    http_req_failed: ["rate<0.05"],
  },
};

function get(path, expectedStatus = 200) {
  const response = http.get(`${baseUrl}${path}`, {
    headers,
    tags: { name: path.split("?")[0] },
  });
  check(response, {
    [`${path.split("?")[0]} returns ${expectedStatus}`]: (res) => res.status === expectedStatus,
  });
  return response;
}

export function contest_polling() {
  get(`/api/contests/${contestId}`);
  get(`/api/rankings?contestId=${contestId}`);
  get(`/api/submissions?contestId=${contestId}`);
  sleep(1);
}

export function real_submission_once() {
  const response = http.post(
    `${baseUrl}/api/submissions`,
    JSON.stringify({
      problemId,
      contestId,
      language: "python",
      code: sourceCode,
      mode: "submit",
    }),
    { headers, tags: { name: "/api/submissions POST" } },
  );
  const accepted = check(response, {
    "submission accepted (202)": (res) => res.status === 202,
  });
  if (!accepted) return;

  let submissionId;
  try {
    submissionId = response.json("id");
  } catch {
    return;
  }
  if (!Number.isSafeInteger(submissionId) || submissionId <= 0) return;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    sleep(5);
    const status = get(`/api/submissions/${submissionId}`);
    const verdict = status.json("status");
    if (verdict !== "pending" && verdict !== "judging") break;
  }
}
