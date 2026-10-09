export const QUEUE_ADMISSION_LIMITS = {
  global: 500,
  organization: 100,
  user: 3,
  submissionRetryAfter: 60,
  globalRetryAfter: 30,
} as const;

export type QueueAdmissionCounts = {
  globalActive: number;
  organizationActive: number;
  userActive: number;
};

export type QueueAdmissionDenial = {
  scope: "global" | "organization" | "user";
  status: 429 | 503;
  retryAfter: number;
};

export function getQueueAdmissionDenial(
  counts: QueueAdmissionCounts,
  requested: number,
  includeUserLimit = true,
): QueueAdmissionDenial | null {
  if (counts.globalActive + requested > QUEUE_ADMISSION_LIMITS.global) {
    return {
      scope: "global",
      status: 503,
      retryAfter: QUEUE_ADMISSION_LIMITS.globalRetryAfter,
    };
  }
  if (counts.organizationActive + requested > QUEUE_ADMISSION_LIMITS.organization) {
    return {
      scope: "organization",
      status: 429,
      retryAfter: QUEUE_ADMISSION_LIMITS.submissionRetryAfter,
    };
  }
  if (includeUserLimit && counts.userActive + requested > QUEUE_ADMISSION_LIMITS.user) {
    return {
      scope: "user",
      status: 429,
      retryAfter: QUEUE_ADMISSION_LIMITS.submissionRetryAfter,
    };
  }
  return null;
}
