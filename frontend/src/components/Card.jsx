export default function Card({ children, className = '', padded = true }) {
  return (
    <div
      className={`rounded-xl border border-[#e2e6ea] bg-white shadow-card ${
        padded ? 'p-5' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}
