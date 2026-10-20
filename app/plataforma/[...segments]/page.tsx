import { notFound } from 'next/navigation';
import { PlatformRouter } from '@/components/platform/router';
import { PLATFORM_SECTIONS as sections } from '@/components/platform/sections';
export default async function PlatformSectionPage({ params }: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await params;
  if (!sections.includes(segments[0]) || segments.length > 3 || (segments.length === 3 && (segments[0] !== 'organizacoes' || !['provisionamento', 'acesso'].includes(segments[2])))) notFound();
  return <PlatformRouter key={segments.join('/')} segments={segments} />;
}
