/**
 * Extended Types Unit Tests
 *
 * Tests for configuration schema validation
 */

import { describe, expect, test } from "bun:test";

import { ExtendedConfigSchema } from "../src/extended/types";

describe("ExtendedConfigSchema", () => {
  describe("valid configurations", () => {
    test("should accept valid testnet configuration", () => {
      const config = {
        network: "testnet",
        vaultId: 12345,
        starkPrivateKey: "0x1234567890abcdef",
        starkPublicKey: "0xabcdef1234567890",
        apiKey: "test-api-key",
      };

      const result = ExtendedConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.network).toBe("testnet");
        expect(result.data.vaultId).toBe(12345);
      }
    });

    test("should accept valid mainnet configuration", () => {
      const config = {
        network: "mainnet",
        vaultId: 67890,
        starkPrivateKey: "0xaabbccdd",
        starkPublicKey: "0xddeeff00",
        apiKey: "prod-api-key",
      };

      const result = ExtendedConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.network).toBe("mainnet");
      }
    });

    test("should default to testnet when network is not specified", () => {
      const config = {
        vaultId: 12345,
        starkPrivateKey: "0x1234",
        starkPublicKey: "0x5678",
        apiKey: "api-key",
      };

      const result = ExtendedConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.network).toBe("testnet");
      }
    });

    test("should coerce string vaultId to number", () => {
      const config = {
        network: "testnet",
        vaultId: "12345",
        starkPrivateKey: "0x1234",
        starkPublicKey: "0x5678",
        apiKey: "api-key",
      };

      const result = ExtendedConfigSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.vaultId).toBe(12345);
        expect(typeof result.data.vaultId).toBe("number");
      }
    });
  });

  describe("invalid configurations", () => {
    test("should reject invalid network", () => {
      const config = {
        network: "invalid",
        vaultId: 12345,
        starkPrivateKey: "0x1234",
        starkPublicKey: "0x5678",
        apiKey: "api-key",
      };

      const result = ExtendedConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    test("should reject missing vaultId", () => {
      const config = {
        network: "testnet",
        starkPrivateKey: "0x1234",
        starkPublicKey: "0x5678",
        apiKey: "api-key",
      };

      const result = ExtendedConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    test("should reject invalid starkPrivateKey format (missing 0x prefix)", () => {
      const config = {
        network: "testnet",
        vaultId: 12345,
        starkPrivateKey: "1234567890abcdef",
        starkPublicKey: "0xabcdef1234567890",
        apiKey: "api-key",
      };

      const result = ExtendedConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    test("should reject invalid starkPublicKey format (missing 0x prefix)", () => {
      const config = {
        network: "testnet",
        vaultId: 12345,
        starkPrivateKey: "0x1234567890abcdef",
        starkPublicKey: "abcdef1234567890",
        apiKey: "api-key",
      };

      const result = ExtendedConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    test("should reject empty apiKey", () => {
      const config = {
        network: "testnet",
        vaultId: 12345,
        starkPrivateKey: "0x1234",
        starkPublicKey: "0x5678",
        apiKey: "",
      };

      const result = ExtendedConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });

    test("should reject missing apiKey", () => {
      const config = {
        network: "testnet",
        vaultId: 12345,
        starkPrivateKey: "0x1234",
        starkPublicKey: "0x5678",
      };

      const result = ExtendedConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
    });
  });
});
