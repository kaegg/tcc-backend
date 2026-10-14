/**
 * Fuso do estudo. "Hoje" e "este mês" do chatbot precisam ser os mesmos do
 * navegador do participante (ADR 0012), e não os do relógio do servidor.
 */
export const STUDY_TIME_ZONE = 'America/Sao_Paulo';

export function referenceDate(now: Date): { date: string; weekday: string } {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: STUDY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const weekday = new Intl.DateTimeFormat('pt-BR', {
    timeZone: STUDY_TIME_ZONE,
    weekday: 'long',
  }).format(now);

  return { date, weekday };
}
