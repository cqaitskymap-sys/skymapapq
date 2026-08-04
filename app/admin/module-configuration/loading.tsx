export default function ModuleConfigurationLoading() {
  return (
    <div className="space-y-4 p-6 animate-pulse">
      <div className="h-8 w-72 bg-slate-200 dark:bg-slate-800 rounded" />
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 bg-slate-200 dark:bg-slate-800 rounded" />
        ))}
      </div>
      <div className="h-64 bg-slate-200 dark:bg-slate-800 rounded" />
    </div>
  );
}
