'use client';
import { useRef, useState, type CSSProperties } from 'react';
import { Play } from 'lucide-react';
import './video.css';

/**
 * Vídeo de apresentação da home, hospedado no próprio site (`public/site/video/`) e tocado pelo
 * player simples do navegador; o arquivo só é baixado quando a pessoa aperta o play. Os capítulos
 * funcionam como a "rota" do vídeo: clicar leva direto àquela parte e, com o vídeo rodando, a linha
 * se preenche conforme o tempo passa.
 *
 * Para trocar o vídeo: substitua `nextrotta-apresentacao.mp4` (H.264 + AAC, `-movflags +faststart`),
 * ajuste DURATION e CHAPTERS (início em segundos, um pouco antes da cena) e refaça a capa e as
 * miniaturas com quadros do próprio vídeo.
 */
const SRC = '/site/video/nextrotta-apresentacao.mp4';
const DURATION = 145;

const CHAPTERS = [
  { t: 0, title: 'Conheça o NextRotta', thumb: 'ch-01' },
  { t: 20, title: 'A operação num só painel', thumb: 'ch-02' },
  { t: 31, title: 'Equipe e ordens de serviço', thumb: 'ch-03' },
  { t: 41, title: 'O robô do Porto', thumb: 'ch-04' },
  { t: 61, title: 'Escala e banco de horas', thumb: 'ch-05' },
  { t: 70, title: 'Folha pronta no WhatsApp', thumb: 'ch-06' },
  { t: 82, title: 'Dashboard e financeiro', thumb: 'ch-07' },
  { t: 102, title: 'Assistente de IA', thumb: 'ch-08' },
  { t: 114, title: 'Celular e venda de peças', thumb: 'ch-09' },
  { t: 125, title: 'Planos, dados e backup', thumb: 'ch-10' },
] as const;

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function VideoShowcase() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);

  const play = (seconds: number) => {
    const node = video.current;
    if (!node) return;
    setStarted(true);
    setTime(seconds);
    node.currentTime = seconds;
    void node.play().catch(() => {});
  };

  let active = -1;
  if (started) {
    CHAPTERS.forEach((chapter, i) => {
      if (time + 0.4 >= chapter.t) active = i;
    });
  }
  let progress = 0;
  if (active >= 0) {
    const end = CHAPTERS[active + 1]?.t ?? DURATION;
    const part = Math.min(
      1,
      Math.max(0, (time - CHAPTERS[active].t) / (end - CHAPTERS[active].t)),
    );
    progress = (active + part) / (CHAPTERS.length - 1);
  }

  return (
    <section className="nrx" aria-labelledby="nrx-title">
      <div className="nrx-glow" aria-hidden />
      <div className="nrx-inner">
        <header className="nrx-head">
          <h2 id="nrx-title">Veja a rota inteira em dois minutos e meio.</h2>
          <p>
            Da planilha solta ao fechamento da folha, o NextRotta funcionando.
            Toque num capítulo para ir direto ao que você quer ver.
          </p>
        </header>

        <div className="nrx-cinema">
          <div className="nrx-player">
            <video
              ref={video}
              src={SRC}
              poster="/site/video/poster.jpg"
              preload="none"
              playsInline
              controls={started}
              controlsList="nodownload"
              onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
              aria-label="Vídeo de apresentação do NextRotta"
            />
            {!started && (
              <button
                type="button"
                className="nrx-start"
                onClick={() => play(0)}
                aria-label="Assistir ao vídeo de apresentação do NextRotta, 2 minutos e 25 segundos"
              >
                <span className="nrx-play">
                  <Play size={28} fill="currentColor" strokeWidth={0} />
                </span>
                <span className="nrx-poster-label">
                  Assistir à apresentação <b>{clock(DURATION)}</b>
                </span>
              </button>
            )}
          </div>

          <ol
            className="nrx-chapters"
            style={{ '--p': progress } as CSSProperties}
            aria-label="Capítulos do vídeo"
          >
            {CHAPTERS.map((chapter, i) => (
              <li key={chapter.t}>
                <button
                  type="button"
                  onClick={() => play(chapter.t)}
                  className={
                    i === active ? 'on' : active >= 0 && i < active ? 'done' : ''
                  }
                  aria-current={i === active ? 'true' : undefined}
                >
                  <span className="nrx-dot" aria-hidden />
                  <span className="nrx-time">{clock(chapter.t)}</span>
                  <span className="nrx-title">{chapter.title}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/site/video/${chapter.thumb}.jpg`}
                    alt=""
                    width={480}
                    height={270}
                    loading="lazy"
                  />
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
