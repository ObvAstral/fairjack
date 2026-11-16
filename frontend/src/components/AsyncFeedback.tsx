import type { useOperation } from "../utils/useOperation";
import LoadingStatus from "./LoadingStatus";

type ResourceFeedback = {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<boolean>;
};
export default function AsyncFeedback({
  operation,
  resource,
  loadingMessage = "Caricamento dati…",
}: {
  operation?: ReturnType<typeof useOperation>;
  resource?: ResourceFeedback;
  loadingMessage?: string;
}) {
  return (
    <>
      {(operation?.busy || resource?.loading) && (
        <LoadingStatus>{operation?.message || loadingMessage}</LoadingStatus>
      )}
      {operation?.success && (
        <p className="success" role="status">
          {operation.success}
        </p>
      )}
      {operation?.error && (
        <p className="error" role="alert">
          {operation.error}
        </p>
      )}
      {resource?.error && (
        <div className="error" role="alert">
          <span>{resource.error}</span>
          <button
            type="button"
            className="secondary"
            disabled={operation?.busy || resource.loading}
            onClick={() => void resource.refresh()}
          >
            Riprova aggiornamento
          </button>
        </div>
      )}
    </>
  );
}
