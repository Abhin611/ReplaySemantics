import Card from '../components/Card'
import PreviewTag from '../components/PreviewTag'
import { mockPolicy } from '../data/mockData'

export default function Policies() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
        <span className="text-[13px] text-amber-800">
          Policy definition and the correction functions behind it are Member 2's work in
          progress. This is the intended shape of the screen, populated with sample content.
        </span>
        <PreviewTag label="Full page preview" />
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div className="text-[15px] font-bold text-[#101828]">
            {mockPolicy.id} — {mockPolicy.name}
          </div>
          <span className="rounded-md bg-status-passBg px-2.5 py-1 text-xs font-semibold text-status-pass">
            {mockPolicy.active ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </div>

        <div className="mt-5 flex flex-col gap-5">
          {mockPolicy.steps.map((step) => (
            <div key={step.order} className="flex gap-4">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#c2cad2] text-[12px] font-bold text-[#5c6b7a]">
                {step.order}
              </div>
              <div>
                <div className="text-[14px] font-bold text-[#101828]">{step.title}</div>
                <div className="mt-1 text-[13px] leading-relaxed text-[#5c6b7a]">
                  {step.description}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
