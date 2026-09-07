import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { registerBackUpNavigator } from "@/lib/window/androidBack";

// Gives the Android back handler a way to navigate up without a history entry.
export function AndroidBackNavigator() {
  const navigate = useNavigate();
  useEffect(
    () => registerBackUpNavigator((to) => navigate(to, { replace: true })),
    [navigate]
  );
  return null;
}
