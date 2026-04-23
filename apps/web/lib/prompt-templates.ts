/**
 * Guided prompt templates.
 *
 * Each template is a carefully crafted prompt that already encodes the
 * best-practice constraints our agents handle well (stack choices, auth
 * model, data modelling hints, non-functional concerns). They exist to:
 *
 *   1. Raise generation quality by front-loading the constraints the
 *      agents would otherwise have to guess.
 *   2. Reduce user confusion — a blank textarea is scary, a structured
 *      starting point is not.
 *
 * Do NOT treat these as immutable. They are seeds: the user picks one,
 * the prompt pre-fills the textarea, and they edit from there.
 */

import type { LucideIcon } from 'lucide-react';
import { Gauge, ShoppingBag, LayoutDashboard, Users } from 'lucide-react';

export type TemplateId = 'saas-app' | 'marketplace' | 'dashboard' | 'social-app';

export interface PromptTemplate {
  id: TemplateId;
  label: string;
  tagline: string;
  icon: LucideIcon;
  /** Tailwind-friendly accent color (hex) for the card. */
  accent: string;
  /** Short description shown on the card. */
  description: string;
  /** Bullet-point best practices bundled with this template. */
  bestPractices: string[];
  /** Pre-filled prompt text. */
  prompt: string;
}

// ─── SaaS App ───────────────────────────────────────────────────────────────
const SAAS_PROMPT = `Build a production-ready SaaS web application.

Product:
- A [describe the core product — replace this line] that serves small teams.
- Users sign up with email + password, then invite teammates by email.

Stack:
- Next.js 15 (App Router) + React 18 + TypeScript on the frontend.
- Fastify + TypeScript on the backend (JSON REST).
- PostgreSQL via Prisma for the primary store.
- Tailwind CSS + shadcn/ui primitives for the UI.

Must have:
- Email/password auth with bcrypt + short-lived JWTs and refresh tokens stored in httpOnly cookies.
- Multi-tenant data model: every table has a tenant_id, every query is tenant-scoped.
- Role-based access control: owner / admin / member.
- Stripe-ready billing skeleton (plans table, subscription status field, webhook route stub).
- Settings screen: profile, team, billing, API keys.
- Basic audit log of sensitive actions.

Non-functional:
- Input validation with zod on every route.
- Centralised error handler with typed AppError + statusCode mapping.
- Rate limiting on auth endpoints.
- Structured JSON logging.
- Seed script that creates a demo tenant with one owner and two members.`;

// ─── Marketplace ────────────────────────────────────────────────────────────
const MARKETPLACE_PROMPT = `Build a two-sided online marketplace web app.

Roles:
- Buyers browse listings, add to cart, and check out.
- Sellers create listings, manage inventory, and view orders.

Stack:
- Next.js 15 (App Router) + React 18 + TypeScript.
- Fastify + TypeScript API.
- PostgreSQL via Prisma.
- Tailwind CSS + shadcn/ui primitives.

Core features:
- Listing CRUD (title, description, price, category, stock, images).
- Search and category filtering with server-side pagination.
- Shopping cart stored per-user (DB, not localStorage).
- Checkout flow with a Stripe test-mode integration; on success, write an order with line items.
- Order history for buyers, sales dashboard for sellers.
- Ratings + reviews per listing with one-review-per-order enforcement.

Non-functional:
- Image uploads go through a signed-URL stub; store the URL on the listing row.
- zod input validation on every route.
- Authorization: sellers can only edit their own listings.
- Seed data: 3 sellers, 12 listings across 4 categories, 2 buyers with historical orders.
- Clean separation between "public catalog" routes and "authenticated seller" routes.`;

