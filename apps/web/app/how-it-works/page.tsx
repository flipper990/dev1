import { DocsArticleView, DocsLayout, getDocsArticle } from '../../src/components/docs';

export default function HowItWorksPage() {
  const article = getDocsArticle('project-lifecycle');

  if (!article) {
    return (
      <DocsLayout>
        <p className="text-body-s text-text-secondary">Project lifecycle documentation is unavailable.</p>
      </DocsLayout>
    );
  }

  return (
    <DocsLayout article={article}>
      <DocsArticleView article={article} />
    </DocsLayout>
  );
}
