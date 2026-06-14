# AI 数学动画 MVP

把数学题变成 3D 动画，帮小学生看明白抽象题。

> 输入一道题 → 10-30 秒后看到 Three.js 动画讲解

## 核心流程

1. 用户在输入框里手打题目
2. 后端调用 LLM（默认 **LongCat-2.0-Preview**）生成 Three.js 代码
3. 前端在 Web Worker 中安全执行，超时/失败则重试
4. Canvas 渲染 2.5D 动画，支持视角预设 + 时间轴分步控制

## 技术栈

- **前端**：Next.js 14 + TypeScript + Tailwind
- **3D 渲染**：Three.js（浏览器端，零服务器渲染成本）
- **LLM**：OpenAI 兼容 API（默认 LongCat，可换豆包/Qwen/GLM/DeepSeek）
- **缓存**：Upstash KV（同题缓存）
- **沙箱**：Web Worker + 10s 超时 + 帧预算
- **测试**：Vitest + Playwright + 自定义 LLM eval 框架
- **部署**：Vercel

## 本地启动

```bash
# 1. 安装依赖
npm install

# 2. 复制环境变量并填入 key
cp .env.example .env.local

# 3. 启动开发服务器
npm run dev
```

打开 http://localhost:3000 即可。

## 常用命令

```bash
npm run dev        # 开发模式
npm run build      # 生产构建
npm run start      # 启动生产服务
npm run lint       # ESLint
npm test           # 单元测试（Vitest）
npm run test:e2e   # E2E 测试（Playwright）
```

## 目录结构

```
app/                  Next.js App Router（页面、API route）
components/           React 组件
lib/                  业务逻辑（invite、llm-prompt、llm-retry、worker-bridge、cache、eval-rubric）
public/               静态资源
styles/               全局样式 + tokens
tests/
  unit/               Vitest 单元测试
  e2e/                Playwright E2E
docs/
  eval/               LLM eval 框架（P2 验证）
```

## Vercel 部署提示

1. 把仓库推到 GitHub
2. Vercel 里点 Import Project，选择仓库
3. **Environment Variables** 填入：
   - `LLM_BASE_URL` — LongCat 平台 baseURL（默认 `https://api.longcat.chat/v1`）
   - `LLM_API_KEY` — LongCat 平台 API key
   - `LLM_MODEL` — 模型名（默认 `LongCat-2.0-Preview`）
4. 直接 Deploy。Next.js 14 App Router 零配置。

> 重要：`UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN` 必须配 Vercel KV 或 Upstash Cloud，
> 否则缓存层走 mock。`ALLOWED_INVITE_CODES` 控制 MVP 内测名单。

## 项目状态

MVP 脚手架阶段。Eng review 已 CLEARED，详细设计见 `~/.gstack/projects/cartoon/13880-unknown-design-20260614-124814.md`。