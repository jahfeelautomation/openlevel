import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { type Appointment, type AppointmentStatus, type Calendar } from '../../lib/api'
import { cn, formatTime } from '../../lib/utils'

interface MonthViewProps {
  appts: Appointment[]
  calendars: Record<string, Calendar>
  onStatus: (id: string, next: AppointmentStatus) => void
  contactName: (a: Appointment) => string | undefined
}

export function MonthView({ appts, calendars, onStatus, contactName }: MonthViewProps) {
  const [currentDate, setCurrentDate] = useState(() => new Date())
  
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const start = new Date(year, month, 1)
  const end = new Date(year, month + 1, 0)
  const startDate = start.getDay() 
  
  const days: { date: Date; isCurrentMonth: boolean }[] = []
  const prevMonthEnd = new Date(year, month, 0).getDate()
  
  for (let i = startDate - 1; i >= 0; i--) {
    days.push({ date: new Date(year, month - 1, prevMonthEnd - i), isCurrentMonth: false })
  }
  for (let i = 1; i <= end.getDate(); i++) {
    days.push({ date: new Date(year, month, i), isCurrentMonth: true })
  }
  const nextDays = 42 - days.length
  for (let i = 1; i <= nextDays; i++) {
    days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false })
  }

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1))
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1))
  const today = () => setCurrentDate(new Date())

  const isToday = (d: Date) => {
    const t = new Date()
    return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear()
  }

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })

  const getDayAppts = (d: Date) => {
    return appts.filter((a) => {
      const ad = new Date(a.starts_at)
      return ad.getDate() === d.getDate() && ad.getMonth() === d.getMonth() && ad.getFullYear() === d.getFullYear()
    })
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 min-h-0 flex-1">
      <div className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-4">
          <h2 className="text-base font-semibold text-slate-900 min-w-[140px]">{monthName}</h2>
          <div className="flex items-center gap-1 bg-slate-100 rounded-md p-0.5">
            <button onClick={prevMonth} className="p-1 hover:bg-white hover:shadow-sm rounded transition-all text-slate-600">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={today} className="px-3 py-1 text-xs font-medium hover:bg-white hover:shadow-sm rounded transition-all text-slate-700">
              Today
            </button>
            <button onClick={nextMonth} className="p-1 hover:bg-white hover:shadow-sm rounded transition-all text-slate-600">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 min-h-0">
        <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="bg-slate-50 py-2.5 text-center text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              {d}
            </div>
          ))}
          {days.map((d, i) => {
            const dayAppts = getDayAppts(d.date)
            const current = isToday(d.date)
            return (
              <div key={i} className={cn("bg-white min-h-[100px] lg:min-h-[120px] p-1.5 transition-colors hover:bg-slate-50", !d.isCurrentMonth && "bg-slate-50/50 text-slate-400 opacity-75")}>
                <div className="flex justify-between items-start mb-1.5">
                  <span className={cn("text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full", current ? "bg-brand-500 text-white" : "text-slate-700")}>
                    {d.date.getDate()}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayAppts.map(a => {
                    return (
                      <div key={a.id} className={cn("text-[11px] px-1.5 py-1 rounded border truncate cursor-pointer hover:bg-slate-200 transition-colors", a.status === 'cancelled' || a.status === 'no_show' ? 'opacity-50 border-slate-200 bg-slate-50' : 'border-brand-200 bg-brand-50')} title={`${formatTime(a.starts_at)} - ${a.title}`}>
                        <span className="font-semibold text-slate-700 mr-1">{formatTime(a.starts_at)}</span>
                        <span className="text-slate-700">{a.title}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
