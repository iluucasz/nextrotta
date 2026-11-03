'use client';

import { VideoModalButton } from '@/components/parts/admin/tab-video';

/**
 * One tutorial per screen of the company's system (YouTube, unlisted). Keys are the page names used in
 * `<TutorialVideoButton page="..." />`; a screen with no entry (or an empty `id`) shows no button, so add the
 * video here as it is published. The series and how it is produced are in the owner's tutoriais-do-sistema folder.
 */
const TUTORIAL_VIDEOS: Record<string, { id: string; title: string }> = {
  operacao: { id: 'dzch-UwNkJw', title: 'Operação' },
  'dashboard-gerencial': { id: '0Ad_Emf0nAo', title: 'Dashboard Gerencial' },
  servicos: { id: 'w0BB3S8XvcA', title: 'Serviços' },
};

/** The "Vídeo tutorial" button for the title bar of a screen. Renders nothing while that screen has no video. */
export function TutorialVideoButton({ page }: { page: string }) {
  const video = TUTORIAL_VIDEOS[page];
  if (!video?.id) return null;
  return (
    <VideoModalButton
      title={`Como usar ${video.title}`}
      description={`Vídeo que mostra, passo a passo, como usar a tela ${video.title}.`}
      desktop={video.id}
    />
  );
}
