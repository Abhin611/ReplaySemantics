export default function Card({ children, className = "", padded = true, id }) {
  return (
    <div
      id={id}
      className={`rs-card rounded-2xl border border-[#e3e7ec] bg-white shadow-card ${
        padded ? 'p-5' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}
