export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/20 pt-16">
      <div
        role="status"
        aria-label="読み込み中"
        className="h-10 w-10 animate-spin rounded-full border-4 border-white/40 border-t-white"
      />
    </div>
  );
}
