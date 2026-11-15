export default function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-paper">
      <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