// ─── Dashboard ──────────────────────────────────────────────────────────────
const DASHBOARD_PROMPT = `Build an internal analytics dashboard web app.

Purpose:
- Visualise operational metrics for a [replace: which domain? e.g. SaaS product, logistics fleet, support queue] at a glance.

Stack:
- Next.js 15 (App Router) + React 18 + TypeScript.
- Fastify + TypeScript API.
- PostgreSQL via Prisma.
- Tailwind CSS + shadcn/ui + a chart library (Recharts).

Screens:
- Overview: 4-6 KPI stat cards with delta vs. previous period, a headline time-series chart, and a recent-events list.
- Breakdown: a table with sortable columns, column filters, and CSV export.
- Settings: date range selector, saved views.

Data plumbing:
- API endpoints that accept { from, to, granularity: 'day' | 'week' | 'month' } and return pre-aggregated buckets.
- Server-side aggregation — the frontend should never SUM raw rows.
- Caching layer (in-memory LRU is fine) keyed by query params; 60s TTL.

Non-functional:
- Strict TypeScript and zod-validated responses end-to-end.
- Empty states, loading skeletons, and error banners on every data view.
- Accessibility: keyboard-navigable tables, ARIA labels on interactive controls.
- Seed script produces ~90 days of synthetic but realistic data.`;

// ─── Social App ─────────────────────────────────────────────────────────────
const SOCIAL_PROMPT = `Build a small social web app (Twitter-lite style).

Users can:
- Sign up with email + password and pick a handle.
- Post short text updates (≤ 280 chars) with optional one image.
- Follow and unfollow other users.
- See a timeline of posts from accounts they follow (reverse chronological).
- Like and reply to posts.

Stack:
- Next.js 15 (App Router) + React 18 + TypeScript.
- Fastify + TypeScript API.
- PostgreSQL via Prisma.
- Tailwind CSS + shadcn/ui primitives.

Data model hints:
- users, posts, follows (follower_id, following_id), likes, replies (parent_post_id).
- Timeline query: posts WHERE author_id IN (followed ids) OR author_id = me, ORDER BY created_at DESC, LIMIT 30, cursor paginated.

Non-functional:
- Cursor-based pagination for all feeds (never OFFSET on big tables).
- Optimistic UI for like / follow.
- zod input validation on every route; reject posts > 280 chars server-side too.
- Rate limit posting to 5 per minute per user.
- Block self-follow at the API layer.
- Seed: 6 accounts with a web of follows and ~40 posts across the last 7 days.`;

// ─── Registry ───────────────────────────────────────────────────────────────
export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'saas-app',
    label: 'SaaS App',
    tagline: 'Multi-tenant, auth, billing, team roles.',
    icon: Gauge,
    accent: '#6366F1',
    description: 'A complete SaaS starter: auth, teams, roles, billing hooks, and the safety rails that matter on day one.',
    bestPractices: [
      'Multi-tenant schema — tenant_id everywhere',
      'JWT + refresh in httpOnly cookies',
      'Role-based access (owner/admin/member)',
      'Stripe-ready billing skeleton',
      'zod input validation on every route',
    ],
    prompt: SAAS_PROMPT,
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    tagline: 'Two-sided: buyers, sellers, listings, orders.',
    icon: ShoppingBag,
    accent: '#EC4899',
    description: 'Sellers list, buyers check out, Stripe processes the money, and each role only sees what they should.',
    bestPractices: [
      'Listing CRUD with image uploads',
      'Cart + checkout + Stripe test mode',
      'Seller-scoped authorization',
      'Reviews gated behind a real purchase',
      'Server-side search & pagination',
    ],
    prompt: MARKETPLACE_PROMPT,
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    tagline: 'KPIs, charts, tables, CSV export.',
    icon: LayoutDashboard,
    accent: '#14B8A6',
    description: 'An internal analytics surface with KPI cards, time-series, filterable tables, and real empty/loading states.',
    bestPractices: [
      'Server-side aggregation (never client SUM)',
      'Cached query endpoints with TTL',
      'Date-range + granularity parameters',
      'Loading skeletons & empty states',
      'Accessible, keyboard-navigable tables',
    ],
    prompt: DASHBOARD_PROMPT,
  },
  {
    id: 'social-app',
    label: 'Social App',
    tagline: 'Posts, follows, timeline, likes, replies.',
    icon: Users,
    accent: '#F59E0B',
    description: 'A Twitter-lite social app with a followers graph, cursor-paginated timeline, and rate-limited posting.',
    bestPractices: [
      'Cursor pagination (never OFFSET on big tables)',
      'Optimistic UI for like / follow',
      'Server-side 280-char enforcement',
      'Rate limit: 5 posts/minute/user',
      'Block self-follow at the API layer',
    ],
    prompt: SOCIAL_PROMPT,
  },
];
