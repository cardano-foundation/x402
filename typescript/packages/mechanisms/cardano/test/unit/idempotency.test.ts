import { describe, expect, it } from "vitest";

import {
  InMemoryCardanoOperationStore,
  InMemoryCardanoSettlementStore,
  type CardanoOperationClaim,
  type CardanoStoredResponse,
} from "../../src/idempotency";

const future = (): number => Date.now() + 60_000;

const operationClaim = (overrides: Partial<CardanoOperationClaim> = {}): CardanoOperationClaim => ({
  key: "transaction:abc",
  txHash: "abc",
  fingerprint: "request-a",
  ownerToken: "owner-a",
  expiresAt: future(),
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

  it("shares owner-safe settlement claims across facilitator instances", async () => {
    const store = new InMemoryCardanoSettlementStore(2);
    expect(
      await store.claimSubmission({
        txHash: "abc",
        mode: "server",
        ownerToken: "owner-a",
        expiresAt: future(),
      }),
    ).toBe("fresh");
    expect(
      await store.claimSubmission({
        txHash: "abc",
        mode: "server",
        ownerToken: "owner-b",
        expiresAt: future(),
      }),
    ).toBe("in-flight");

    await store.releaseSubmission("abc", "owner-b");
    expect(
      await store.claimSubmission({
        txHash: "abc",
        mode: "client",
        ownerToken: "owner-c",
        expiresAt: future(),
      }),
    ).toBe("mode-conflict");
  });
});
