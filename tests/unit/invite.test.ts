/**
 * Tests for the invite code allow-list. Per test plan: invite code validation
 * is P0 because every API request depends on it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateInviteCode, getAllowedInviteCount } from "@/lib/invite";

describe("validateInviteCode", () => {
  const ORIGINAL_ENV = process.env.ALLOWED_INVITE_CODES;

  beforeEach(() => {
    delete process.env.ALLOWED_INVITE_CODES;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.ALLOWED_INVITE_CODES;
    } else {
      process.env.ALLOWED_INVITE_CODES = ORIGINAL_ENV;
    }
  });

  describe("fail-closed when env is missing", () => {
    it("rejects any code when ALLOWED_INVITE_CODES is unset", () => {
      expect(validateInviteCode("founder")).toBe(false);
    });

    it("rejects any code when ALLOWED_INVITE_CODES is empty string", () => {
      process.env.ALLOWED_INVITE_CODES = "";
      expect(validateInviteCode("founder")).toBe(false);
    });
  });

  describe("valid input cases", () => {
    beforeEach(() => {
      process.env.ALLOWED_INVITE_CODES = "founder,friend1,friend2";
    });

    it("accepts a code that exactly matches an entry", () => {
      expect(validateInviteCode("founder")).toBe(true);
      expect(validateInviteCode("friend1")).toBe(true);
    });

    it("trims whitespace from the input", () => {
      expect(validateInviteCode("  founder  ")).toBe(true);
    });

    it("treats entries as case-sensitive", () => {
      expect(validateInviteCode("FOUNDER")).toBe(false);
    });
  });

  describe("invalid input cases", () => {
    beforeEach(() => {
      process.env.ALLOWED_INVITE_CODES = "founder,friend1,friend2";
    });

    it("rejects an unknown code", () => {
      expect(validateInviteCode("attacker")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(validateInviteCode("")).toBe(false);
    });

    it("rejects whitespace-only input even if it would trim to empty", () => {
      expect(validateInviteCode("   ")).toBe(false);
    });
  });

  describe("env parsing edge cases", () => {
    it("tolerates accidental spaces around commas in env value", () => {
      process.env.ALLOWED_INVITE_CODES = "  abc , def ,  ghi  ";
      expect(validateInviteCode("abc")).toBe(true);
      expect(validateInviteCode("def")).toBe(true);
      expect(validateInviteCode("ghi")).toBe(true);
    });

    it("ignores empty entries from double commas", () => {
      process.env.ALLOWED_INVITE_CODES = "abc,,def";
      expect(validateInviteCode("abc")).toBe(true);
      expect(validateInviteCode("def")).toBe(true);
      expect(getAllowedInviteCount()).toBe(2);
    });
  });
});

describe("getAllowedInviteCount", () => {
  const ORIGINAL_ENV = process.env.ALLOWED_INVITE_CODES;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.ALLOWED_INVITE_CODES;
    } else {
      process.env.ALLOWED_INVITE_CODES = ORIGINAL_ENV;
    }
  });

  it("returns 0 when env is unset", () => {
    delete process.env.ALLOWED_INVITE_CODES;
    expect(getAllowedInviteCount()).toBe(0);
  });

  it("returns the count of unique trimmed entries", () => {
    process.env.ALLOWED_INVITE_CODES = "a,b,c";
    expect(getAllowedInviteCount()).toBe(3);
  });
});