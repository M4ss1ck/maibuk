// Build-time constant - Vite replaces this during build. A leaf module, so code
// that must not pull in the platform factories (the shortcut runtime) can read it.
export const IS_WEB = import.meta.env.VITE_BUILD_TARGET === "web";
