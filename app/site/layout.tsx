import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteShell } from '@/components/site/site';
import { getPublishedSiteContent } from '@/lib/site/store';

// The content is edited and published in the platform panel: always render the current version.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const content = await getPublishedSiteContent();
  return {
    title: content.seoTitle,
    description: content.seoDescription,
    openGraph: { title: content.seoTitle, description: content.seoDescription, locale: 'pt_BR', type: 'website' },
  };
}

export default async function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteShell content={await getPublishedSiteContent()}>{children}</SiteShell>;
}
