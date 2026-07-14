import { useEffect, useId } from "react";
import { useModalStore } from "@/components/ui/modal-store";

export function useModalScope(isOpen: boolean) {
  const id = useId();

  useEffect(() => {
    if (!isOpen) return;
    const { register, unregister } = useModalStore.getState();
    register(id);
    return () => {
      unregister(id);
    };
  }, [isOpen, id]);
}
