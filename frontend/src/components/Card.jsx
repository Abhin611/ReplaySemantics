export default function Card({ children, className = "", padded = true, id }) {
  return (
    <div
      id={id}
      className={`rounded-xl border border-[#e2e6ea] bg-white shadow-card ${
        padded ? 'p-5' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}
