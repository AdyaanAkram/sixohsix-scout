export const EmptyState = ({ icon: Icon, title, hint, action }) => (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#E6D9C2] bg-white/60 px-6 py-12 text-center" data-testid="empty-state">
    {Icon && <Icon className="h-10 w-10 text-slate-300 mb-3" />}
    <p className="font-semibold text-slate-700">{title}</p>
    {hint && <p className="text-sm text-slate-500 mt-1 max-w-sm">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
