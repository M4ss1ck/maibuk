// LIFO registry of "back dismissers". The topmost UI surface (modal, menu,
// mobile sidebar) registers a dismisser; the Android back handler runs them
// newest-first and stops at the first one that reports it handled the press.
type Dismisser = () => boolean;

const stack: Dismisser[] = [];

export function registerBackDismiss(fn: Dismisser): () => void {
  stack.push(fn);
  return () => {
    const index = stack.lastIndexOf(fn);
    if (index !== -1) stack.splice(index, 1);
  };
}

export function runTopBackDismiss(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]()) return true;
  }
  return false;
}
