import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "../routes/tasks.email-jobs";

const processPendingEmailJobs = vi.hoisted(() => vi.fn());

vi.mock("./process-jobs.server", () => ({ processPendingEmailJobs }));

function workerRequest(authorization?: string) {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  return new Request("https://nomi.example.com/tasks/email-jobs", {
    method: "POST",
    headers,
  });
}

describe("tasks.email-jobs action", () => {
  beforeEach(() => {
    processPendingEmailJobs.mockReset();
    vi.stubEnv("EMAIL_JOB_SECRET", "correct-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a request when the worker secret is not configured", async () => {
    vi.stubEnv("EMAIL_JOB_SECRET", "");

    const response = await action({
      request: workerRequest("Bearer correct-secret"),
    } as never);

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
    expect(processPendingEmailJobs).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing header", undefined],
    ["the wrong scheme", "Basic correct-secret"],
    ["the wrong secret", "Bearer incorrect-value"],
    ["a shorter secret", "Bearer wrong"],
  ])("rejects %s", async (_label, authorization) => {
    const response = await action({
      request: workerRequest(authorization),
    } as never);

    expect(response.status).toBe(401);
    expect(processPendingEmailJobs).not.toHaveBeenCalled();
  });

  it("runs the worker and returns its counters for a valid secret", async () => {
    processPendingEmailJobs.mockResolvedValue({
      sent: 2,
      skipped: 1,
      retried: 0,
      failed: 0,
    });

    const response = await action({
      request: workerRequest("Bearer correct-secret"),
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sent: 2,
      skipped: 1,
      retried: 0,
      failed: 0,
    });
    expect(processPendingEmailJobs).toHaveBeenCalledOnce();
  });
});
