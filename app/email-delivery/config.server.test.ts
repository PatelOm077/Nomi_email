import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getEmailDeliveryConfig,
  isEmailDeliveryConfigured,
} from "./config.server";

function setConfiguredEnvironment() {
  vi.stubEnv("RESEND_API_KEY", "resend-key");
  vi.stubEnv("NOMI_FROM_EMAIL", "mail@example.com");
  vi.stubEnv("NOMI_FROM_NAME", "Paper Boat");
  vi.stubEnv("EMAIL_JOB_SECRET", "worker-secret");
}

describe("email delivery configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["RESEND_API_KEY", "NOMI_FROM_EMAIL"] as const)(
    "rejects a missing %s when reading provider configuration",
    (name) => {
      setConfiguredEnvironment();
      vi.stubEnv(name, "");

      expect(() => getEmailDeliveryConfig()).toThrow(
        "Email delivery is not configured. Set RESEND_API_KEY and NOMI_FROM_EMAIL.",
      );
    },
  );

  it("uses Nomi when the optional sender name is absent or whitespace", () => {
    setConfiguredEnvironment();
    vi.stubEnv("NOMI_FROM_NAME", "   ");

    expect(getEmailDeliveryConfig()).toEqual({
      apiKey: "resend-key",
      fromEmail: "mail@example.com",
      fromName: "Nomi",
    });
  });

  it("trims a configured sender name", () => {
    setConfiguredEnvironment();
    vi.stubEnv("NOMI_FROM_NAME", "  Paper Boat  ");

    expect(getEmailDeliveryConfig().fromName).toBe("Paper Boat");
  });

  it.each(["RESEND_API_KEY", "NOMI_FROM_EMAIL", "EMAIL_JOB_SECRET"] as const)(
    "reports unconfigured when %s is absent",
    (name) => {
      setConfiguredEnvironment();
      vi.stubEnv(name, "");

      expect(isEmailDeliveryConfigured()).toBe(false);
    },
  );

  it("reports configured only when provider and worker values are present", () => {
    setConfiguredEnvironment();

    expect(isEmailDeliveryConfigured()).toBe(true);
  });
});
