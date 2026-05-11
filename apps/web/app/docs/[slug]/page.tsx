import { notFound } from 'next/navigation';
import { DocsArticleView, DocsLayout, docsArticles, getDocsArticle } from '../../../src/components/docs';

interface DocsArticlePageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return docsArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: DocsArticlePageProps) {
  const { slug } = await params;
  const article = getDocsArticle(slug);
  if (!article) return {};

  return {
    title: `${article.title} | DEVteam docs`,
    description: article.description,
  };
}

export default async function DocsArticlePage({ params }: DocsArticlePageProps) {
  const { slug } = await params;
  const article = getDocsArticle(slug);

  if (!article) notFound();

  return (
    <DocsLayout article={article}>
      <DocsArticleView article={article} />
    </DocsLayout>
  );
}
