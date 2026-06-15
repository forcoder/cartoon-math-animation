/**
 * POST /api/render — Generate Three.js code for a math problem.
 *
 * Pipeline (per eng review 2026-06-14 + 2026-06-15 步骤/讲解 feature):
 *   1. Validate request body (zod-style manual checks; no zod dep needed here).
 *   2. Validate invite code against ALLOWED_INVITE_CODES.
 *   3. SHA-256 hash the problem text.
 *   4. Look up Upstash cache → on hit, return cached result immediately.
 *   5. Call LLM via lib/llm-prompt.ts (with 1 retry via lib/llm-retry.ts).
 *   6. Parse the LLM response with lib/parse-llm-response.ts — it must
 *      tolerate prose, fences, and bare code so a misbehaving model
 *      never crashes the route.
 *   7. Cache the parsed result under the problem hash.
 *   8. Return { code, steps, lines, latency, fromCache }.
 *
 * Failure modes:
 *   - 400: malformed body / empty problem
 *   - 401: invite code rejected
 *   - 500: LLM failed after retries (error.retryable reflects whether the
 *     client should show "再试一次" — false for parse / 4xx, true for 5xx)
 *   - 502: LLM returned unusable output (no code at all, even after
 *     tolerant parsing)
 *
 * Latency budget: cache hit <2s, miss ≤60s end-to-end. We measure latency
 * from request entry → response ready, not just the LLM call. This catches
 * any slow path in cache or validation that would otherwise be invisible.
 *
 * NOTE: This route runs on Node.js runtime (Vercel default). Edge runtime
 * would be tempting for lower TTFB but Upstash + LLM client both work fine
 * on Node and we avoid the Web Streams / fetch-shape gymnastics.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getLLMClient, resolveModel, DEFAULT_TEMPERATURE } from "@/lib/llm-client";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/llm-prompt";
import { withRetry } from "@/lib/llm-retry";
import { validateInviteCode } from "@/lib/invite";
import { getCachedResult, setCachedResult } from "@/lib/cache";
import { parseLlmResponse } from "@/lib/parse-llm-response";
import type {
  ErrorResponse,
  RenderRequest,
  RenderResponse,
} from "@/lib/types";

// Force Node.js runtime (default, but explicit avoids accidental Edge).
export const runtime = "nodejs";
// Never cache this route — every request may produce different code.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();

  // ---------- 1. Parse + validate body ----------
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "请求格式不对，需要 JSON body", false);
  }

  const parsed = parseRenderRequest(body);
  if (!parsed.ok) {
    return jsonError(400, parsed.error, false);
  }
  const { problem, inviteCode } = parsed.value;

  // ---------- 2. Invite code gate ----------
  if (!validateInviteCode(inviteCode)) {
    return jsonError(401, "邀请码无效", false);
  }

  // ---------- 3. Hash the problem ----------
  const problemHash = sha256(problem);

  // ---------- 4. Cache lookup ----------
  const cached = await getCachedResult(problemHash);
  if (cached !== null) {
    return NextResponse.json<RenderResponse>({
      code: cached.code,
      steps: cached.steps,
      lines: cached.lines,
      latency: Date.now() - startedAt,
      fromCache: true,
    });
  }

  // ---------- 5. LLM call (with retry) ----------
  let rawLlm: string;
  try {
    rawLlm = await withRetry(() => callLlm(problem));
  } catch (err) {
    const retryable = isUpstreamRetryable(err);
    const message = retryable
      ? "AI 生成失败，请再试一次"
      : "AI 生成的内容无法使用，请修改题目或稍后再试";
    // Log full err server-side; only show a friendly message to the client.
    console.error("[render] LLM failed:", err);
    return jsonError(500, message, retryable);
  }

  // ---------- 6. Parse the LLM response (tolerant) ----------
  const result = parseLlmResponse(rawLlm);

  if (!result.code || !looksLikeThreeJsModule(result.code)) {
    console.error(
      "[render] LLM returned non-code output:",
      rawLlm.slice(0, 200),
    );
    return jsonError(
      502,
      "AI 没生成出可用的代码，请修改题目或稍后再试",
      false,
    );
  }

  // ---------- 7. Cache the result (fire-and-forget on failure) ----------
  await setCachedResult(problemHash, {
    code: result.code,
    steps: result.steps,
    lines: result.lines,
  });

  // ---------- 8. Respond ----------
  return NextResponse.json<RenderResponse>({
    code: result.code,
    steps: result.steps,
    lines: result.lines,
    latency: Date.now() - startedAt,
    fromCache: false,
  });
}

// =========================================================================
// Helpers
// =========================================================================

function jsonError(status: number, error: string, retryable: boolean): NextResponse<ErrorResponse> {
  return NextResponse.json<ErrorResponse>({ error, retryable }, { status });
}

type ParseResult =
  | { ok: true; value: RenderRequest }
  | { ok: false; error: string };

function parseRenderRequest(body: unknown): ParseResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "请求体为空" };
  }
  const obj = body as Record<string, unknown>;

  if (typeof obj.problem !== "string" || obj.problem.trim().length === 0) {
    return { ok: false, error: "题目不能为空" };
  }
  if (obj.problem.length > 2000) {
    return { ok: false, error: "题目太长（最多 2000 字）" };
  }

  if (typeof obj.inviteCode !== "string" || obj.inviteCode.trim().length === 0) {
    return { ok: false, error: "邀请码不能为空" };
  }

  return {
    ok: true,
    value: {
      problem: obj.problem.trim(),
      inviteCode: obj.inviteCode.trim(),
    },
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function callLlm(problem: string): Promise<string> {
  const client = getLLMClient();

  const completion = await client.chat.completions.create({
    model: resolveModel(),
    temperature: DEFAULT_TEMPERATURE,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(problem) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("LLM returned empty content");
  }
  return raw;
}

/**
 * Sanity check that the LLM actually produced code, not an apology or a
 * markdown-wrapped explanation. We accept the module if it contains the
 * required export signature somewhere in the response — the Sandbox agent
 * will do stricter validation at execution time.
 */
function looksLikeThreeJsModule(text: string): boolean {
  return /export\s+default\s+function\s*\(/.test(text);
}

function isUpstreamRetryable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { status?: number; type?: string };
  if (typeof anyErr.status === "number") {
    return anyErr.status >= 500 && anyErr.status < 600;
  }
  if (
    anyErr.type === "rate_limit_error" ||
    anyErr.type === "server_error" ||
    anyErr.type === "timeout"
  ) {
    return true;
  }
  // Our own thrown Error from callLlm (empty content) — non-retryable.
  return false;
}