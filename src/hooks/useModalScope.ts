import { useEffect, useId, useRef } from "react";
import { useModalStore } from "@/components/ui/modal-store";

export function useModalScope(isOpen: boolean, close?: () => void) {
  const id = useId();
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!isOpen) return;
    const { register, unregister } = useModalStore.getState();
    const closer = closeRef.current ? () => closeRef.current?.() : undefined;
    register(id, closer);
    return () => {
      unregister(id);
    };
  }, [isOpen, id]);

  return id;
}
