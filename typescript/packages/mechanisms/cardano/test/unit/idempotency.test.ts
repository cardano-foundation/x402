import { describe, expect, it, vi } from "vitest";

import {
  InMemoryCardanoOperationStore,
  InMemoryCardanoSettlementStore,
  type CardanoOperationClaim,
  type CardanoStoredResponse,
} from "../../src/idempotency";

const operationClaim = (overrides: Partial<CardanoOperationClaim> = {}): CardanoOperationClaim => ({
  key: "transaction:abc",
  txHash: "abc",
  fingerprint: "request-a",
  requirementsFingerprint: "requirements-a",
  requireReplayChallenge: false,
  ownerToken: "owner-a",
  ...overrides,
});

const response = (body: unknown = { ok: true }): CardanoStoredResponse => ({
  status: 200,
  contentType: "application/json",
  headers: {},
  body,
  isRaw: false,
});

describe("Cardano idempotency stores", () => {
  it("claims atomically and binds a payment to one request fingerprint", async () => {
    const store = new InMemoryCardanoOperationStore();
    const [first, second] = await Promise.all([
      store.claim(operationClaim()),
      store.claim(operationClaim({ ownerToken: "owner-b" })),
    ]);

    expect([first.status, second.status].sort()).toEqual(["claimed", "in-progress"]);
    expect(
      await store.claim(operationClaim({ fingerprint: "request-b", ownerToken: "owner-c" })),
    ).toEqual({ status: "request-conflict" });
  });

  it("does not let another request complete or release a live claim", async () => {
    const store = new InMemoryCardanoOperationStore();
    await store.claim(operationClaim());

    expect(await store.complete("transaction:abc", "owner-b", response(), 10)).toBe("not-owner");
    await store.release("transaction:abc", "owner-b");
    expect(await store.claim(operationClaim({ ownerToken: "owner-c" }))).toEqual({
      status: "in-progress",
    });
  });

  it("fails closed when entry or response-byte limits are reached", async () => {
    const store = new InMemoryCardanoOperationStore({
      maxEntries: 1,
      maxResponseBytes: 4,
      maxTotalResponseBytes: 4,
    });
    await store.claim(operationClaim());

    expect(await store.complete("transaction:abc", "owner-a", response("large"), 5)).toBe(
      "response-too-large",
    );
    expect(await store.claim(operationClaim({ ownerToken: "owner-b" }))).toEqual({
      status: "completed-without-response",
    });
    expect(
      await store.claim(
        operationClaim({
          key: "transaction:def",
          txHash: "def",
          ownerToken: "owner-def",
        }),
      ),
    ).toEqual({ status: "capacity-exceeded" });
  });

  it("retains completed and ambiguous consumption tombstones", async () => {
    const store = new InMemoryCardanoOperationStore();
    await store.claim(operationClaim());
    await store.complete("transaction:abc", "owner-a", response(), 10);
    expect(await store.claim(operationClaim({ ownerToken: "owner-b" }))).toMatchObject({
      status: "completed",
    });

    await store.claim(
      operationClaim({ key: "transaction:def", txHash: "def", ownerToken: "owner-def" }),
    );
    expect(await store.markAmbiguous("transaction:def", "owner-def")).toBe("stored");
    await store.release("transaction:def", "owner-def");
    expect(
      await store.claim(
        operationClaim({ key: "transaction:def", txHash: "def", ownerToken: "owner-retry" }),
      ),
    ).toEqual({ status: "ambiguous" });
  });

  it("shares owner-safe settlement claims across facilitator instances", async () => {
    const store = new InMemoryCardanoSettlementStore(2);
    expect(
      await store.claimSettlement({
        txHash: "abc",
        mode: "server",
        ownerToken: "owner-a",
      }),
    ).toBe("fresh");
    expect(
      await store.claimSettlement({
        txHash: "abc",
        mode: "server",
        ownerToken: "owner-b",
      }),
    ).toBe("in-flight");

    expect(
      await store.claimSettlement({
        txHash: "abc",
        mode: "client",
        ownerToken: "owner-c",
      }),
    ).toBe("mode-conflict");
  });

  it("retains definitive submission rejections as terminal tombstones", async () => {
    const store = new InMemoryCardanoSettlementStore();
    await store.claimSettlement({ txHash: "abc", mode: "server", ownerToken: "owner-a" });
    await store.markRejected("abc", "owner-a");

    expect(
      await store.claimSettlement({ txHash: "abc", mode: "server", ownerToken: "owner-b" }),
    ).toBe("rejected");
  });

  it("keeps Masumi terms permanently bound to their first transaction", async () => {
    const store = new InMemoryCardanoSettlementStore();
    expect(
      await store.claimSettlement({
        txHash: "abc",
        mode: "server",
        ownerToken: "owner-a",
        termsDigest: "terms",
      }),
    ).toBe("fresh");
    expect(
      await store.claimSettlement({
        txHash: "def",
        mode: "server",
        ownerToken: "owner-b",
        termsDigest: "terms",
      }),
    ).toBe("terms-conflict");
    expect(
      await store.claimSettlement({
        txHash: "abc",
        mode: "server",
        ownerToken: "owner-c",
        termsDigest: "terms",
      }),
    ).toBe("in-flight");
  });

  it("claims Masumi terms and transaction atomically", async () => {
    const store = new InMemoryCardanoSettlementStore(1);
    expect(
      await store.claimSettlement({
        txHash: "abc",
        mode: "server",
        ownerToken: "owner-a",
        termsDigest: "terms",
      }),
    ).toBe("capacity-exceeded");
    expect(
      await store.claimSettlement({
        txHash: "def",
        mode: "server",
        ownerToken: "owner-b",
      }),
    ).toBe("fresh");
  });

  it("binds replay challenges to one request and requirement", async () => {
    const store = new InMemoryCardanoOperationStore();
    const issued = await store.issueChallenge({
      fingerprint: "request-a",
      requirementsFingerprint: "requirements-a",
      expiresAt: Date.now() + 60_000,
    });
    if (issued.status !== "issued") throw new Error("test challenge was not issued");

    expect(
      await store.validateChallenge(issued.challenge, {
        fingerprint: "request-a",
        requirementsFingerprint: "requirements-a",
      }),
    ).toBe(true);
    expect(
      await store.validateChallenge(issued.challenge, {
        fingerprint: "request-b",
        requirementsFingerprint: "requirements-a",
      }),
    ).toBe(false);

    expect(
      await store.claim(
        operationClaim({ replayChallenge: issued.challenge, requireReplayChallenge: true }),
      ),
    ).toEqual({ status: "claimed" });
    expect(
      await store.claim(
        operationClaim({
          ownerToken: "owner-b",
          replayChallenge: "b".repeat(64),
          requireReplayChallenge: true,
        }),
      ),
    ).toEqual({ status: "challenge-invalid" });
  });

  it("rejects missing, expired, or misbound replay challenges", async () => {
    const store = new InMemoryCardanoOperationStore();
    const issued = await store.issueChallenge({
      fingerprint: "request-a",
      requirementsFingerprint: "requirements-a",
      expiresAt: Date.now() + 60_000,
    });
    if (issued.status !== "issued") throw new Error("test challenge was not issued");

    expect(await store.claim(operationClaim({ requireReplayChallenge: true }))).toEqual({
      status: "challenge-invalid",
    });
    expect(
      await store.claim(
        operationClaim({
          key: "transaction:def",
          txHash: "def",
          fingerprint: "request-b",
          replayChallenge: issued.challenge,
          requireReplayChallenge: true,
        }),
      ),
    ).toEqual({ status: "challenge-invalid" });
  });

  it("rejects an unused challenge after its issuance lifetime", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
      const store = new InMemoryCardanoOperationStore();
      const issued = await store.issueChallenge({
        fingerprint: "request-a",
        requirementsFingerprint: "requirements-a",
        expiresAt: Date.now() + 1_000,
      });
      if (issued.status !== "issued") throw new Error("test challenge was not issued");
      vi.advanceTimersByTime(1_001);

      expect(
        await store.validateChallenge(issued.challenge, {
          fingerprint: "request-a",
          requirementsFingerprint: "requirements-a",
        }),
      ).toBe(false);
      expect(
        await store.claim(
          operationClaim({ replayChallenge: issued.challenge, requireReplayChallenge: true }),
        ),
      ).toEqual({ status: "challenge-invalid" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a consumed challenge valid for idempotent retries", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
      const store = new InMemoryCardanoOperationStore();
      const issued = await store.issueChallenge({
        fingerprint: "request-a",
        requirementsFingerprint: "requirements-a",
        expiresAt: Date.now() + 1_000,
      });
      if (issued.status !== "issued") throw new Error("test challenge was not issued");
      await store.claim(
        operationClaim({ replayChallenge: issued.challenge, requireReplayChallenge: true }),
      );
      vi.advanceTimersByTime(1_001);

      expect(
        await store.validateChallenge(issued.challenge, {
          fingerprint: "request-a",
          requirementsFingerprint: "requirements-a",
        }),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows one challenge to claim only one canonical operation", async () => {
    const store = new InMemoryCardanoOperationStore();
    const issued = await store.issueChallenge({
      fingerprint: "request-a",
      requirementsFingerprint: "requirements-a",
      expiresAt: Date.now() + 60_000,
    });
    if (issued.status !== "issued") throw new Error("test challenge was not issued");

    expect(
      await store.claim(
        operationClaim({ replayChallenge: issued.challenge, requireReplayChallenge: true }),
      ),
    ).toEqual({ status: "claimed" });
    expect(
      await store.claim(
        operationClaim({
          key: "transaction:def",
          txHash: "def",
          ownerToken: "owner-b",
          replayChallenge: issued.challenge,
          requireReplayChallenge: true,
        }),
      ),
    ).toEqual({ status: "challenge-invalid" });
  });
});
