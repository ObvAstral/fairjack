import { useEffect, useRef, useState } from "react";
import type { OperationPhase, Progress } from "./async";
import { readableError } from "./errors";

export function useOperation() {
  const lock = useRef(false),
    mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [phase, setPhase] = useState<OperationPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const progress: Progress = (text, nextPhase) => {
    if (mounted.current) {
      setMessage(text);
      setPhase(nextPhase);
    }
  };
  async function run(action: (progress: Progress) => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setSuccess(null);
    progress("Preparazione operazione…", "submitting");
    try {
      await action(progress);
    } catch (cause) {
      if (mounted.current) setError(readableError(cause));
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        setMessage(null);
        setPhase(null);
      }
    }
  }
  return {
    busy,
    message,
    phase,
    error,
    success,
    run,
    succeed: (text: string) => {
      if (mounted.current) setSuccess(text);
    },
  };
}
