/** Marca do FinControl: três barras ascendentes, a maior em verde (positivo). */
export default function Logo({ tamanho = 20 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4.5" y="13" width="3.4" height="6.5" rx="1.7" fill="currentColor" />
      <rect x="10.3" y="9" width="3.4" height="10.5" rx="1.7" fill="currentColor" />
      <rect x="16.1" y="4.5" width="3.4" height="15" rx="1.7" fill="var(--positive)" />
    </svg>
  );
}
