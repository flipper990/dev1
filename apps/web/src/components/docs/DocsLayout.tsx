import Link from 'next/link';
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Badge } from '../../../components/ui';
import { cn } from '../../../lib/cn';
import { MarketingShell } from '../marketing';
import { docsArticles, docsNavigation, getRelatedArticles, type DocsArticle } from './docsContent';

interface DocsLayoutProps {
  article?: DocsArticle;
  children: ReactNode;
}

export function DocsLayout({ article, children }: DocsLayoutProps) {
  const toc = article?.sections ?? [];

  return (
    <MarketingShell>
      <div className="border-b border-border bg-surface-base">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-label-s uppercase tracking-[0.16em] text-brand-secondary">Documentation</p>
          <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-display-m text-text-primary">{article?.title ?? 'DEVteam docs'}</h1>
              <p className="mt-3 max-w-[760px] text-body-l text-text-secondary">
                {article?.description ?? 'Structured product documentation for building, reviewing, diagnosing, and exporting generated applications.'}
              </p>
            </div>
            <DocsSearch />
          </div>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1440px] gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)_240px] lg:px-8">
        <DocsSidebar activeSlug={article?.slug} />

        <main className="min-w-0">
          {children}
          {article ? <RelatedArticles article={article} /> : null}
        </main>

        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-5">
            <div>
              <h2 className="text-label-s uppercase tracking-[0.14em] text-text-muted">On this page</h2>
              {toc.length > 0 ? (
                <nav aria-label="Table of contents" className="mt-3 space-y-2">
                  {toc.map((section) => (
                    <a key={section.id} href={`#${section.id}`} className="block border-l border-border-muted pl-3 text-body-s text-text-secondary hover:border-brand-primary hover:text-text-primary">
                      {section.title}
                    </a>
                  ))}
                </nav>
              ) : (
                <p className="mt-3 text-body-s text-text-secondary">Select an article to view its contents.</p>
              )}
            </div>
            <div className="rounded-[var(--radius-panel)] border border-border bg-surface-raised p-4 shadow-hairline">
              <p className="text-label-m text-text-primary">Need a product path?</p>
              <p className="mt-1 text-body-s text-text-secondary">Open the workspace for project evidence, preview health, diagnostics, and export.</p>
              <Link href="/workspace" className="mt-3 inline-flex text-label-s text-brand-primary hover:text-brand-primary-hover">
                Open workspace
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </MarketingShell>
  );
}

export function DocsArticleView({ article }: { article: DocsArticle }) {
  return (
    <article className="rounded-[var(--radius-modal)] border border-border bg-surface-raised shadow-card">
      <header className="border-b border-border-muted px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">{article.category}</Badge>
          <span className="text-label-s text-text-muted">{article.readingTime}</span>
        </div>
        <h2 className="mt-4 text-title-l text-text-primary">{article.title}</h2>
        <p className="mt-2 max-w-[760px] text-body-s leading-6 text-text-secondary">{article.description}</p>
      </header>

      <div className="px-5 py-6 sm:px-7">
        <div className="max-w-[78ch] space-y-10">
          {article.sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <h3 className="text-title-s text-text-primary">{section.title}</h3>
              <p className="mt-3 text-body-s leading-7 text-text-secondary">{section.body}</p>
              {section.bullets ? (
                <ul className="mt-4 space-y-2 border-l border-border-muted pl-4 text-body-s text-text-secondary">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}

export function DocsHub() {
  return (
    <div className="space-y-6">
      <section className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-5 shadow-card sm:p-7">
        <div className="max-w-[820px]">
          <Badge variant="active">Docs hub</Badge>
          <h2 className="mt-4 text-title-l text-text-primary">Find the product guidance for each part of DEVteam.</h2>
          <p className="mt-3 text-body-s leading-6 text-text-secondary">
            These docs explain how to get started, how projects move through lifecycle states, how preview and diagnostics should be read, and which backend contracts are still required for administration features.
          </p>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {docsArticles.map((article) => (
          <Link
            key={article.slug}
            href={`/docs/${article.slug}`}
            className="group rounded-[var(--radius-panel)] border border-border bg-surface-raised p-5 shadow-hairline transition-colors hover:border-border-strong hover:bg-surface-tint focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            <div className="flex items-start gap-3">
              <span className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-base text-brand-primary">
                {article.icon}
              </span>
              <span>
                <span className="block text-label-s text-text-muted">{article.category}</span>
                <span className="mt-1 block text-title-s text-text-primary group-hover:text-brand-primary">{article.title}</span>
                <span className="mt-2 block text-body-s leading-6 text-text-secondary">{article.description}</span>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function DocsSidebar({ activeSlug }: { activeSlug?: string }) {
  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-4 shadow-card">
        <Link href="/docs" className={cn('block rounded-[var(--radius-control)] px-3 py-2 text-label-m', !activeSlug ? 'bg-brand-primary-subtle text-brand-primary' : 'text-text-primary hover:bg-surface-tint')}>
          Docs home
        </Link>
        <nav aria-label="Docs navigation" className="mt-4 space-y-5">
          {docsNavigation.map((group) => (
            <div key={group.title}>
              <h2 className="px-3 text-label-s uppercase tracking-[0.14em] text-text-muted">{group.title}</h2>
              <div className="mt-2 space-y-1">
                {group.slugs.map((slug) => {
                  const article = docsArticles.find((item) => item.slug === slug);
                  if (!article) return null;

                  return (
                    <Link
                      key={slug}
                      href={`/docs/${slug}`}
                      className={cn(
                        'flex items-center gap-2 rounded-[var(--radius-control)] px-3 py-2 text-body-s transition-colors',
                        activeSlug === slug
                          ? 'bg-brand-primary-subtle text-brand-primary'
                          : 'text-text-secondary hover:bg-surface-tint hover:text-text-primary',
                      )}
                    >
                      {article.icon}
                      <span>{article.title}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}

function DocsSearch() {
  return (
    <div className="w-full max-w-[420px] rounded-[var(--radius-panel)] border border-border bg-surface-raised p-3 shadow-hairline">
      <label htmlFor="docs-search" className="text-label-s uppercase tracking-[0.14em] text-text-muted">
        Search docs
      </label>
      <div className="mt-2 flex h-11 items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-base px-3 text-text-muted">
        <Search className="h-4 w-4" aria-hidden="true" />
        <input
          id="docs-search"
          type="search"
          placeholder="Search placeholder"
          disabled
          className="min-w-0 flex-1 bg-transparent text-body-s outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
        />
      </div>
      <p className="mt-2 text-label-s text-text-muted">Search backend/index is not connected yet. Use the sidebar navigation for now.</p>
    </div>
  );
}

function RelatedArticles({ article }: { article: DocsArticle }) {
  const related = getRelatedArticles(article);
  if (related.length === 0) return null;

  return (
    <section className="mt-6 rounded-[var(--radius-modal)] border border-border bg-surface-base p-5">
      <h2 className="text-title-s text-text-primary">Related articles</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {related.map((item) => (
          <Link key={item.slug} href={`/docs/${item.slug}`} className="rounded-[var(--radius-panel)] border border-border bg-surface-raised p-4 text-body-s text-text-secondary hover:bg-surface-tint hover:text-text-primary">
            <span className="block text-label-m text-text-primary">{item.title}</span>
            <span className="mt-1 block">{item.description}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
