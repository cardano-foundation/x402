import { describe, expect, it } from "vitest";
import type {
  CardanoExtraDefault,
  CardanoExtraMasumi,
  CardanoExtraScript,
  ExactCardanoPayload,
} from "../../src/types";

describe("Cardano Types", () => {
  it("accepts a default extra", () => {
    const extra: CardanoExtraDefault = {};
    expect(extra).toBeDefined();
  });

  it("accepts a Masumi extra with all required fields", () => {
    const extra: CardanoExtraMasumi = {
      assetTransferMethod: "masumi",
      identifierFromPurchaser: "aabbaabb11221122aabb",
      sellerVkey: "deadbeef",
      paymentType: "Web3CardanoV1",
      blockchainIdentifier: "blockchain_identifier",
      payByTime: "1713626260",
      submitResultTime: "1713636260",
      unlockTime: "1713636260",
      externalDisputeUnlockTime: "1713636260",
      agentIdentifier: "agent_identifier",
      inputHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    };
    expect(extra.assetTransferMethod).toBe("masumi");
  });

  it("accepts a Script extra with parameters", () => {
    const extra: CardanoExtraScript = {
      assetTransferMethod: "script",
      scriptHash: "abc",
      script: { type: "plutusV3", code: "deadbeef" },
      parameters: { greeting: { type: "bytes", value: "Hello" } },
    };
    expect(extra.assetTransferMethod).toBe("script");
    expect(extra.parameters?.greeting.value).toBe("Hello");
  });

  it("accepts a payload with transaction and nonce", () => {
    const payload: ExactCardanoPayload = {
      transaction: "AAA=",
      nonce: `${"a".repeat(64)}#0`,
    };
    expect(payload.transaction).toBe("AAA=");
    expect(payload.nonce.endsWith("#0")).toBe(true);
  });
});
