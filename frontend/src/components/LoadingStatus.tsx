export default function LoadingStatus({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <p className="loading-status" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      {children}
    </p>
  );
}
