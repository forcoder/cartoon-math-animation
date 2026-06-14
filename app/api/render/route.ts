/**
 * POST /api/render — Generate Three.js code for a math problem.
 *
 * Pipeline (per eng review 2026-06-14):
 *   1. Validate request body (zod-style manual checks; no zod dep needed here).
 *   2. Validate invite code against ALLOWED_INVITE_CODES.
 *   3. SHA-256 hash the problem text.
 *   4. Look up Upstash cache → on hit, return cached code immediately.
 *   5. Call LLM via lib/llm-prompt.ts (with 1 retry via lib/llm-retry.ts).
 *   6. Cache the LLM response under the problem hash.
 *   7. Return { code, latency, fromCache }.
 *
 * Failure modes:
 *   - 400: malformed body / empty problem
 *   - 401: invite code rejected
 *   - 500: LLM failed after retries (error.retryable reflects whether the
 *     client should show "再试一次" — false for parse / 4xx, true for 5xx)
 *   - 502: LLM returned unusable output (non-retryable — retrying won't help)
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
import { getCachedCode, setCachedCode } from "@/lib/cache";
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
  const cached = await getCachedCode(problemHash);
  if (cached !== null) {
    return NextResponse.json<RenderResponse>({
      code: cached,
      latency: Date.now() - startedAt,
      fromCache: true,
    });
  }

  // ---------- 5. LLM call (with retry) ----------
  let generatedCode: string;
  try {
    generatedCode = await withRetry(() => callLlm(problem));
  } catch (err) {
    const retryable = isUpstreamRetryable(err);
    const message = retryable
      ? "AI 生成失败，请再试一次"
      : "AI 生成的内容无法使用，请修改题目或稍后再试";
    // Log full err server-side; only show a friendly message to the client.
    console.error("[render] LLM failed:", err);
    return jsonError(500, message, retryable);
  }

  // Defensive: if the LLM didn't return parseable code, surface a clear error.
  if (!looksLikeThreeJsModule(generatedCode)) {
    console.error("[render] LLM returned non-code output:", generatedCode.slice(0, 200));
    return jsonError(
      502,
      "AI 没生成出可用的代码，请修改题目或稍后再试",
      false,
    );
  }

  // ---------- 6. Cache the result (fire-and-forget on failure) ----------
  await setCachedCode(problemHash, generatedCode);

  // ---------- 7. Respond ----------
  return NextResponse.json<RenderResponse>({
    code: generatedCode,
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
  return stripMarkdownFences(raw);
}

/**
 * LLMs occasionally wrap code in ```js ... ``` fences even when told not to.
 * Strip them so downstream consumers (cache, sandbox) see clean JS.
 */
function stripMarkdownFences(text: string): string {
  // Match a leading ```lang?\n ... ``` block. If the entire response is a
  // single fenced block, return its inner content. Otherwise return as-is.
  const fenced = text.match(/^```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenced) return fenced[1].trim();
  return text.trim();
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