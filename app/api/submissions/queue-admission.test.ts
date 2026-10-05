import assert from "node:assert/strict";
import { test } from "node:test";
import { getQueueAdmissionDenial } from "./queue-admission.ts";

test("admission allows work only while all active queue caps remain satisfied", () => {
  assert.equal(getQueueAdmissionDenial({ globalActive: 499, organizationActive: 99, userActive: 2 }, 1), null);
  assert.deepEqual(getQueueAdmissionDenial({ globalActive: 499, organizationActive: 100, userActive: 0 }, 1), {
    scope: "organization",
    status: 429,
    retryAfter: 60,
  });
  assert.deepEqual(getQueueAdmissionDenial({ globalActive: 500, organizationActive: 1, userActive: 0 }, 1), {
    scope: "global",
    status: 503,
    retryAfter: 30,
  });
  assert.deepEqual(getQueueAdmissionDenial({ globalActive: 3, organizationActive: 3, userActive: 3 }, 1), {
    scope: "user",
    status: 429,
    retryAfter: 60,
  });
});

test("batch admission is all-or-nothing and may omit the submission user cap", () => {
  assert.deepEqual(getQueueAdmissionDenial({ globalActive: 498, organizationActive: 98, userActive: 0 }, 3, false), {
    scope: "global",
    status: 503,
    retryAfter: 30,
  });
  assert.equal(getQueueAdmissionDenial({ globalActive: 497, organizationActive: 97, userActive: 0 }, 3, false), null);
});
