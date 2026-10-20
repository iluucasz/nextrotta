import { MarketingNews } from '@/components/site/site';
export default async function NewsPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <MarketingNews id={id} />; }
